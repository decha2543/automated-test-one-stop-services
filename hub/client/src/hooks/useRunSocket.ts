import type { RunStatus, WsServerEvent } from '@hub/shared';
import { useCallback, useEffect, useRef } from 'react';
import { api } from '~/api/client.js';
import { toast } from '~/components/Toast.js';
import { playFailureSound, playSuccessSound } from '~/hooks/useNotificationSound.js';
import type { RunTerminal } from '~/hooks/useRunTerminal.js';
import type { TranslationKey } from '~/i18n/en';
import { parseRunSummary, type RunSummary } from '~/utils/parse-run-summary.js';

interface UseRunSocketOptions {
  /** Terminal API to write live output into. */
  term: RunTerminal;
  /** Ref holding the run id this session is currently listening for. */
  activeRunIdRef: React.RefObject<string | null>;
  /** Accumulates the full stdout/stderr stream for summary parsing. */
  fullOutputRef: React.MutableRefObject<string>;
  setRunStatus: (status: RunStatus | 'idle') => void;
  setRunSummary: (summary: RunSummary | null) => void;
  setActiveRunId: (id: string | null) => void;
  setLastCommand: (command: string) => void;
  /** Present when this session was created to reconnect to an in-flight run. */
  reconnectRunId?: string;
  reconnectCommand?: string;
  t: (key: TranslationKey) => string;
}

/**
 * Owns the per-session WebSocket: connection lifecycle, server-event routing
 * (stdout/stderr/started/finished), and reconnection to an in-flight run after
 * a page reload. Extracted from RunSession so the socket/terminal plumbing is
 * isolated from the component's form state.
 *
 * Returns `send`, a thin wrapper that JSON-encodes control messages
 * (subscribe/cancel) to the server.
 */
export function useRunSocket({
  term,
  activeRunIdRef,
  fullOutputRef,
  setRunStatus,
  setRunSummary,
  setActiveRunId,
  setLastCommand,
  reconnectRunId,
  reconnectCommand,
  t,
}: UseRunSocketOptions): { send: (data: object) => void } {
  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((data: object) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  // WebSocket per session (connect once on mount).
  // biome-ignore lint/correctness/useExhaustiveDependencies: connect exactly once; handler reads live refs, not deps.
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WsServerEvent;
      if (!term.ready()) return;
      switch (msg.kind) {
        case 'run-started':
          if (msg.runId === activeRunIdRef.current) {
            setRunStatus('running');
          }
          break;
        case 'run-stdout':
          if (msg.runId === activeRunIdRef.current) {
            term.write(msg.chunk);
            fullOutputRef.current += msg.chunk;
          }
          break;
        case 'run-stderr':
          if (msg.runId === activeRunIdRef.current) {
            term.write(`\x1b[31m${msg.chunk}\x1b[0m`);
            fullOutputRef.current += msg.chunk;
          }
          break;
        case 'run-finished':
          if (msg.runId === activeRunIdRef.current) {
            setRunStatus(msg.record.status);
            const summary = parseRunSummary(fullOutputRef.current);
            if (summary) setRunSummary(summary);
            term.writeln(
              `\n\x1b[${msg.record.status === 'passed' ? '32' : '31'}m[${msg.record.status.toUpperCase()}]\x1b[0m Exit code: ${msg.record.exitCode ?? 'N/A'}`,
            );
            if (msg.record.status === 'passed') {
              toast.success(`${t('run.testPassed')} (${msg.record.request.project})`, {
                id: `run-${msg.runId}`,
              });
              playSuccessSound();
            } else if (msg.record.status === 'failed') {
              toast.error(`${t('run.testFailed')} (${msg.record.request.project})`, {
                id: `run-${msg.runId}`,
              });
              playFailureSound();
            } else if (msg.record.status === 'cancelled') {
              toast.info(`${t('run.testCancelled')} (${msg.record.request.project})`, {
                id: `run-${msg.runId}`,
              });
            }
          }
          break;
      }
    };
    return () => {
      ws.close();
    };
  }, []);

  // Reconnect to an active run (after page refresh).
  // biome-ignore lint/correctness/useExhaustiveDependencies: respond only to reconnect target changes; helpers/refs are stable.
  useEffect(() => {
    if (!reconnectRunId) return;
    const runId = reconnectRunId;
    async function doReconnect() {
      setActiveRunId(runId);
      setRunStatus('running');
      setLastCommand(reconnectCommand ?? '');
      try {
        const { output } = (await api.get(`/api/runs/${runId}/output`)) as { output: string };
        if (term.ready()) {
          term.clear();
          term.writeln(`\x1b[32m[Reconnected]\x1b[0m Run ${runId}`);
          if (reconnectCommand) term.writeln(`\x1b[90m$ ${reconnectCommand}\x1b[0m\n`);
          term.write(output);
        }
      } catch {
        setRunStatus('idle');
        if (term.ready()) {
          term.clear();
          term.writeln(`\x1b[33m[Finished]\x1b[0m Run ${runId} has already completed.`);
        }
        return;
      }
      const waitForWs = () => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ kind: 'subscribe', runId }));
        } else {
          setTimeout(waitForWs, 200);
        }
      };
      waitForWs();

      setTimeout(async () => {
        try {
          await api.get(`/api/runs/${runId}/output`);
        } catch {
          setRunStatus('idle');
          term.writeln(`\n\x1b[33m[Finished]\x1b[0m Run completed while reconnecting.`);
        }
      }, 2000);
    }
    const timer = setTimeout(doReconnect, 600);
    return () => clearTimeout(timer);
  }, [reconnectRunId, reconnectCommand]);

  return { send };
}
