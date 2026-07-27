// ============================================================================
// Tools
// ============================================================================

/**
 * Validated kebab-case tool id. Branded so a bare `string` is not silently
 * assigned where a tool id is expected, while still accepting ANY
 * manifest-declared tool — it is no longer a closed union. Mirrors the
 * branded `ToolId` in `scripts/manifests/types.ts`.
 *
 * Validation lives where a value actually crosses a trust boundary: the server
 * checks every incoming id against `SAFE_ID` (`server/src/lib/safe-id.ts`)
 * before it reaches the filesystem, git, or a shell. This package deliberately
 * does not ship a second copy of that pattern — the client only ever passes ids
 * it received from `/api/tools`.
 */
export type ToolId = string & { readonly __brand?: 'ToolId' };
