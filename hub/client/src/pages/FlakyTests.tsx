import type { FlakyReport, FlakyTestEntry, RunStatus } from '@hub/shared';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { TbAnalyze, TbFlame, TbX } from 'react-icons/tb';
import { api } from '~/api/client';
import { EmptyState } from '~/components/EmptyState.js';
import { PageHeader } from '~/components/PageHeader.js';
import { ListSkeleton } from '~/components/Skeletons.js';
import { toast } from '~/components/Toast';
import { useAllProjects } from '~/hooks/useProjectQueries';
import { useT } from '~/i18n/index.js';

function statusColor(status: RunStatus): string {
  switch (status) {
    case 'passed':
      return 'green';
    case 'failed':
      return 'red';
    case 'skipped':
      return 'gray';
    default:
      return 'blue';
  }
}

/** Server stores tests keyed by `${tool}/${type}/${project}/${testId}`. */
function buildTestKey(t: FlakyTestEntry): string {
  return `${t.tool}/${t.type}/${t.project}/${t.testId}`;
}

export function FlakyTestsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const flaky = useQuery<FlakyReport>({
    queryKey: ['flaky'],
    queryFn: () => api.get('/api/flaky'),
  });

  const projects = useAllProjects();

  const tests = useMemo<FlakyTestEntry[]>(() => {
    const list = flaky.data?.flakyTests ?? [];
    return projectFilter ? list.filter((t) => t.project === projectFilter) : list;
  }, [flaky.data, projectFilter]);

  const analyzeMutation = useMutation({
    mutationFn: () => api.post('/api/flaky/analyze'),
    onSuccess: () => {
      toast.success(t('flaky.analysisStarted'));
      queryClient.invalidateQueries({ queryKey: ['flaky'] });
    },
    onError: () => toast.error(t('flaky.analysisFailed')),
  });

  const dismissMutation = useMutation({
    mutationFn: (testKey: string) => api.post('/api/flaky/dismiss', { testKey }),
    onSuccess: () => {
      toast.success(t('flaky.dismissed'));
      queryClient.invalidateQueries({ queryKey: ['flaky'] });
    },
    onError: () => toast.error(t('flaky.dismissFailed')),
  });

  return (
    <Stack gap="md">
      <PageHeader
        title={t('nav.flakyTests')}
        actions={
          <>
            <Select
              size="xs"
              placeholder={t('filter.allProjects')}
              value={projectFilter}
              onChange={setProjectFilter}
              data={projects.data ?? []}
              clearable
              searchable
              w={180}
            />
            <Button
              leftSection={<TbAnalyze size={14} />}
              size="xs"
              onClick={() => analyzeMutation.mutate()}
              loading={analyzeMutation.isPending}
            >
              Analyze
            </Button>
          </>
        }
      />

      {flaky.isLoading && <ListSkeleton rows={4} />}

      {flaky.data && tests.length === 0 && (
        <EmptyState
          icon={<TbFlame size={48} color="var(--mantine-color-dimmed)" />}
          description={
            <Stack align="center" gap="sm">
              <Text size="sm" c="dimmed">
                {projectFilter
                  ? `${t('flaky.emptyForProject')} (${projectFilter})`
                  : t('flaky.empty')}
              </Text>
              {(flaky.data.totalTests ?? 0) > 0 && (
                <Text size="xs" c="dimmed">
                  Last analyzed {dayjs(flaky.data.generatedAt).format('DD MMM HH:mm')} ·{' '}
                  {flaky.data.totalTests} tracked
                </Text>
              )}
            </Stack>
          }
        />
      )}

      {tests.length > 0 && (
        <Paper withBorder>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Test ID</Table.Th>
                <Table.Th>Project</Table.Th>
                <Table.Th>Tool</Table.Th>
                <Table.Th>Flakiness</Table.Th>
                <Table.Th>Pass/Fail</Table.Th>
                <Table.Th>Recent</Table.Th>
                <Table.Th>Last Seen</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tests.map((t) => {
                const key = buildTestKey(t);
                return (
                  <Table.Tr key={key}>
                    <Table.Td>
                      <Text size="xs" ff="monospace" lineClamp={1} maw={200}>
                        {t.testId}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light">
                        {t.project}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{t.tool}</Text>
                    </Table.Td>
                    <Table.Td w={120}>
                      <Group gap={4} wrap="nowrap">
                        <Progress
                          value={t.flakinessScore}
                          size="sm"
                          color={t.flakinessScore > 50 ? 'red' : 'orange'}
                          style={{ flex: 1 }}
                        />
                        <Text size="xs" fw={500} w={32} ta="right">
                          {t.flakinessScore}%
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        <Text span c="green" fw={500}>
                          {t.passes}
                        </Text>
                        {' / '}
                        <Text span c="red" fw={500}>
                          {t.failures}
                        </Text>
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2}>
                        {t.recentStatuses.map((s, i) => (
                          <Tooltip key={i as number} label={s}>
                            <div
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: `var(--mantine-color-${statusColor(s)}-6)`,
                              }}
                            />
                          </Tooltip>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {dayjs(t.lastSeen).format('DD MMM HH:mm')}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="Dismiss">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          onClick={() => dismissMutation.mutate(key)}
                          aria-label="Dismiss flaky test"
                        >
                          <TbX size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
