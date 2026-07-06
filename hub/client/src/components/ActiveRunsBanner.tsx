import type { RunRecord } from '@hub/shared';
import { Badge, Group, Loader, Marquee, Text } from '@mantine/core';
import { useTools } from '~/hooks/useTools.js';
import { toolLabel } from '~/utils/tool-label.js';

interface ActiveRunsBannerProps {
  runs: RunRecord[];
}

export function ActiveRunsBanner({ runs }: ActiveRunsBannerProps) {
  const tools = useTools();

  if (runs.length === 0) return null;

  // Animation duration scales with run count for readable speed
  const durationMs = Math.max(20000, runs.length * 6000);

  return (
    <Marquee
      gap="xl"
      duration={durationMs}
      pauseOnHover
      style={{
        background: 'var(--mantine-color-blue-light)',
        borderRadius: 6,
        padding: '4px 0',
      }}
    >
      {runs.map((run) => (
        <Group key={run.id} gap={6} wrap="nowrap">
          <Loader size={12} color="blue" type="dots" />
          <Badge size="xs" color="gray" variant="filled" radius="sm">
            {toolLabel(run.request.tool, tools.data ?? [])}
          </Badge>
          <Text size="xs" fw={500}>
            {run.request.project}
          </Text>
          <Text size="xs" c="dimmed">
            ({run.request.type})
          </Text>
        </Group>
      ))}
    </Marquee>
  );
}
