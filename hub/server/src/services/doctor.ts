import fs from 'node:fs';
import path from 'node:path';
import type { DoctorCategory, DoctorCheck, DoctorReport } from '@hub/shared';
import { TOOLS_DIR, WORKSPACE_ROOT } from '../config.js';
import { getComposeServiceStatus, isDockerRunning } from './docker.js';
import { runChild } from './exec.js';

interface CheckDef {
  name: string;
  cmd: string;
  args: string[];
  hint: string;
  category: DoctorCategory;
}

const CHECKS: CheckDef[] = [
  // Required installs
  {
    name: 'node',
    cmd: 'node',
    args: ['-v'],
    hint: 'Install Node.js via Volta or nvm',
    category: 'required-install',
  },
  {
    name: 'pnpm',
    cmd: 'pnpm',
    args: ['-v'],
    hint: 'Install pnpm: npm i -g pnpm',
    category: 'required-install',
  },
  {
    name: 'uv',
    cmd: 'uv',
    args: ['--version'],
    hint: 'Install uv: pip install uv or see docs.astral.sh/uv',
    category: 'required-install',
  },
  {
    name: 'task',
    cmd: 'task',
    args: ['--version'],
    hint: 'Install Task: scoop install task | brew install go-task | https://taskfile.dev/installation/',
    category: 'required-install',
  },
  {
    name: 'git',
    cmd: 'git',
    args: ['--version'],
    hint: 'Install git: winget install Git.Git',
    category: 'required-install',
  },
  // Optional installs
  {
    name: 'docker',
    cmd: 'docker',
    args: ['--version'],
    hint: 'Install Docker Desktop',
    category: 'optional-install',
  },
  {
    name: 'playwright-cli',
    cmd: 'playwright-cli',
    args: ['--version'],
    hint: 'Install via Volta: volta install playwright-cli',
    category: 'optional-install',
  },
  {
    name: 'appium',
    cmd: 'appium',
    args: ['--version'],
    hint: 'Install from the Hub Services tab (mobile), or: npm i -g appium && appium driver install uiautomator2',
    category: 'optional-install',
  },
];

async function runCheck(def: CheckDef): Promise<DoctorCheck> {
  // Some CLIs (notably `pnpm` on Windows) live as a `.cmd` shim — argv-style
  // spawn with `shell: false` fails to find them. Run with `shell: true` for
  // these probes (we control the argv, so there is no injection vector).
  const res = await runChild(def.cmd, def.args, {
    timeoutMs: 10_000,
    shell: process.platform === 'win32',
  });
  if (res.ok) {
    return { name: def.name, ok: true, version: res.stdout.trim(), category: def.category };
  }
  return { name: def.name, ok: false, hint: def.hint, category: def.category };
}

/** Compose-service availability probe with a friendly hint per service. */
async function checkComposeService(
  name: 'influxdb' | 'grafana',
  port: number,
): Promise<DoctorCheck> {
  const status = await getComposeServiceStatus(name);
  if (status === 'running') {
    return {
      name,
      ok: true,
      version: `running on :${port}`,
      category: 'optional-process',
    };
  }
  return {
    name,
    ok: false,
    hint: `Start ${name}: docker compose up ${name} -d`,
    category: 'optional-process',
  };
}

async function checkDockerDaemon(): Promise<DoctorCheck> {
  const ok = await isDockerRunning();
  return ok
    ? { name: 'docker-running', ok: true, version: 'daemon active', category: 'optional-process' }
    : {
        name: 'docker-running',
        ok: false,
        hint: 'Start Docker Desktop or run: sudo systemctl start docker',
        category: 'optional-process',
      };
}

// ── Folder-presence gating ─────────────────
//
// A tool-owned check is mandatory (`required-install`) iff the tool's
// `tools/<id>/` folder is present. When the folder is absent the check becomes a
// benign, passing `optional-install` self-check so it never forces `overallOk`
// false, never auto-expands the dashboard panel, and never prevents another
// component from independently declaring that tool required.
//
// ponytail: reuses the existing `optional-install` category instead of adding a
// `not-required` DoctorCategory. `overallOk` (and the client summary badge)
// consider only `required-install`, so `optional-install` yields identical
// overall semantics while avoiding edits to the client's exhaustive
// `Record<DoctorCategory>` consumers (`groupByCategory`, `DOCTOR_CATEGORY_ORDER`)
// which are out of this change's scope. Upgrade path: add `not-required` to the
// union and extend those client maps. Presence uses `fs.existsSync(TOOLS_DIR/id)`
// — the Hub server package cannot import the `scripts/manifests`
// folder-presence helper (not a workspace package; Biome bans the deep relative
// import), and a single `existsSync` is not a discovery-scan re-implementation.

