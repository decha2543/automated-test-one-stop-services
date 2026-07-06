// scripts/install-core/__tests__/playwright-setup.spec.ts
//
// Example / presence checks for Task 9.3 of install-and-provisioning-overhaul:
//  - the Playwright `setup` task's provisioning-failure message names BOTH the
//    PLAYWRIGHT_DOWNLOAD_HOST env var and the manual-archive location (R7.5);
//  - tools/playwright/.env.template declares EXACTLY the three provisioning keys
//    PLAYWRIGHT_DOWNLOAD_HOST / PLAYWRIGHT_BROWSERS_PATH / HTTPS_PROXY (R7.6);
//  - endpoints come from env, NOT a hardcoded CDN URL (R12.3), and TLS validation
//    is not disabled by default (R12.5).
//
// Validates: Requirements 7.5, 7.6, 12.3 (with R12.5 guard)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PW_DIR = path.join(REPO_ROOT, 'tools', 'playwright');
const TASKFILE = fs.readFileSync(path.join(PW_DIR, 'Taskfile.yml'), 'utf8');
const ENV_TEMPLATE = fs.readFileSync(path.join(PW_DIR, '.env.template'), 'utf8');

// The setup task body only (from `\n  setup:` up to the TEST RUNNERS banner), so
// assertions about "the setup task" aren't satisfied by unrelated tasks.
const SETUP_START = TASKFILE.indexOf('\n  setup:');
const SETUP_END = TASKFILE.indexOf('# TEST RUNNERS', SETUP_START);
const SETUP_BODY = TASKFILE.slice(SETUP_START, SETUP_END);

describe('Playwright setup task is discoverable + provisions offline-capably', () => {
  it('defines a top-level `setup:` task (so the root `task setup` loop invokes it)', () => {
    expect(TASKFILE).toMatch(/\n {2}setup:/);
    expect(SETUP_START).toBeGreaterThan(-1);
    expect(SETUP_END).toBeGreaterThan(SETUP_START);
  });

  it('installs into PLAYWRIGHT_BROWSERS_PATH and resolves the revision via --dry-run (R7.3/R7.4)', () => {
    expect(SETUP_BODY).toMatch(/PLAYWRIGHT_BROWSERS_PATH/);
    expect(SETUP_BODY).toMatch(/install --dry-run/);
  });
});

describe('Provisioning-failure message names the env var + manual-archive location (R7.5)', () => {
  it('names the PLAYWRIGHT_DOWNLOAD_HOST mirror env var', () => {
    expect(SETUP_BODY).toMatch(/PLAYWRIGHT_DOWNLOAD_HOST/);
  });

  it('names the manual-archive location (browser-archives/<browser>-<rev>.zip)', () => {
    expect(SETUP_BODY).toMatch(/browser-archives/);
    expect(SETUP_BODY).toMatch(/\.zip/);
  });
});

describe('Endpoints come from env, not a hardcoded URL (R12.3) + TLS not disabled (R12.5)', () => {
  it('reads the mirror endpoint from the PLAYWRIGHT_DOWNLOAD_HOST env var', () => {
    expect(SETUP_BODY).toMatch(/PLAYWRIGHT_DOWNLOAD_HOST/);
  });

  it('hardcodes no Playwright CDN download host', () => {
    expect(SETUP_BODY).not.toMatch(/azureedge\.net/);
    expect(SETUP_BODY).not.toMatch(/cdn\.playwright\.dev/);
    expect(SETUP_BODY).not.toMatch(/playwright\.download/);
  });

  it('does not disable TLS certificate validation by default (R12.5)', () => {
    expect(SETUP_BODY).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    // The documented TLS path is the mirror CA + outbound proxy, not disabling TLS.
    expect(SETUP_BODY).toMatch(/NODE_EXTRA_CA_CERTS/);
    expect(SETUP_BODY).toMatch(/HTTPS_PROXY/);
  });
});

describe('.env.template declares EXACTLY the three provisioning keys (R7.6)', () => {
  const declaredKeys = ENV_TEMPLATE.split(/\r?\n/)
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);

  it('declares PLAYWRIGHT_DOWNLOAD_HOST, PLAYWRIGHT_BROWSERS_PATH and HTTPS_PROXY', () => {
    expect(new Set(declaredKeys)).toEqual(
      new Set(['PLAYWRIGHT_DOWNLOAD_HOST', 'PLAYWRIGHT_BROWSERS_PATH', 'HTTPS_PROXY']),
    );
  });

  it('declares no other keys (exactly three)', () => {
    expect(declaredKeys).toHaveLength(3);
  });

  it('hardcodes no real URL/secret in any value (data hygiene — env-key names only)', () => {
    for (const line of ENV_TEMPLATE.split(/\r?\n/)) {
      if (/^[A-Z][A-Z0-9_]*=/.test(line)) {
        const value = line.slice(line.indexOf('=') + 1);
        expect(value).not.toMatch(/:\/\//); // no scheme://host
      }
    }
  });
});
