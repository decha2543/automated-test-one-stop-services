import path from 'node:path';
import { OUTPUTS_DIR, WORKSPACE_ROOT } from '../config.js';

/** True when `target` resolves under `root` (handles `..` traversal attempts). */
export function isUnder(root: string, target: string): boolean {
  const rootR = path.resolve(root);
  const targetR = path.resolve(target);
  if (targetR === rootR) return true;
  return targetR.startsWith(rootR + path.sep);
}

/** Convenience guard for the outputs/ tree (the most common security boundary). */
export function isUnderOutputs(target: string): boolean {
  return isUnder(OUTPUTS_DIR, target);
}

/** Convenience guard for anything inside the workspace root. */
export function isUnderWorkspace(target: string): boolean {
  return isUnder(WORKSPACE_ROOT, target);
}
