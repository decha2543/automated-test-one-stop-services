import { Card, Group, Paper, SimpleGrid, Skeleton, Stack } from '@mantine/core';

/**
 * Shared loading placeholders. Prefer these over a bare spinner: a skeleton that
 * mirrors the real layout makes the app feel instant and intentional instead of
 * "hung/blank" while a query is in flight (UX_CHECKLIST §3 Performance).
 *
 * All are decorative — marked aria-hidden so screen readers announce the real
 * content once it loads, not the placeholder shapes.
 */

/** Vertical list of row cards — matches list pages (Webhooks, Env Profiles, Schedules, Flaky). */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Stack gap="xs" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static placeholder
        <Paper key={i} p="md" withBorder>
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
              <Skeleton height={34} circle />
              <Stack gap={7} style={{ flex: 1 }}>
                <Skeleton height={12} width="35%" radius="sm" />
                <Skeleton height={10} width="62%" radius="sm" />
              </Stack>
            </Group>
            <Skeleton height={26} width={64} radius="sm" />
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

/** Row of stat cards — matches summary metrics (Performance trends, Dashboard totals). */
export function StatCardsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: count }} spacing="xs" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static placeholder
        <Card key={i} withBorder p="sm">
          <Skeleton height={10} width="55%" radius="sm" mb={10} />
          <Skeleton height={22} width="70%" radius="sm" />
        </Card>
      ))}
    </SimpleGrid>
  );
}

/** Tile grid — matches gallery/file views (Artifacts grid). */
export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="sm" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static placeholder
        <Skeleton key={i} height={104} radius="md" />
      ))}
    </SimpleGrid>
  );
}
