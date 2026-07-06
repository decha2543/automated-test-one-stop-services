import type { ToolView } from '@hub/shared';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { TbDotsVertical, TbFileText, TbRefresh, TbTrash } from 'react-icons/tb';
import { useT } from '~/i18n/index.js';

interface MoreMenuProps {
  readonly tool: ToolView;
  readonly onUpdate: () => void;
  readonly onUninstall: () => void;
  readonly uninstallDisabled: boolean;
  readonly uninstallTooltip: string;
}

/** Dropdown menu with additional actions: view manifest, update, uninstall. */
export function MoreMenu({
  tool,
  onUpdate,
  onUninstall,
  uninstallDisabled,
  uninstallTooltip,
}: MoreMenuProps) {
  const t = useT();

  return (
    <Menu position="bottom-end" withArrow shadow="md">
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={`${t('moreMenu.moreActions')}: ${tool.title}`}
        >
          <TbDotsVertical size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t('moreMenu.actions')}</Menu.Label>

        <Menu.Item leftSection={<TbFileText size={14} />} disabled>
          {t('moreMenu.viewManifest')}
        </Menu.Item>

        {tool.origin === 'registry' && (
          <Menu.Item leftSection={<TbRefresh size={14} />} onClick={onUpdate}>
            {t('moreMenu.update')}
          </Menu.Item>
        )}

        <Menu.Divider />

        <Tooltip label={uninstallTooltip} disabled={!uninstallDisabled}>
          <Menu.Item
            leftSection={<TbTrash size={14} />}
            color="red"
            disabled={uninstallDisabled}
            onClick={onUninstall}
          >
            {t('moreMenu.uninstall')}
          </Menu.Item>
        </Tooltip>
      </Menu.Dropdown>
    </Menu>
  );
}
