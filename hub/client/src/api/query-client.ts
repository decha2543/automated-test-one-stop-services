import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from '~/components/Toast.js';

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
