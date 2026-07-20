/**
 * Re-export of the shared run-summary parser.
 *
 * The implementation moved to `@hub/shared` so the server can reuse it verbatim
 * (it now persists the summary at run-finish). This thin re-export keeps the
 * client's existing `~/utils/parse-run-summary.js` import path stable.
 */
export { parseRunSummary, type RunSummary } from '@hub/shared';
