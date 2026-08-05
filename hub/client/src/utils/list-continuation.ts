/**
 * List continuation for the multi-line test-case fields.
 *
 * Test Steps / Expected Result are written as numbered steps or bullets. Typing
 * the next marker by hand on every line is the tedious part, so pressing Enter
 * continues the list the line already started.
 */

/** A recognised list marker on one line, and what should start the next line. */
interface Marker {
  /** Text to insert after the newline. */
  next: string;
  /** The matched marker, so an "empty item" can be detected. */
  matched: string;
}

// `1. ` / `1) ` — an ordered item. The number is incremented on continuation.
const ORDERED_RE = /^(\s*)(\d+)([.)])(\s+)/;
// `• ` / `- ` / `* ` — an unordered item. The same marker repeats.
const BULLET_RE = /^(\s*)([•\-*])(\s+)/;

/**
 * What the next line should begin with, given the line Enter was pressed on.
 * Returns null when that line is not a list item.
 */
export function nextMarkerFor(line: string): Marker | null {
  const ordered = line.match(ORDERED_RE);
  if (ordered) {
    const [matched, indent = '', digits = '0', dot = '.', gap = ' '] = ordered;
    return { next: `${indent}${Number(digits) + 1}${dot}${gap}`, matched };
  }
  const bullet = line.match(BULLET_RE);
  if (bullet) {
    const [matched, indent = '', mark = '-', gap = ' '] = bullet;
    return { next: `${indent}${mark}${gap}`, matched };
  }
  return null;
}

/** The value + caret position produced by pressing Enter inside a text field. */
export interface EnterResult {
  value: string;
  caret: number;
}

/**
 * Insert a newline at `caret`, continuing a list when the current line is one.
 *
 * Pressing Enter on an EMPTY item (just the marker) ends the list instead of
 * adding another blank bullet — the same escape every editor uses, so the user
 * never has to reach for backspace to get out.
 */
export function applyEnter(value: string, caret: number): EnterResult {
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  const lineStart = before.lastIndexOf('\n') + 1;
  const currentLine = before.slice(lineStart);
  const marker = nextMarkerFor(currentLine);

  if (marker && currentLine.trimEnd() === marker.matched.trimEnd()) {
    // Empty item: drop the marker and break out of the list.
    const cleared = `${value.slice(0, lineStart)}\n${after}`;
    return { value: cleared, caret: lineStart + 1 };
  }

  const insert = marker ? `\n${marker.next}` : '\n';
  return { value: `${before}${insert}${after}`, caret: caret + insert.length };
}
