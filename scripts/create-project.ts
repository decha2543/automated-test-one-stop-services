import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import { createManifestRegistry, type ToolManifest } from './manifests/index.js';

const currentDir =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');

// ── CLI args parsing ────────────────────────────────────────────────────────

interface CliArgs {
  readonly tool?: string;
  readonly type?: string;
  readonly name?: string;
}

function parseCliArgs(args: readonly string[]): CliArgs {
  const out: { tool?: string; type?: string; name?: string } = {};
  for (const a of args) {
    const m = a.match(/^--(\w+)=(.+)$/);
    if (m) {
      const [, k, v] = m;
      if (k === 'tool' || k === 'type' || k === 'name') {
        (out as Record<string, string>)[k] = v ?? '';
      }
    }
  }
  return out;
}

// ── Filesystem helpers ──────────────────────────────────────────────────────

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!['node_modules', '.venv', 'outputs', '__pycache__'].includes(entry.name)) {
        copyDir(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Destination folder resolution (design §4.4) ────────────────────────────

function pickDestFolder(
  root: string,
  manifest: ToolManifest,
  type: string | null,
  name: string,
): string {
  // depth=1 + fixedType → tools/<id>/<root>/<fixedType>/<name>
  if (manifest.projects.depth === 1 && manifest.projects.fixedType !== null) {
    return path.join(
      root,
      'tools',
      manifest.id,
      manifest.projects.root,
      manifest.projects.fixedType,
      name,
    );
  }
  // depth=2 → tools/<id>/<root>/<type>/<name>
  return path.join(root, 'tools', manifest.id, manifest.projects.root, type ?? 'web', name);
}

// ── Manifest-driven path ────────────────────────────────────────────────────

async function createProjectManifest(cli: CliArgs): Promise<void> {
  const registry = createManifestRegistry(rootDir);
  await registry.refresh();
  const tools = registry.enabled();

  // Tool selection
  const toolPick = await prompts({
    type: cli.tool !== undefined ? null : 'select',
    name: 'tool',
    message: 'Select the tool for the new project:',
    choices: tools.map((t) => ({ title: t.title, value: t.id })),
  });
  const toolId = (cli.tool ?? toolPick.tool) as string | undefined;
  if (!toolId) {
    console.log('Cancelled.');
    process.exit(0);
  }

  const manifest = registry.byId(toolId as ToolManifest['id']);
  if (manifest === undefined) {
    console.error(`Unknown or disabled tool: ${toolId}`);
    process.exit(1);
  }

  // Type selection — only when manifest.projects.typeAxis === true
  let type: string | null = null;
  if (manifest.projects.typeAxis) {
    const availableTypes = Object.keys(manifest.projects.templates).filter((k) => k !== 'default');
    const typePick = await prompts({
      type: cli.type !== undefined ? null : 'text',
      name: 'type',
      message: `Enter the project type (e.g. ${availableTypes.join(', ')}):`,
      initial: availableTypes[0] ?? 'web',
      validate: (val: string) => (val.trim() !== '' ? true : 'Type is required'),
    });
    type = ((cli.type ?? typePick.type) as string | undefined) ?? null;
    if (!type) {
      console.log('Cancelled.');
      process.exit(0);
    }
  } else {
    type = manifest.projects.fixedType;
  }

  // Project name
  const namePick = await prompts({
    type: cli.name !== undefined ? null : 'text',
    name: 'projectName',
    message: 'Enter the new project name (e.g., my-awesome-project):',
    validate: (val: string) => (val.trim() !== '' ? true : 'Project name is required'),
  });
  const projectName = (cli.name ?? namePick.projectName) as string | undefined;
  if (!projectName) {
    console.log('Cancelled.');
    process.exit(0);
  }

  // Template resolution: manifest.projects.templates[type] ?? templates.default
  const templateRel =
    manifest.projects.templates[type ?? 'default'] ?? manifest.projects.templates.default;
  if (templateRel === undefined) {
    console.error(`No template for tool=${toolId} type=${type}`);
    process.exit(1);
  }

  const srcTemplate = path.join(rootDir, 'tools', manifest.id, templateRel);
  const destFolder = pickDestFolder(rootDir, manifest, type, projectName);

  if (!fs.existsSync(srcTemplate)) {
    console.error(`❌ Template not found at: ${srcTemplate}`);
    console.error('Please ensure a base template exists before generating.');
    process.exit(1);
  }
  if (fs.existsSync(destFolder)) {
    console.error(`❌ Project folder already exists at: ${destFolder}`);
    process.exit(1);
  }

  console.log('\nCopying template...');
  copyDir(srcTemplate, destFolder);
  console.log(`✅ Created project folder at: ${path.relative(rootDir, destFolder)}`);

  console.log('\nSyncing environments and docker-compose...');
  spawnSync('pnpm', ['exec', 'tsx', 'scripts/sync-projects.ts'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });

  console.log(`\n🎉 Project '${projectName}' generated successfully!`);
  console.log('\nNext steps:');
  console.log(`   1. Edit .env file: ${path.relative(rootDir, destFolder)}/.env`);
  console.log('   2. Run tests: task');
  console.log(
    `   3. Or directly: task ${manifest.runner.taskNamespace}:run-local PROJECT=${projectName}${type && manifest.projects.typeAxis ? ` TYPE=${type}` : ''}`,
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Project Scaffolding Generator\n');

  const cli = parseCliArgs(process.argv.slice(2));
  await createProjectManifest(cli);
}

main().catch(console.error);
