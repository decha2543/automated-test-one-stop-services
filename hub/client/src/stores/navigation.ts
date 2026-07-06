import type { RunRequest } from '@hub/shared';
import { create } from 'zustand';

/**
 * Cross-route navigation state.
 * Holds ephemeral data that needs to survive route transitions
 * (e.g. quick-run config passed from Dashboard/Spotlight → Run page).
 */
interface NavigationStore {
  pendingRunConfig: RunRequest | null;
  setPendingRunConfig: (config: RunRequest | null) => void;
  consumePendingRunConfig: () => RunRequest | null;
}

export const useNavigationStore = create<NavigationStore>()((set, get) => ({
  pendingRunConfig: null,
  setPendingRunConfig: (config) => set({ pendingRunConfig: config }),
  consumePendingRunConfig: () => {
    const config = get().pendingRunConfig;
    set({ pendingRunConfig: null });
    return config;
  },
}));
