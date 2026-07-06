import type { ToolView } from '@hub/shared';
import { Group, Paper, Stack, Text } from '@mantine/core';
import { EnableSwitch } from './EnableSwitch.js';
import { ErrorList } from './ErrorList.js';
import { MoreMenu } from './MoreMenu.js';
import { ProjectCountChip } from './ProjectCountChip.js';
import { StatusBadge } from './StatusBadge.js';
import { VersionBadge } from './VersionBadge.js';

interface ToolCardProps {
  readonly tool: ToolView;
  readonly onToggle: (next: boolean) => void;
  readonly onUninstall?: () => void;
  readonly onUpdate?: () => void;
}

/**
 * Card showing tool title, description, version, status badge,
 * project count, enable switch, and a more-menu for additional actions.
 */
export function ToolCard({ tool, onToggle, onUninstall, onUpdate }: ToolCardProps) {
  const hasProjects = tool.projectCount > 0;
  const uninstallTooltip = hasProjects
    ? `Remove ${tool.projectCount} project${tool.projectCount === 1 ? '' : 's'} first`
    : `Permanently delete tools/${tool.id}`;

  return (
    <Paper component="li" withBorder p="md" radius="md" style={{ listStyle: 'none' }}>
      <Stack gap="sm">
        {/* Header: title + status/version badges */}
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Text fw={600} size="sm">
              {tool.title}
            </Text>
            <Text size="xs" c="dimmed" mt={2} lineClamp={2}>
              {tool.description}
            </Text>
          </div>
          <Stack gap={4} align="flex-end">
            <StatusBadge status={tool.status} />
            <VersionBadge version={tool.version} />
          </Stack>
        </Group>

        {/* Metadata grid */}
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {tool.runtime}
          </Text>
          <Text size="xs" c="dimmed">
            •
          </Text>
          <Text size="xs" c="dimmed">
            {tool.packageManager}
          </Text>
          <Text size="xs" c="dimmed">
            •
          </Text>
          <Text size="xs" c="dimmed">
            {tool.origin}
          </Text>
          <Text size="xs" c="dimmed">
            •
          </Text>
          <ProjectCountChip count={tool.projectCount} href={`/projects?tool=${tool.id}`} />
        </Group>

        {/* Footer: enable switch + more menu */}
        <Group justify="space-between" align="center">
          <EnableSwitch
            checked={tool.status === 'enabled'}
            disabled={tool.status === 'broken'}
            onChange={onToggle}
          />
          <MoreMenu
            tool={tool}
            onUpdate={onUpdate ?? (() => {})}
            onUninstall={onUninstall ?? (() => {})}
            uninstallDisabled={hasProjects}
            uninstallTooltip={uninstallTooltip}
          />
        </Group>

        {/* Validation errors for broken tools */}
        {tool.status === 'broken' && <ErrorList errors={tool.errors} />}
      </Stack>
    </Paper>
  );
}
