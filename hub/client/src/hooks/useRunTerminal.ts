import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

/**
 * Stable imperative handle to the run terminal. Methods are safe to call before
 * the terminal has mounted (they no-op), so callers don't need to null-check.
 */
export interface RunTerminal {
  writeln: (line: string) => void;
  write: (chunk: string) => void;
  clear: () => void;
  fit: () => void;
  findNext: (term: string) => void;
  findPrevious: (term: string) => void;
  clearSearch: () => void;
  /** True once the underlying xterm instance is mounted and ready. */
  ready: () => boolean;
}

interface UseRunTerminalOptions {
  /** Whether this session's terminal is the visible tab (re-fit on show). */
  visible: boolean;
  /** Any value that, when it changes, should trigger a re-fit (e.g. run status). */
  refitKey: unknown;
}

/**
 * Owns the xterm.js lifecycle for one run session: creation, addon wiring,
 * resize/visibility re-fit, and disposal. Extracted from RunSession so the
 * component orchestrates state while the imperative terminal plumbing lives
 * in one testable, self-contained place.
 *
 * Returns the container ref to attach and a stable `term` API used by the
 * component and the WebSocket hook to write output and drive search.
 */
export function useRunTerminal({ visible, refitKey }: UseRunTerminalOptions): {
  termRef: React.RefObject<HTMLDivElement | null>;
  term: RunTerminal;
} {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  // Stable API object — methods read the live refs so the identity never
  // changes, keeping it safe to pass into other hooks/effects.
  const apiRef = useRef<RunTerminal>({
    writeln: (line) => terminalRef.current?.writeln(line),
    write: (chunk) => terminalRef.current?.write(chunk),
    clear: () => terminalRef.current?.clear(),
    fit: () => fitAddonRef.current?.fit(),
    findNext: (term) => searchAddonRef.current?.findNext(term),
    findPrevious: (term) => searchAddonRef.current?.findPrevious(term),
    clearSearch: () => searchAddonRef.current?.clearDecorations(),
    ready: () => terminalRef.current !== null,
  });

  // Terminal init (once per mount).
  useEffect(() => {
    if (!termRef.current || terminalRef.current) return;
    const term = new Terminal({
      theme: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#e5e5e5' },
      fontSize: 12,
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      convertEol: true,
      scrollback: 5000,
      cursorBlink: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    term.open(termRef.current);
    fitAddon.fit();
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    // biome-ignore lint/security/noSecrets: ANSI escape sequence for terminal output, not a secret
    term.writeln('\x1b[90m[Hub] Ready. Configure and click Run.\x1b[0m');
    const h = () => fitAddon.fit();
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('resize', h);
      // Free xterm resources to avoid leaking DOM nodes when sessions close.
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, []);

  // Re-fit when this tab becomes visible.
  useEffect(() => {
    if (visible) fitAddonRef.current?.fit();
  }, [visible]);

  // Re-fit when the caller signals a layout-affecting change (e.g. run status).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — refit only when refitKey changes.
  useEffect(() => {
    fitAddonRef.current?.fit();
  }, [refitKey]);

  return { termRef, term: apiRef.current };
}
