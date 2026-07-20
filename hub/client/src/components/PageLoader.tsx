import { Center, Loader, Stack, Text } from '@mantine/core';
import { useT } from '~/i18n/index.js';

/**
 * Shared "work in progress" loader shown while a route's data loader or a
 * lazy page chunk is in flight.
 *
 * Why it exists: TanStack Router renders nothing until the initial route's
 * loaders resolve. Without a pending fallback the whole app is a blank dark
 * page during startup (the `/api/doctor` check alone can take seconds), which
 * reads as "the site is down" rather than "loading" (UX_CHECKLIST §3 — never a
 * blank/hung page). Wire this as the router's `defaultPendingComponent` and as
 * the in-shell `Suspense` fallback so a loading state is always visible.
 *
 * - `boot` = full-viewport startup variant (logo + larger spinner), used before
 *   the app shell exists (router `defaultPendingComponent`).
 * - default = compact in-content variant, used inside the shell for lazy chunks.
 */
export function PageLoader({ boot = false }: { boot?: boolean }) {
  const t = useT();
  return (
    <Center h="100%" mih={boot ? '100dvh' : 200} aria-busy="true" aria-live="polite">
      <Stack align="center" gap="sm">
        {boot && <img src="/logo.png" alt="" width={48} height={48} style={{ opacity: 0.9 }} />}
        <Loader size={boot ? 'md' : 'sm'} />
        <Text c="dimmed" size="sm">
          {t('common.loading')}
        </Text>
      </Stack>
    </Center>
  );
}
