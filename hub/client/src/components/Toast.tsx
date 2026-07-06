import { notifications } from '@mantine/notifications';

/** Stable short hash for deduplicating notifications by content. */
function toastId(message: string, color: string): string {
  let h = 0;
  for (let i = 0; i < message.length; i++) {
    h = (h << 5) - h + message.charCodeAt(i);
    h |= 0;
  }
  return `t_${color}_${h}`;
}

/**
 * Bridge to Mantine notifications, preserving prior `toast.*` API.
 * Identical messages of the same color collapse instead of stacking — unless
 * the caller passes an explicit `opts.id`. Callers that fire on a repeating
 * event with an identical message (e.g. "Test passed (myproject)" every run of
 * the same project) MUST pass a unique id (e.g. the runId); otherwise the
 * content-hash id collides and Mantine re-shows the same toast, resetting its
 * autoClose timer so it appears stuck until closed manually.
 */
export const toast = {
  success: (message: string, opts?: { id?: string }) =>
    notifications.show({
      id: opts?.id ?? toastId(message, 'green'),
      message,
      color: 'green',
      autoClose: 4000,
    }),
  error: (message: string, opts?: { id?: string }) =>
    notifications.show({
      id: opts?.id ?? toastId(message, 'red'),
      message,
      color: 'red',
      autoClose: 5000,
    }),
  info: (message: string, opts?: { id?: string }) =>
    notifications.show({
      id: opts?.id ?? toastId(message, 'blue'),
      message,
      color: 'blue',
      autoClose: 4000,
    }),
};

/** Mantine renders notifications via <Notifications /> in main.tsx, so this is a no-op */
export function ToastContainer() {
  return null;
}
