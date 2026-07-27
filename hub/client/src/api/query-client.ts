import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from '~/components/Toast.js';
import { translate } from '~/i18n/index.js';

/**
 * Global QueryClient. Extracted from `main.tsx` so that the router's route
 * loaders (defined in `router.tsx`) can prefetch into the same cache the
 * React tree reads from. Sharing one instance is what lets a route `loader`
 * warm a query before the page component mounts — eliminating the
 * render-then-fetch waterfall.
 *
 * Mutations without an explicit `onError` automatically surface failures via
 * the toast helper so screens never silently fail.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    // A failed READ used to be invisible: the page just rendered its empty
    // state, telling the user "you have nothing" when the truth was "the
    // server did not answer". Announce it once per query (React Query only
    // fires this on a fresh failure, not on every retry) and let pages add
    // their own inline `ErrorState` where a retry button belongs.
    onError: (error, query) => {
      if (query.options.meta?.silentError) return;
      const detail = error instanceof Error ? error.message : '';
      toast.error(
        detail ? `${translate('error.loadFailed')}: ${detail}` : translate('error.loadFailed'),
        {
          id: `query-error-${String(query.queryKey[0] ?? 'unknown')}`,
        },
      );
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Per-mutation onError handlers still run; only show a fallback toast
      // when no handler exists for that mutation.
      if (!mutation.options.onError) {
        const message = error instanceof Error ? error.message : 'Mutation failed';
        toast.error(message);
      }
    },
  }),
});
