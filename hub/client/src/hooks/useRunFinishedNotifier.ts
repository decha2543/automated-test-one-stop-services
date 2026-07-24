import type { RunRecord, WsServerEvent } from '@hub/shared';
import { useCallback, useEffect, useRef } from 'react';
import { notifyRunFinished } from '~/hooks/useDesktopNotification.js';
import { useT } from '~/i18n/index.js';

/**
 * App-level desktop notification for interactive run completion.
 *
 * The per-session socket in `RunSession` only exists while the Run page is
 * open, so a run that finished while the user was on another page never raised
 * an OS notification (the reported bug). This hook is mounted once in the app
 * shell and keeps a socket alive on every page.
 *
 * The server forwards `run-finished` only to sockets subscribed to that run
 * (ws.ts), while `run-started` is broadcast to all. So this socket subscribes
 * to (a) every run announced via `run-started`, and (b) every currently-active
 * run (with `replay`, to catch one that just finished). `notifyRunFinished`
 * no-ops unless the desktop toggle is on and the tab is hidden, so it never
 * competes with RunSession's in-app toast/sound.
 */
export function useRunFinishedNotifier(activeRuns: RunRecord[]): void {
  const t = useT();
  const socketRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const notifiedRef = useRef<Set<string>>(new Set());
  const activeRunsRef = useRef<RunRecord[]>(activeRuns);
  activeRunsRef.current = activeRuns;

  const subscribe = useCallback((runId: string, replay: boolean) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN && !subscribedRef.current.has(runId)) {
      ws.send(JSON.stringify({ kind: 'subscribe', runId, replay }));
      subscribedRef.current.add(runId);
    }
  }, []);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handleMessage = (ev: MessageEvent) => {
      let msg: WsServerEvent;
      try {
        msg = JSON.parse(String(ev.data)) as WsServerEvent;
      } catch {
        return;
      }
      if (msg.kind === 'run-started') {
        subscribe(msg.runId, false);
        return;
      }
      if (msg.kind !== 'run-finished' || notifiedRef.current.has(msg.runId)) return;
      const { status, request } = msg.record;
      if (status !== 'passed' && status !== 'failed') return;
      notifiedRef.current.add(msg.runId);
      notifyRunFinished({
        title: status === 'passed' ? t('run.testPassed') : t('run.testFailed'),
        body: request.project,
        tag: `run-${msg.runId}`,
      });
    };

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = ws;
      ws.onopen = () => {
        // A fresh connection has no server-side subscriptions — re-subscribe to
        // whatever is currently active (replay catches a just-finished run).
        subscribedRef.current.clear();
        for (const run of activeRunsRef.current) subscribe(run.id, true);
      };
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        if (!closed) reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [t, subscribe]);

  // Subscribe to active runs as the poll surfaces them (covers a run already in
  // flight when this hook mounted). Idempotent via `subscribedRef`.
  useEffect(() => {
    for (const run of activeRuns) subscribe(run.id, true);
  }, [activeRuns, subscribe]);
}
