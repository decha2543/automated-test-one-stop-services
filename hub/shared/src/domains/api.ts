/**
 * Uniform error envelope every Hub route returns on a non-2xx response.
 *
 * Routes send `{ code, message }` (plus `hint`/`stage` where useful) and the
 * client's axios interceptor reads the same shape, so this type is the single
 * description of the contract instead of each side re-declaring it inline.
 */
export interface ApiError {
  /** Machine-readable code, e.g. `TOOL_NOT_FOUND`. */
  code: string;
  /** Human-readable message safe to surface in the UI. */
  message: string;
  /** Optional remediation hint (doctor / install flows). */
  hint?: string;
  /** Optional failing step of a multi-stage operation (tool install / update). */
  stage?: string;
}
