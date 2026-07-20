import type { RunRecord } from '@hub/shared';
import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  FloatingWindow,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import dayjs from 'dayjs';
import { TbExternalLink, TbWindow } from 'react-icons/tb';
import { useTools } from '~/hooks/useTools.js';
import { toolLabel } from '~/utils/tool-label.js';

interface FloatingRunsWindowProps {
  runs: RunRecord[];
  visible: boolean;
  onClose: () => void;
  onJumpToRuns: () => void;
}

export function FloatingRunsWindow({
  runs,
  visible,
  onClose,
  onJumpToRuns,
}: FloatingRunsWindowProps) {
  const tools = useTools();

  if (!visible || runs.length === 0) return null;

  return (
    <FloatingWindow
      w={320}
      withBorder
      shadow="md"
      excludeDragHandleSelector="button,[role='button']"
      initialPosition={{ top: 80, right: 20 }}
      style={{ cursor: 'move' }}
    >
      <Stack gap="xs" p="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap={6}>
            <Loader size={12} color="blue" type="dots" />
            <Text size="sm" fw={600}>
              Active Runs ({runs.length})
            </Text>
          </Group>
          <Group gap={2}>
            <Tooltip label="Jump to Run page" withArrow>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="blue"
                onClick={onJumpToRuns}
                aria-label="Jump to Run page"
              >
                <TbExternalLink size={14} />
              </ActionIcon>
            </Tooltip>
            <CloseButton size="sm" onClick={onClose} aria-label="Close" />
          </Group>
        </Group>
        <ScrollArea.Autosize mah="28vh">
          <Stack gap={6}>
            {runs.map((run) => (
              <Group
                key={run.id}
                gap={6}
                wrap="nowrap"
                p={6}
                style={{
                  borderRadius: 6,
                  background: 'var(--mantine-color-default-hover)',
                  minWidth: 0,
                }}
              >
                <Badge size="xs" color="gray" variant="light" radius="sm" style={{ flexShrink: 0 }}>
                  {toolLabel(run.request.tool, tools.data ?? [])}
                </Badge>
                <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                  <Text size="xs" fw={500} truncate>
                    {run.request.project}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {run.request.type} · {dayjs(run.startedAt).fromNow()}
                  </Text>
                </Stack>
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
        <Button
          size="xs"
          variant="light"
          leftSection={<TbWindow size={12} />}
          onClick={onJumpToRuns}
        >
          Open Run Tests
        </Button>
      </Stack>
    </FloatingWindow>
  );
}
