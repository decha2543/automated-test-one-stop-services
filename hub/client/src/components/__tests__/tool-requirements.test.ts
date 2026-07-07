import type { DoctorCheck } from '@hub/shared';
import { missingChecksForTool, missingPrerequisites, toolRequiredChecks } from '@hub/shared';
import { describe, expect, it } from 'vitest';

/**
 * Pure requirements model backing the Run-button gate (RunSession) and the
 * ordered install gate (DoctorPanel). Kept as a unit test because RunSession's
 * integration is heavy to render, and this is the non-trivial derivation.
 */
describe('tool run requirements', () => {
  it('derives required checks from runtime + package manager (+ tool assets)', () => {
    expect(
      toolRequiredChecks({ id: 'robot-framework', runtime: 'python', packageManager: 'uv' }).sort(),
    ).toEqual(['python', 'uv']);
    expect(
      toolRequiredChecks({ id: 'playwright', runtime: 'node', packageManager: 'pnpm' }).sort(),
    ).toEqual(['node', 'playwright-browsers', 'pnpm']);
    expect(toolRequiredChecks({ id: 'k6', runtime: 'binary', packageManager: 'none' })).toEqual([
      'k6',
    ]);
  });

  it('flags the tool required checks that are missing or failing', () => {
    const checks: DoctorCheck[] = [
      { name: 'uv', ok: true, category: 'required-install' },
      { name: 'python', ok: false, category: 'required-install' },
    ];
    expect(
      missingChecksForTool({ id: 'robot-framework', runtime: 'python', packageManager: 'uv' }, checks),
    ).toEqual(['python']);
  });

  it('orders installs: python requires uv first', () => {
    const noUv: DoctorCheck[] = [{ name: 'uv', ok: false, category: 'required-install' }];
    expect(missingPrerequisites('python', noUv)).toEqual(['uv']);
    const withUv: DoctorCheck[] = [{ name: 'uv', ok: true, category: 'required-install' }];
    expect(missingPrerequisites('python', withUv)).toEqual([]);
  });
});
