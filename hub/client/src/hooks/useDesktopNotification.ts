import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DesktopNotificationStore {
  /** Opt-in: OS notifications stay off until the user enables them. */
  enabled: boolean;
  toggle: () => void;
  setEnabled: (value: boolean) => void;
}

/**
 * Persisted toggle for OS-level desktop notifications, mirroring
 * {@link useNotificationSound}. Default off — the browser also needs an
 * explicit permission grant, requested when the user turns this on.
 */
export const useDesktopNotification = create<DesktopNotificationStore>()(
  persist(
    (set) => ({
      enabled: false,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
      setEnabled: (value) => set({ enabled: value }),
    }),
    { name: 'hub-desktop-notification' },
  ),
);

/** True when the browser exposes the Notifications API. */
export function desktopNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Request OS notification permission. Returns the resulting permission, or
 * `'unsupported'` when the API is absent. Never throws.
 */
export async function requestDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!desktopNotificationSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Pure gate for whether a desktop notification should fire — extracted so the
 * decision is unit-testable without the Notifications API or a real DOM.
 *
 * Only notify when the tab is hidden: a focused user already sees the in-app
 * toast and hears the sound, so an OS notification then is redundant noise.
 */
export function shouldNotify(opts: {
  enabled: boolean;
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  hidden: boolean;
}): boolean {
  return opts.enabled && opts.supported && opts.permission === 'granted' && opts.hidden;
}

export interface RunFinishedNotice {
  /** Already-localized title, e.g. "Test passed". */
  title: string;
  /** Notification body — typically the project name. */
  body: string;
  /** Groups/replaces notifications for the same run. */
  tag?: string;
}

/**
 * Fire an OS notification for a finished run when {@link shouldNotify} allows;
 * no-ops otherwise. Clicking the notification focuses the Hub tab.
 */
export function notifyRunFinished(notice: RunFinishedNotice): void {
  const supported = desktopNotificationSupported();
  const permission = supported ? Notification.permission : 'unsupported';
  const allowed = shouldNotify({
    enabled: useDesktopNotification.getState().enabled,
    supported,
    permission,
    hidden: typeof document !== 'undefined' && document.hidden,
  });
  if (!allowed) return;
  try {
    const notification = new Notification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      icon: '/logo.png',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some environments throw when constructing a Notification without an
    // active service worker / user gesture — degrade silently.
  }
}
