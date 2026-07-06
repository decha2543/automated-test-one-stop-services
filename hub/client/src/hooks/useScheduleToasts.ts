import type { WsServerEvent } from '@hub/shared';
import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import {
  buildScheduleToast,
  shouldShowScheduleToast,
} from '~/components/schedule-toast-helpers.js';
import { usePreferences } from '~/stores/hub.js';

/**
 * App-level listener for the `schedule-finished` WebSocket event (Area D).
 *
 * The server broadcasts `schedule-finished` to *every* socket regardless of
 * subscription (ws.ts, task 7.1), so this hook opens its own connection to
 * `/ws` and surfaces a Corner_Toast on any page — independent of the per-run
 * socket owned by `RunSession`. `RunSession` has no `schedule-finished` case,
 * so it ignores the broadcast and there is no double-toast.
 *
 * Behaviour:
 * - Gate via `shouldShowScheduleToast(event, prefs)` — silent schedules whose
 *   per-scheduleId toast preference is disabled produce no toast (R10.5);
 *   a missing entry defaults to enabled (R10.6).
 * - Build the descriptor with `buildScheduleToast(event)` and show it through
 *   Mantine `notifications.show(...)` (passed → success/5s, otherwise
 *   error/10s — R9.1, R9.2, R10.1, R10.2). The toast id is bound to the runId
 *   so concurrent completions render as distinct toasts (R9.6).
 * - Corner_Toast is ephemeral: this never writes to the `useNotifications`
 *   store, localStorage, or run history (R10.4).
 */
export function useScheduleToasts(): void {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    function handleMessage(event: MessageEvent): void {
      let msg: WsServerEvent;
      try {
        msg = JSON.parse(event.data) as WsServerEvent;
      } catch {
        return;
      }
      if (msg.kind !== 'schedule-finished') return;

      // Read prefs lazily so the latest per-scheduleId switch is honoured (R10.5).
      if (!shouldShowScheduleToast(msg, usePreferences.getState())) return;

      const toast = buildScheduleToast(msg);
      // Ephemeral only — do NOT persist to useNotifications/localStorage/history (R10.4).
      notifications.show({
        id: toast.id,
        color: toast.color,
        title: toast.title,
        message: toast.message,
        autoClose: toast.autoClose,
      });
    }

    function connect(): void {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket = ws;
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        if (disposed) return;
        // Keep the app-level toast channel alive across transient drops.
        reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);
}
