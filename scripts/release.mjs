#!/usr/bin/env node
// @ts-nocheck
/**
 * release.mjs — cut a release tag (vX.Y.Z) the way this repo's CI expects.
 *
 * What a release is here: pushing a git TAG `vX.Y.Z` to the release branch
 * triggers the GitHub Actions `release` workflow, which publishes a GitHub Release
 * with the one-click installers attached. This helper produces that tag the
 * standard way: bump package.json → commit `chore(release): vX.Y.Z` → annotated
 * tag → (optionally) push.
 *
 * SAFE BY DEFAULT — it does NOTHING destructive unless you opt in:
 *   - no flags        → DRY RUN: prints the exact plan + commands, runs nothing
 *   - --run           → bump package.json, commit, create the local tag
 *   - --push          → also push branch + tag (implies --run); pushes to the
 *                       release branch (main) — that is this repo's workflow,
 *                       but it only happens when you explicitly pass --push
 *
 * Version argument (optional; defaults to the bump suggested from commit history):
 *   patch | minor | major | X.Y.Z
 *
 * Tunables (env, with defaults — portability-and-config):
 *   RELEASE_REMOTE  git remote   (default: origin)
 *   RELEASE_BRANCH  release branch (default: main)
 *   TAG_PREFIX      tag prefix    (default: v)
 *
 * Usage:
 *   node scripts/release.mjs                 # dry-run, suggested bump
 *   node scripts/release.mjs minor           # dry-run for a minor bump
 *   node scripts/release.mjs 2.0.0 --run     # bump+commit+tag locally
 *   node scripts/release.mjs patch --push    # full release (bump+commit+tag+push)
 *   node scripts/release.mjs --selftest
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REMOTE = process.env.RELEASE_REMOTE ?? 'origin';
const BRANCH = process.env.RELEASE_BRANCH ?? 'main';
const PREFIX = process.env.TAG_PREFIX ?? 'v';
const PKG = fileURLToPath(new URL('../package.json', import.meta.url));

// ─── pure helpers (covered by --selftest) ───────────────────────────────────
export function bumpVersion(current, levelOrExact) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`current version is not clean semver: ${current}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  switch (levelOrExact) {
    case 'major': return `${maj + 1}.0.0`;
    case 'minor': return `${maj}.${min + 1}.0`;
    case 'patch': return `${maj}.${min}.${pat + 1}`;
    default:
      if (/^\d+\.\d+\.\d+$/.test(levelOrExact)) return levelOrExact;
      throw new Error(`invalid version/bump '${levelOrExact}' (use patch|minor|major|X.Y.Z)`);
  }
}

/** Suggest a bump from Conventional Commit subjects since the last tag. */
export function suggestBump(subjects) {
  if (subjects.some((s) => /^[a-z]+(\(.+\))?!:/.test(s) || /BREAKING CHANGE/.test(s))) return 'major';
  if (subjects.some((s) => /^feat(\(.+\))?:/.test(s))) return 'minor';
  return 'patch';
}

// ─── git plumbing ────────────────────────────────────────────────────────────
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (err) {
    if (allowFail) return '';
    throw new Error(`git ${args.join(' ')} failed: ${err.stderr || err.message}`);
  }
}

function readVersion() {
  return JSON.parse(readFileSync(PKG, 'utf8')).version;
}

function writeVersion(next) {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  pkg.version = next;
  writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`);
}

// ─── main ────────────────────────────────────────────────────────────────────
function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return help();
  if (argv.includes('--selftest')) return selftest();

  const doRun = argv.includes('--run') || argv.includes('--push');
  const doPush = argv.includes('--push');
  const allowDirty = argv.includes('--allow-dirty');
  const arg = argv.find((a) => !a.startsWith('-'));

  const current = readVersion();
  const lastTag = git(['describe', '--tags', '--abbrev=0'], { allowFail: true });
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const subjects = git(['log', range, '--format=%s'], { allowFail: true })
    .split('\n').filter(Boolean);
  const suggested = suggestBump(subjects);

  const next = bumpVersion(current, arg ?? suggested);
  const tag = `${PREFIX}${next}`;
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = git(['status', '--porcelain']) !== '';
  const commitMsg = `chore(release): ${tag}`;

  // ── preconditions ──
  const problems = [];
  if (git(['tag', '--list', tag])) problems.push(`tag ${tag} already exists`);
  if (dirty && !allowDirty) problems.push('working tree is dirty (commit/stash first, or pass --allow-dirty)');

  console.log(`release plan`);
  console.log(`  current version : ${current}`);
  console.log(`  next version    : ${next}  ${arg ? '(requested)' : `(suggested ${suggested} from ${subjects.length} commit(s) since ${lastTag || 'start'})`}`);
  console.log(`  tag             : ${tag}`);
  console.log(`  branch          : ${branch}${branch === BRANCH ? '' : `  (warning: not the release branch '${BRANCH}')`}`);
  console.log('');
  console.log(`commands:`);
  console.log(`  # 1. bump package.json to ${next}`);
  console.log(`  git add package.json`);
  console.log(`  git commit -m "${commitMsg}"`);
  console.log(`  git tag -a ${tag} -m "Release ${tag}"`);
  console.log(`  git push ${REMOTE} ${BRANCH} --follow-tags`);
  console.log('');

  if (problems.length) {
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log('aborting — fix the above and retry.');
    return 1;
  }

  if (!doRun) {
    console.log('DRY RUN — nothing changed. Re-run with --run (local) or --push (local + push).');
    return 0;
  }

  // ── execute ──
  console.log(`[release] bumping package.json → ${next}`);
  writeVersion(next);
  git(['add', 'package.json']);
  console.log(`[release] committing: ${commitMsg}`);
  git(['commit', '-m', commitMsg]); // lefthook pre-commit runs here (biome on package.json)
  console.log(`[release] tagging: ${tag}`);
  git(['tag', '-a', tag, '-m', `Release ${tag}`]);

  if (doPush) {
    console.log(`[release] pushing ${BRANCH} + tags to ${REMOTE}`);
    git(['push', REMOTE, BRANCH, '--follow-tags']);
    console.log(`[release] done — CI will publish the GitLab Release for ${tag}.`);
  } else {
    console.log(`[release] local commit + tag created. Push when ready:`);
    console.log(`          git push ${REMOTE} ${BRANCH} --follow-tags`);
  }
  return 0;
}

function help() {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n').filter((l) => l.startsWith(' *')).map((l) => l.slice(3)).join('\n'));
  return 0;
}

function selftest() {
  const cases = [
    ['1.0.0', 'patch', '1.0.1'],
    ['1.0.0', 'minor', '1.1.0'],
    ['1.4.2', 'major', '2.0.0'],
    ['1.0.0', '2.3.4', '2.3.4'],
  ];
  let ok = true;
  for (const [cur, lvl, want] of cases) {
    const got = bumpVersion(cur, lvl);
    ok = ok && got === want;
    console.log(`${got === want ? 'ok  ' : 'FAIL'} bump(${cur}, ${lvl}) = ${got} (want ${want})`);
  }
  const s = suggestBump(['feat(login): add x', 'fix: y']) === 'minor'
    && suggestBump(['fix: y']) === 'patch'
    && suggestBump(['feat!: drop x']) === 'major';
  console.log(`${s ? 'ok  ' : 'FAIL'} suggestBump`);
  return ok && s ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
