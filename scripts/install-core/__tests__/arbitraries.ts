// scripts/install-core/__tests__/arbitraries.ts
//
// fast-check arbitraries + a spy effects factory for the install-core property
// tests (install-and-provisioning-overhaul, Property 9 / Property 10). Generators
// constrain to the relevant input space: valid/invalid SAFE_IDs and git URLs, and
// the set of requests that MUST be rejected at the `validate` stage.

import * as fc from 'fast-check';
import type { InstallEffects, InstallRequest } from '../pipeline.js';
import { SAFE_GIT_URL, SAFE_ID } from '../validation.js';

/** Valid SAFE_ID tool ids: lowercase start, then `[a-z0-9-]`, length ≥ 2. */
export const arbValidToolId: fc.Arbitrary<string> = fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/);

/**
 * Strings that FAIL SAFE_ID: known bad shapes (empty, single char, uppercase,
 * leading digit/dash/dot, traversal, whitespace, shell metacharacters) plus
 * random strings filtered to be non-matching.
 */
export const arbInvalidToolId: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    '',
    'a',
    'A',
    'Foo',
    '1tool',
    '-tool',
    '.hidden',
    '../etc',
    'a b',
    'a;rm',
    'tool/',
    'tool$x',
  ),
  fc.string().filter((s) => !SAFE_ID.test(s)),
);

/** Valid SAFE_GIT_URL values across the accepted forms. */
export const arbValidGitUrl: fc.Arbitrary<string> = fc.constantFrom(
  'https://example.com/org/repo.git',
  'https://gitlab.com/group/sub/repo.git',
  'git@github.com:org/repo.git',
  'ssh://git@host.example/org/repo.git',
);

/**
 * Strings that FAIL SAFE_GIT_URL: wrong scheme, whitespace, shell metacharacters,
 * empty, plus random strings filtered to be non-matching.
 */
export const arbInvalidGitUrl: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    '',
    'http://insecure.example/repo.git',
    'ftp://host/repo',
    'file:///etc/passwd',
    'https://exa mple.com/repo.git',
    'https://host/repo.git; rm -rf /',
    'git@host repo',
    'javascript:alert(1)',
  ),
  fc.string().filter((s) => !SAFE_GIT_URL.test(s)),
);

/** A safe ref to pair with registry sources (ref validation is out of P10 scope). */
const arbRef: fc.Arbitrary<string> = fc.constantFrom('main', 'v1.0.0', 'develop');

/**
 * Requests that MUST be rejected at the `validate` stage before ANY side effect
 * (Property 10): an invalid id (registry or local source), or a valid id with an
 * invalid registry git URL.
 */
export const arbRejectableRequest: fc.Arbitrary<InstallRequest> = fc.oneof(
  fc.record({
    id: arbInvalidToolId,
    source: fc.record({
      kind: fc.constant('registry' as const),
      gitUrl: arbValidGitUrl,
      ref: arbRef,
    }),
  }),
  fc.record({
    id: arbInvalidToolId,
    source: fc.constant({ kind: 'local' as const }),
  }),
  fc.record({
    id: arbValidToolId,
    source: fc.record({
      kind: fc.constant('registry' as const),
      gitUrl: arbInvalidGitUrl,
      ref: arbRef,
    }),
  }),
);

/**
 * A spy `InstallEffects` that records every call by name. Used by Property 10 to
 * assert ZERO side-effecting calls happen when a request is rejected at validate.
 */
export function makeSpyEffects(): { effects: InstallEffects; calls: string[] } {
  const calls: string[] = [];
  const effects: InstallEffects = {
    cloneRegistry: (input) => {
      calls.push(`cloneRegistry:${input.id}`);
    },
    gatherFacts: (id) => {
      calls.push(`gatherFacts:${id}`);
      return { id, hasPackageJson: false, isUvTool: false, hasSetupTask: false };
    },
    installDeps: (input) => {
      calls.push(`installDeps:${input.manager}`);
    },
    runSetup: (input) => {
      calls.push(`runSetup:${input.id}`);
      return { id: input.id, exitCode: 0 };
    },
  };
  return { effects, calls };
}

// =============================================================================
// Playwright provisioning decision (Property 5) + Core non-fatality (Property 6)
// =============================================================================

/** A browser revision token, as parsed from `playwright install --dry-run`. */
const arbRevision: fc.Arbitrary<string> = fc.stringMatching(/^[0-9]{3,4}$/);

/** A non-blank mirror host value (any non-blank string triggers the mirror path). */
const arbMirrorHost: fc.Arbitrary<string> = fc.constantFrom(
  'https://mirror.internal',
  'http://10.0.0.5:8080',
  'mirror.local',
);

/**
 * Random provision inputs for Property 5, constrained to EXERCISE every branch:
 *  - `mirrorHost`: null / blank (unset) or a non-blank host (mirror path);
 *  - `presentRevision`: absent (null), matching the required revision (reuse), or
 *    a guaranteed-different value (reprovision) — so reuse / reprovision / archive
 *    are all reached, not just statistically.
 */
export const arbProvisionInputs: fc.Arbitrary<ProvisionInputs> = fc
  .record({
    mirrorHost: fc.oneof(fc.constant(null), fc.constant(''), fc.constant('   '), arbMirrorHost),
    requiredRevision: arbRevision,
    presentKind: fc.constantFrom('absent', 'match', 'mismatch'),
    otherRevision: arbRevision,
  })
  .map(({ mirrorHost, requiredRevision, presentKind, otherRevision }) => {
    let presentRevision: string | null;
    if (presentKind === 'absent') {
      presentRevision = null;
    } else if (presentKind === 'match') {
      presentRevision = requiredRevision;
    } else {
      // `-x` suffix guarantees inequality with a pure-numeric requiredRevision.
      presentRevision = `${otherRevision}-x`;
    }
    return { mirrorHost, requiredRevision, presentRevision };
  });

/** Random browser-provisioning outcomes for Property 6, including failures. */
export const arbBrowserProvisionOutcome: fc.Arbitrary<BrowserProvisionOutcome> = fc.oneof(
  fc.record({ ok: fc.constant(true) }),
  fc.record({ ok: fc.constant(false), message: fc.string({ minLength: 1 }) }),
);