/** True iff `tools/<id>/` exists on disk — the folder-presence gate. */
export function isToolFolderPresent(id: string): boolean {
  return fs.existsSync(path.join(TOOLS_DIR, id));
}

/**
 * The category a folder-presence-gated tool check takes: a mandatory
 * `required-install` when the tool folder is present, otherwise a non-required
 * `optional-install` self-check (`overallOk` ignores it).
 */
export function toolCheckCategory(present: boolean): DoctorCategory {
  return present ? 'required-install' : 'optional-install';
}

/**
 * Overall health: every mandatory (`required-install`) check passes. Checks in
 * any other category never affect the result, so an absent tool's
 * `optional-install` self-check drops out naturally.
 */
export function computeOverallOk(checks: readonly DoctorCheck[]): boolean {
  return checks.filter((c) => c.category === 'required-install').every((c) => c.ok);
}

/** The benign, passing self-check emitted when a tool's folder is absent. */
function absentToolCheck(name: string, folder: string): DoctorCheck {
  return {
    name,
    ok: true,
    version: `not required (tools/${folder} absent)`,
    category: toolCheckCategory(false),
  };
}

/**
 * k6 binary probe, folder-presence-gated on `tools/k6/`. Present →
 * a mandatory `required-install` probe of the k6 binary; absent → a non-required
 * self-check, so a workstation without the k6 tool never fails the doctor.
 */
async function checkK6(present: boolean): Promise<DoctorCheck> {
  if (!present) return absentToolCheck('k6', 'k6');
  return runCheck({
    name: 'k6',
    cmd: 'k6',
    args: ['version'],
    hint: 'Install k6: winget install Grafana.k6',
    category: 'required-install',
  });
}

/**
 * Playwright browser check, folder-presence-gated on `tools/playwright/`
 *. Present → derived from the tool: a mandatory `required-install`
 * probe of `PLAYWRIGHT_BROWSERS_PATH`. Absent → a non-required self-check that
 * does not prevent another component from declaring Playwright required.
 */
function checkPlaywrightBrowsers(present: boolean): DoctorCheck {
  if (!present) return absentToolCheck('playwright-browsers', 'playwright');

  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const browsersPath = envPath || path.join(home, '.cache', 'ms-playwright');
  const exists = fs.existsSync(browsersPath);
  if (exists) {
    return {
      name: 'playwright-browsers',
      ok: true,
      version: `path: ${browsersPath}`,
      category: 'required-install',
    };
  }
  return {
    name: 'playwright-browsers',
    ok: false,
    hint: 'Run: pnpm exec playwright install',
    category: 'required-install',
  };
}

/** Check if Google credentials file exists for usage logging. */
function checkCredentials(): boolean {
  const credPath = path.join(
    WORKSPACE_ROOT,
    'scripts',
    'third-party',
    'google',
    'credentials',
    'credentials.json',
  );
  return fs.existsSync(credPath);
}

let lastReport: { value: DoctorReport; at: number } | null = null;
const DOCTOR_CACHE_TTL_MS = 10_000;

/**
 * Run all environment health checks concurrently. Cached briefly because the
 * full sweep spawns ~13 child processes; the dashboard refreshes often.
 */
export async function runDoctor(): Promise<DoctorReport> {
  const now = Date.now();
  if (lastReport && now - lastReport.at < DOCTOR_CACHE_TTL_MS) return lastReport.value;

  const k6Present = isToolFolderPresent('k6');
  const playwrightPresent = isToolFolderPresent('playwright');

  const checks = await Promise.all([
    ...CHECKS.map(runCheck),
    checkK6(k6Present),
    Promise.resolve(checkPlaywrightBrowsers(playwrightPresent)),
    checkDockerDaemon(),
    checkComposeService('influxdb', 8086),
    checkComposeService('grafana', 3000),
  ]);

  // Some checks may contribute an array; flatten so `DoctorReport.checks`
  // stays a flat list.
  const flatChecks: DoctorCheck[] = checks.flat();

  const overallOk = computeOverallOk(flatChecks);

  const value: DoctorReport = {
    checks: flatChecks,
    overallOk,
    credentialsOk: checkCredentials(),
  };
  lastReport = { value, at: now };
  return value;
}

/** Force the next /api/doctor call to re-probe. */
export function invalidateDoctorCache(): void {
  lastReport = null;
}
