import type { ToolView } from '@hub/shared';
import { Button, Group, Switch, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { TbGitFork } from 'react-icons/tb';
import { toast } from '~/components/Toast.js';
import { TypeToConfirmModal } from '~/components/TypeToConfirmModal.js';
import { MoreMenu } from '~/components/tools/MoreMenu.js';
import { useToggleTool, useUninstallTool, useUpdateTool } from '~/hooks/useTools.js';
import { useT } from '~/i18n/index.js';

interface ToolSectionActionsProps {
  readonly tool: ToolView;
  /** Open the Clone Project modal pre-scoped to this tool. */
  readonly onCloneProject: () => void;
}

/**
 * Right-side lifecycle controls for an installed tool's section header:
 * enable/disable switch, "Clone project", and a more-menu (Update / Remove).
 * Remove is disabled while the tool still owns projects — the guard is also
 * enforced server-side (409 TOOL_HAS_PROJECTS); this just blocks the UI early.
 */
export function ToolSectionActions({ tool, onCloneProject }: ToolSectionActionsProps) {
  const t = useT();
  const toggle = useToggleTool();
  const update = useUpdateTool();
  const uninstall = useUninstallTool();
  const [removeOpen, setRemoveOpen] = useState(false);

  const hasProjects = tool.projectCount > 0;
  const uninstallTooltip = hasProjects
    ? t('tools.removeProjectsFirst')
    : `${t('tools.deletePermanently')} tools/${tool.id}`;

  return (
    <Group gap={6} wrap="nowrap">
      <Tooltip label={tool.status === 'enabled' ? t('tools.disable') : t('tools.enable')} withArrow>
        <Switch
          size="xs"
          checked={tool.status === 'enabled'}
          disabled={tool.status === 'broken' || toggle.isPending}
          onChange={(e) => toggle.mutate({ id: tool.id, enabled: e.currentTarget.checked })}
          aria-label={tool.status === 'enabled' ? t('tools.disable') : t('tools.enable')}
        />
      </Tooltip>

      <Button
        size="compact-xs"
        variant="default"
        leftSection={<TbGitFork size={12} />}
        onClick={onCloneProject}
      >
        {t('tools.cloneProject')}
      </Button>

      <MoreMenu
        tool={tool}
        onUpdate={() =>
          update.mutate(
            { id: tool.id },
            {
              onSuccess: () => toast.success(`${t('tools.updated')} ${tool.title}`),
              onError: (e) => toast.error(e instanceof Error ? e.message : t('tools.updateFailed')),
            },
          )
        }
        onUninstall={() => setRemoveOpen(true)}
        uninstallDisabled={hasProjects}
        uninstallTooltip={uninstallTooltip}
      />

      <TypeToConfirmModal
        opened={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title={t('tools.removeTitle')}
        description={t('tools.removeDesc')}
        expected={tool.id}
        confirmLabel={t('tools.removeConfirm')}
        loading={uninstall.isPending}
        onConfirm={() =>
          uninstall.mutate(tool.id, {
            onSuccess: () => {
              toast.success(`${t('tools.removed')} ${tool.title}`);
              setRemoveOpen(false);
            },
            onError: (e) => toast.error(e instanceof Error ? e.message : t('tools.removeFailed')),
          })
        }
      />
    </Group>
  );
}
