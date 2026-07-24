import { describe, expect, it } from 'vitest';
import { shouldNotify, useDesktopNotification } from '../useDesktopNotification.js';

describe('shouldNotify', () => {
  const base: {
    enabled: boolean;
    supported: boolean;
    permission: NotificationPermission | 'unsupported';
    hidden: boolean;
  } = { enabled: true, supported: true, permission: 'granted', hidden: true };

  it('allows only when enabled + supported + granted + tab hidden', () => {
    expect(shouldNotify(base)).toBe(true);
  });

  it('blocks when the feature is disabled', () => {
    expect(shouldNotify({ ...base, enabled: false })).toBe(false);
  });

  it('blocks when the Notifications API is unsupported', () => {
    expect(shouldNotify({ ...base, supported: false, permission: 'unsupported' })).toBe(false);
  });

  it('blocks when permission is not granted', () => {
    expect(shouldNotify({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'default' })).toBe(false);
  });

  it('blocks when the tab is focused (avoids redundant noise)', () => {
    expect(shouldNotify({ ...base, hidden: false })).toBe(false);
  });
});

describe('useDesktopNotification store', () => {
  // Read-only: the mutators are trivial zustand boilerplate, and calling them
  // here would trigger the persist middleware's localStorage.setItem, which is
  // not wired in this test environment. The meaningful invariant is opt-in.
  it('defaults to off (opt-in)', () => {
    expect(useDesktopNotification.getState().enabled).toBe(false);
  });
});
