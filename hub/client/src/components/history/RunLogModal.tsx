import type { RunRecord, RunRequest, RunStatus } from '@hub/shared';
import { Badge, Button, Code, Group, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import dayjs from 'dayjs';
import { TbCopy, TbPlayerPlay, TbTerminal } from 'react-icons/tb';
import { toast } from '~/components/Toast.js';
import { formatAbsolute } from '~/utils/datetime.js';

function statusColor(s: RunStatus | string): string {
  if (s === 'passed') return 'green';
  if (s === 'failed') return 'red';
  if (s === 'cancelled') return 'orange';
  if (s === 'running') return 'blue';
  return 'gray';
}

function formatDuration(start: string, end?: string): string {
  if (!end) return '-';
  const ms = dayjs(end).diff(dayjs(start));
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export interface RunLogModalProps {
  run: RunRecord | null;
  opened: boolean;
  onClose: () => void;
  onRerun: (config: RunRequest) => void;
}

/**
 * Modal that shows a single run's metadata and command.
 * Extracted from `pages/History.tsx` to keep that page focused on the table.
 */
export function RunLogModal({ run, opened, onClose, onRerun }: RunLogModalProps) {
  if (!run) return null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="sm">
          <TbTerminal size={16} />
          <Text size="sm" fw={600}>
            Run Details — {run.request.project}
          </Text>
          <Badge size="xs" color={statusColor(run.status)}>
            {run.status}
          </Badge>
        </Group>
      }
      size="xl"
      centered
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="sm">
        <Group gap="xl" wrap="wrap">
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Tool
            </Text>
            <Text size="xs" fw={500}>
              {run.request.tool}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Type
            </Text>
            <Text size="xs" fw={500}>
              {run.request.type}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Duration
            </Text>
            <Text size="xs" fw={500}>
              {formatDuration(run.startedAt, run.endedAt)}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Exit Code
            </Text>
            <Text size="xs" fw={500} c={run.exitCode === 0 ? 'green' : 'red'}>
              {run.exitCode ?? 'N/A'}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Started
            </Text>
            <Text size="xs" fw={500}>
              {formatAbsolute(run.startedAt)}
            </Text>
          </Stack>
          {run.endedAt && (
            <Stack gap={2}>
              <Text size="xs" c="dimmed">
                Ended
              </Text>
              <Text size="xs" fw={500}>
                {formatAbsolute(run.endedAt)}
              </Text>
            </Stack>
          )}
        </Group>

        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Command
            </Text>
            <Group gap={4}>
              <Button
                size="compact-xs"
                variant="light"
                color="green"
                leftSection={<TbPlayerPlay size={12} />}
                onClick={() => {
                  onRerun(run.request);
                  onClose();
                }}
              >
                Rerun
              </Button>
              <Button
                size="compact-xs"
                variant="light"
                color="gray"
                leftSection={<TbCopy size={12} />}
                onClick={() => {
                  navigator.clipboard.writeText(run.command);
                  toast.success('Command copied');
                }}
              >
                Copy
              </Button>
            </Group>
          </Group>
          <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {run.command}
          </Code>
        </Stack>

        {run.request.tag && (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              Tags
            </Text>
            <Code style={{ fontSize: 11 }}>{run.request.tag}</Code>
          </Stack>
        )}

        {run.request.extraArgs && (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              Extra Args
            </Text>
            <Code style={{ fontSize: 11 }}>{run.request.extraArgs}</Code>
          </Stack>
        )}

        <Text size="xs" c="dimmed" mt="sm">
          Note: Full terminal output is only available for currently active sessions. Past run logs
          are not persisted to disk.
        </Text>
      </Stack>
    </Modal>
  );
}
