import type { RunRecord } from '@hub/shared';
import { Badge, Group, Progress, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { TbPlayerPlay } from 'react-icons/tb';
import { api } from '~/api/client';
import { CollapsibleCard } from '~/components/CollapsibleCard.js';
import { useTools } from '~/hooks/useTools.js';
import { toolLabel } from '~/utils/tool-label.js';

interface QueueStatus {
  active: RunRecord[];
  activeCount: number;
  queueLength: number;
  maxConcurrency: number;
}

export function RunQueuePanel() {
  // Collapsed by default: the always-visible header already shows the
  // running/queued counts; expand only when you want the per-run detail. Keeps
  // the run form + live output as the focus during an active run.
  const [expanded, setExpanded] = useState(false);
  const tools = useTools();

  const queue = useQuery<QueueStatus>({
    queryKey: ['queue'],
    queryFn: () => api.get('/api/queue'),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && (data.activeCount > 0 || data.queueLength > 0) ? 3000 : 30_000;
    },
  });

  const activeCount = queue.data?.activeCount ?? 0;
  const queueLength = queue.data?.queueLength ?? 0;
  const maxConcurrency = queue.data?.maxConcurrency ?? 2;

  if (!queue.data || (activeCount === 0 && queueLength === 0)) {
    return null;
  }

  return (
    <CollapsibleCard
      icon={<TbPlayerPlay size={16} color="var(--mantine-color-blue-6)" />}
      title="Active & Queue"
      open={expanded}
      onToggle={() => setExpanded((v) => !v)}
      style={{ flexShrink: 0 }}
      actions={
        <>
          <Badge size="xs" color="blue" variant="light">
            {activeCount}/{maxConcurrency} running
          </Badge>
          {queueLength > 0 && (
            <Badge size="xs" color="orange" variant="light">
              {queueLength} queued
            </Badge>
          )}
        </>
      }
    >
      <Stack gap={4} mt="xs" px="xs">
        {(queue.data?.active ?? []).map((run) => (
          <Group key={run.id} justify="space-between" gap="xs" wrap="nowrap">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Badge size="xs" variant="filled" color="blue">
                running
              </Badge>
              <Text size="xs" ff="monospace" truncate>
                {run.request.project}
              </Text>
              <Badge size="xs" variant="light" color="gray">
                {toolLabel(run.request.tool, tools.data ?? [])}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {dayjs(run.startedAt).format('HH:mm')}
            </Text>
          </Group>
        ))}
        {queueLength > 0 && (
          <Group gap="xs" mt={2}>
            <Progress value={100} size={3} color="orange" style={{ flex: 1 }} animated />
            <Text size="xs" c="dimmed">
              {queueLength} waiting
            </Text>
          </Group>
        )}
      </Stack>
    </CollapsibleCard>
  );
}
