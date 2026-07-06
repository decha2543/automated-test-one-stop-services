// scripts/manifests/discover.ts
//
// Manifest discovery. Scans `tools/*/tool.manifest.json`, skipping hidden
// folders (names starting with `.`), and returns the matching paths in a
// stable sorted order. Deterministic ordering is a correctness property
// — consumers must never depend on the
// filesystem's inode iteration order. See design §4.1.2.
import * as fs from 'node:fs';
import * as path from 'node:path';

/** File name every tool manifest uses, sitting at `tools/<id>/`. */
export const MANIFEST_FILENAME = 'tool.manifest.json';

/**
 * Suffix marking a directory as a non-scanned template, not a real tool.
 * Mirrors the project-level `*-template-example` exclusion convention so a
 * shared scaffold (e.g. `tools/tool-template-example/`) ships in the repo as a
 * reference without being discovered, listed, or scanned as an installable tool.
 */
export const TEMPLATE_EXAMPLE_SUFFIX = '-template-example';

/**
 * Discover every `tools/<id>/tool.manifest.json` under `workspaceRoot`.
 *
 * - Folders whose name starts with `.` are excluded (req 2.1).
 * - Folders whose name ends with `-template-example` are excluded — they are
 * shared scaffolds, not real tools.
 * - Only directories that actually contain a manifest file are returned.
 * - Sorted by folder id (the `<id>` segment) so repeated scans of the same
 * workspace yield an identical list regardless of directory-entry order
 * (req 2.2). The sort runs on the bare folder name, NOT the full path:
 * sorting full paths is OS-dependent because the separator that follows the
 * id differs by code point (`/`=47 on POSIX, `\`=92 on Windows), so a prefix
 * pair like `p` / `p0` would order differently per OS (`0`=48 sits between
 * the two separators). Sorting the id alone is deterministic everywhere.
 * - A missing `tools/` directory yields an empty list rather than throwing.
 */
export function discoverManifestPaths(workspaceRoot: string): string[] {
  const toolsDir = path.join(workspaceRoot, 'tools');
  if (!fs.existsSync(toolsDir)) return [];

  return fs
    .readdirSync(toolsDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() && !d.name.startsWith('.') && !d.name.endsWith(TEMPLATE_EXAMPLE_SUFFIX),
    )
    .map((d) => d.name)
    .sort()
    .map((name) => path.join(toolsDir, name, MANIFEST_FILENAME))
    .filter((p) => fs.existsSync(p));
}

/**
 * The tool ids present under `tools/` — the folder name of every directory
 * `discoverManifestPaths()` returns. This is the single folder-presence source
 * consumed by the Doctor (gating checks, design §C6) and the root `Setup_Task`
 * (delegation loop, design §C1) so neither re-implements an `fs` scan.
 *
 * Inherits `discoverManifestPaths()`'s exclusions and stable sort (req 6.2):
 * `.`-prefixed and `*-template-example` folders never appear, and the list is
 * sorted by folder id independently of filesystem iteration order. Because the
 * underlying sort already runs on the `<id>` segment, mapping each path back to
 * its `basename(dirname(...))` preserves that id ordering directly.
 */
export function discoverToolIds(workspaceRoot: string): string[] {
  return discoverManifestPaths(workspaceRoot).map((p) => path.basename(path.dirname(p)));
}

/**
 * Folder-presence predicate: is tool `id` provisioned under `tools/`?
 *
 * Shared gating primitive (req 6.2). A tool counts as present **iff** its folder
 * is discovered by `discoverManifestPaths()` — it holds a `tool.manifest.json`
 * and is neither `.`-prefixed nor a `*-template-example` scaffold. Consumers
 * (Doctor §C6, `Setup_Task` §C1) call this instead of each re-scanning `tools/`,
 * so presence stays consistent with discovery rather than diverging.
 *
 * ponytail: each call re-scans `tools/` (one `readdirSync`). For the Doctor's
 * handful of checks that cost is negligible; a consumer doing many lookups
 * should call `discoverToolIds()` once and test membership against a `Set`.
 */
export function isToolPresent(workspaceRoot: string, id: string): boolean {
  return discoverToolIds(workspaceRoot).includes(id);
}
