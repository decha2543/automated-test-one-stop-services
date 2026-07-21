import type { WsClientEvent, WsServerEvent } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { runner } from '../services/runner.js';

/** Ping each socket on this interval; terminate one that misses a pong so a
 *  half-open connection can't leak its runner 'event' listener forever. */
const HEARTBEAT_MS = 30_000;

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  // Each connection adds one runner 'event' listener (removed on close). The UI
  // opens several sockets (one per run session + dashboard), which exceeds the
  // default EventEmitter cap of 10 and logs a spurious MaxListenersExceeded
  // warning. Listener count is bounded by live sockets, so lift the cap.
  runner.setMaxListeners(0);

  app.get('/ws', { websocket: true }, (socket) => {
    const subscriptions = new Set<string>();

    // Heartbeat: detect and reap dead/half-open sockets so their listener +
    // interval are cleaned up instead of accumulating.
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      try {
        socket.ping();
      } catch {
        /* socket already closing */
      }
    }, HEARTBEAT_MS);

    function onEvent(event: WsServerEvent): void {
      // Broadcast schedule-finished to every socket regardless of
      // subscription so a Corner_Toast can show on any page (R9.1/R9.2).
      // Otherwise only forward events the client subscribed to, plus the
      // global run-started announcement.
      if (
        event.kind === 'schedule-finished' ||
        event.kind === 'run-started' ||
        subscriptions.has(event.runId)
      ) {
        socket.send(JSON.stringify(event));
      }
    }

    runner.on('event', onEvent);

    socket.on('message', (raw: { toString(): string }) => {
      try {
        const msg = JSON.parse(String(raw)) as WsClientEvent;
        if (msg.kind === 'subscribe') {
          subscriptions.add(msg.runId);
          // Opt-in catch-up replay (fresh runs set `replay`). A fast-finishing
          // run can complete before this subscribe lands, so its live
          // stdout/stderr and `run-finished` were never delivered to this
          // socket. Replay the buffered output, then the terminal event if it
          // has already finished. The handler runs synchronously, so no live
          // chunk interleaves between reading the buffer and registering the
          // subscription — nothing is duplicated. The reconnect path omits
          // `replay` because it already fetched `/output` over HTTP.
          if (msg.replay) {
            const buffered = runner.getOutputBuffer(msg.runId);
            if (buffered) {
              socket.send(
                JSON.stringify({ kind: 'run-stdout', runId: msg.runId, chunk: buffered }),
              );
            }
            const finished = runner.getFinishedRecord(msg.runId);
            if (finished) {
              socket.send(
                JSON.stringify({ kind: 'run-finished', runId: msg.runId, record: finished }),
              );
            }
          }
        } else if (msg.kind === 'cancel') {
          runner.cancel(msg.runId);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      runner.off('event', onEvent);
    });
  });
}

export default wsRoutes;
