// scripts/manifests/__tests__/android-decoupling.spec.ts
//
// Presence check for Task 4 of the install-and-provisioning-overhaul spec:
//  - The workspace exposes a single opt-in `task setup-android` target that
//    delegates to BOTH platform helpers (R3.2).
//  - Neither Core installer flow installs Android: no opt-in gate, no SDK/
//    emulator install commands, no helper invocation — Android is referenced
//    only as a one-line pointer to `task setup-android` (R3.1).
//  - Provisioning is REAL and SYMMETRIC: both platform helpers bootstrap the
//    cmdline-tools, install via sdkmanager, and create the QA_Emulator AVD via
//    avdmanager — equivalent actions on Windows and macOS/Linux (R3.3, R3.4).
//
// Validates: Requirements 3.1, 3.2 (with R3.3/R3.4 helper-parity guards)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SETUP_DIR = path.join(REPO_ROOT, 'scripts', 'setup');

const TASKFILE = fs.readFileSync(path.join(REPO_ROOT, 'Taskfile.yml'), 'utf8');
const WIN = fs.readFileSync(path.join(SETUP_DIR, 'setup-windows.bat'), 'utf8');
const NIX = fs.readFileSync(path.join(SETUP_DIR, 'setup-linux.sh'), 'utf8');

const PS1_PATH = path.join(SETUP_DIR, 'windows', 'set-android-home.ps1');
const SH_PATH = path.join(SETUP_DIR, 'set-android-home.sh');

describe('Android opt-in command exists and delegates (R3.2)', () => {
  it('root Taskfile defines a setup-android target', () => {
    expect(TASKFILE).toMatch(/\n {2}setup-android:/);
  });

  it('setup-android delegates to BOTH platform helpers', () => {
    expect(TASKFILE).toMatch(/set-android-home\.ps1/);
    expect(TASKFILE).toMatch(/set-android-home\.sh/);
  });

  it('both platform helper scripts exist on disk', () => {
    expect(fs.existsSync(PS1_PATH)).toBe(true);
    expect(fs.existsSync(SH_PATH)).toBe(true);
  });
});

describe('Core installer flow contains no Android SDK/emulator install step (R3.1)', () => {
  for (const [label, body] of [
    ['setup-windows.bat', WIN],
    ['setup-linux.sh', NIX],
  ] as const) {
    describe(label, () => {
      it('has no KIRO_ENABLE_ANDROID opt-in install gate', () => {
        expect(body).not.toMatch(/KIRO_ENABLE_ANDROID/);
      });

      it('has no Android API-level provisioning variable', () => {
        expect(body).not.toMatch(/KIRO_ANDROID_API/);
      });

      it('runs no SDK/emulator install commands', () => {
        expect(body).not.toMatch(/sdkmanager|avdmanager/i);
      });

      it('does not invoke the Android provisioning helper', () => {
        expect(body).not.toMatch(/(?:powershell|bash)[^\n]*set-android-home/i);
      });

      it('references Android only as a one-line pointer to task setup-android', () => {
        expect(body).toMatch(/task setup-android/);
      });
    });
  }
});

describe('Provisioning moved into the platform helpers and is REAL + symmetric (R3.3, R3.4)', () => {
  const ps1 = fs.readFileSync(PS1_PATH, 'utf8');
  const sh = fs.readFileSync(SH_PATH, 'utf8');

  it('both helpers install via sdkmanager (not advice-only)', () => {
    expect(ps1).toMatch(/sdkmanager/);
    expect(sh).toMatch(/sdkmanager/);
  });

  it('both helpers bootstrap the cmdline-tools download', () => {
    expect(ps1).toMatch(/commandlinetools-win/);
    expect(sh).toMatch(/commandlinetools-\$\{CLT_OS\}/);
  });

  it('both helpers create the QA_Emulator AVD via avdmanager', () => {
    expect(ps1).toMatch(/avdmanager/i);
    expect(ps1).toMatch(/QA_Emulator/);
    expect(sh).toMatch(/avdmanager/i);
    expect(sh).toMatch(/QA_Emulator/);
  });
});
