// ============================================================================
// Tools
// ============================================================================

/**
 * Validated kebab-case tool id. Branded so a bare `string` is not silently
 * assigned where a tool id is expected, while still accepting ANY
 * manifest-declared tool — it is no longer a closed union. Mirrors the
 * branded `ToolId` in `scripts/manifests/types.ts` and the server's `SAFE_ID`.
 */
export type ToolId = string & { readonly __brand?: 'ToolId' };

/** Short alias used in `task <alias>:run-local`, e.g. 'pw'. */
export type ToolAlias = string & { readonly __brand?: 'ToolAlias' };

/** Identifier pattern (same as the server `SAFE_ID`). */
export const TOOL_ID_RE = /^[a-z][a-z0-9-]+$/;

/** Runtime guard: is `value` a structurally valid tool id? */
export function isToolId(value: string): value is ToolId {
  return TOOL_ID_RE.test(value);
}
