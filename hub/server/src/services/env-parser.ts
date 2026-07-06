import type { EnvEntry } from '@hub/shared';

/**
 * Parse a `.env`-style string into key/value entries.
 *
 * Single source of truth for env parsing across the hub server.
 * Behavior:
 *   - Trims keys/values.
 *   - Strips a single pair of surrounding `"` or `'` quotes from values.
 *   - Treats the line just before a key=value (when it is a `# comment`) as
 *     that entry's `comment` annotation. Used by the env editor UI.
 *   - Strips an inline `# comment` off the value (quote-aware) and uses it as
 *     the `comment` annotation when there is no preceding-line comment.
 *   - Skips blank lines and standalone comments.
 *   - Lines without `=` are ignored.
 */
export function parseEnv(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  let pendingComment: string | undefined;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) {
      pendingComment = undefined;
      continue;
    }
    if (line.startsWith('#')) {
      pendingComment = line.slice(1).trim();
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;
    const rawValue = line.slice(eqIdx + 1).trim();
    const { value: unquotedRaw, inlineComment } = splitInlineComment(rawValue);
    const value = stripQuotes(unquotedRaw);
    const comment = pendingComment ?? inlineComment;
    entries.push({
      key,
      value,
      fromTemplate: false,
      ...(comment ? { comment } : {}),
    });
    pendingComment = undefined;
  }
  return entries;
}

/** Convenience helper: parse and reduce to a plain {key: value} record. */
export function parseEnvToRecord(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of parseEnv(content)) out[e.key] = e.value;
  return out;
}

/** Strip a single matched pair of surrounding single or double quotes. */
function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Split an inline `# comment` off a raw value.
 *   - Quoted value (`"..."` / `'...'`): the value ends at the closing quote;
 *     anything after (e.g. `  # note`) is the inline comment. A `#` INSIDE the
 *     quotes is preserved as part of the value.
 *   - Unquoted value: a `#` that starts the line or is preceded by whitespace
 *     begins the comment (so `host#1` stays a value, but `host # note` splits).
 */
function splitInlineComment(rawValue: string): { value: string; inlineComment?: string } {
  if (rawValue.length === 0) return { value: '' };

  const quote = rawValue[0];
  if (quote === '"' || quote === "'") {
    const closeIdx = rawValue.indexOf(quote, 1);
    if (closeIdx !== -1) {
      const rest = rawValue.slice(closeIdx + 1).trim();
      const inlineComment = rest.startsWith('#') ? rest.slice(1).trim() : undefined;
      return {
        value: rawValue.slice(0, closeIdx + 1),
        ...(inlineComment ? { inlineComment } : {}),
      };
    }
    return { value: rawValue };
  }

  for (let i = 0; i < rawValue.length; i++) {
    if (rawValue[i] === '#' && (i === 0 || /\s/.test(rawValue[i - 1] ?? ''))) {
      return { value: rawValue.slice(0, i).trim(), inlineComment: rawValue.slice(i + 1).trim() };
    }
  }
  return { value: rawValue };
}
