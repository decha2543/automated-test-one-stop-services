// scripts/manifests/__tests__/pm2-autostart-scope.spec.ts
//
// Example test for Task 15 of the install-and-provisioning-overhaul spec
// (Windows pm2 auto-start via a user-scope logon Scheduled Task, design D4-A).
// Asserts:
//  - The default auto-start registers in the INSTALLING USER's scope, not admin:
//    the schtasks invocation is `/sc onlogon` with `/rl limited`, and never
//    `/rl highest`, `runas`, or any other elevation (R12.4).
//  - The flaky HKCU Run-key hook is fully gone (no `pm2-windows-startup` Volta
//    package, no `pm2-startup install`).
//  - The Scheduled Task action (pm2-resurrect.cmd) puts the Volta shim dir on
//    PATH BEFORE it invokes pm2, so pm2/node resolve in the bare logon context
//    (R10.4), and pins the SAME PM2_HOME the dump was saved under (R10.1, R10.3).
//
// Validates: Requirements 10.4, 12.4
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SETUP_DIR = path.join(REPO_ROOT, 'scripts', 'setup');
const WIN_SCRIPT = path.join(SETUP_DIR, 'setup-windows.bat');
const RESURRECT_CMD = path.join(SETUP_DIR, 'windows', 'pm2-resurrect.cmd');

const WIN = fs.readFileSync(WIN_SCRIPT, 'utf8');
const VOLTA_SHIM = String.raw`scoop\apps\volta\current\appdata\bin`;

describe('Windows pm2 auto-start registers in user scope (R12.4)', () => {
  it('registers a logon Scheduled Task via schtasks', () => {
    expect(WIN).toMatch(/schtasks\s+\/create/i);
    expect(WIN).toMatch(/\/sc\s+onlogon/i);
  });

  it('uses /rl limited (user scope) and never elevates', () => {
    expect(WIN).toMatch(/\/rl\s+limited/i);
    expect(WIN).not.toMatch(/\/rl\s+highest/i);
    expect(WIN).not.toMatch(/\brunas\b/i);
  });

  it('drops the flaky HKCU Run-key startup hook entirely', () => {
    expect(WIN).not.toMatch(/pm2-windows-startup/);
    expect(WIN).not.toMatch(/pm2-startup\s+install/);
  });

  it('registers the task with an absolute path to the resurrect wrapper', () => {
    // %SETUP_ROOT% is the absolute %~dp0 dir, so this resolves to an absolute path.
    expect(WIN).toMatch(/set\s+"PM2_RESURRECT_CMD=%SETUP_ROOT%windows\\pm2-resurrect\.cmd"/i);
    expect(WIN).toContain('/tr "\\"%PM2_RESURRECT_CMD%\\""');
    expect(fs.existsSync(RESURRECT_CMD)).toBe(true);
  });
});

describe('pm2-resurrect.cmd readies PATH before invoking pm2 (R10.1, R10.4)', () => {
  const cmd = fs.readFileSync(RESURRECT_CMD, 'utf8');

  it('pins PM2_HOME to the same dir start/save use (R10.1)', () => {
    expect(cmd).toContain('set "PM2_HOME=%USERPROFILE%\\.pm2"');
  });

  it('sets PATH with the Volta shim dir so pm2/node resolve in the logon context', () => {
    expect(cmd).toMatch(/set\s+"PATH=[^"]*scoop\\apps\\volta\\current\\appdata\\bin/i);
  });

  it('puts the Volta shim dir on PATH BEFORE it calls pm2', () => {
    // Compare executable lines only — REM comments mention pm2/Volta in prose.
    const lines = cmd.split(/\r?\n/);
    const isComment = (l: string) => /^\s*REM\b/i.test(l);
    const pathLine = lines.findIndex(
      (l) => !isComment(l) && /set\s+"PATH=/i.test(l) && l.includes(VOLTA_SHIM),
    );
    const resurrectLine = lines.findIndex(
      (l) => !isComment(l) && /^\s*pm2\s+resurrect\b/i.test(l),
    );
    expect(pathLine).toBeGreaterThanOrEqual(0);
    expect(resurrectLine).toBeGreaterThanOrEqual(0);
    expect(pathLine).toBeLessThan(resurrectLine);
  });

  it('logs and exits 0 when there is no saved dump (nothing to resurrect)', () => {
    expect(cmd).toMatch(/dump\.pm2/i);
    expect(cmd).toMatch(/exit\s+\/b\s+0/i);
  });
});
