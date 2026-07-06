import { Group, Kbd, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { useT } from '~/i18n/index.js';

export function KeyboardShortcuts() {
  const t = useT();
  const [opened, { open, close }] = useDisclosure(false);
  const shortcuts = [
    { keys: ['Ctrl', 'K'], description: t('shortcuts.palette') },
    { keys: ['Ctrl', 'T'], description: t('shortcuts.newTab') },
    { keys: ['Ctrl', 'W'], description: t('shortcuts.closeTab') },
    { keys: ['Ctrl', 'Enter'], description: t('shortcuts.startRun') },
    { keys: ['?'], description: t('shortcuts.showShortcuts') },
  ];

  useHotkeys([
    [
      'shift+/',
      (e) => {
        // Only trigger if not in an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
          return;
        e.preventDefault();
        open();
      },
    ],
  ]);

  return (
    <Modal opened={opened} onClose={close} title={t('shortcuts.title')} centered size="sm">
      <Stack gap="sm">
        {shortcuts.map((shortcut) => (
          <Group key={shortcut.description} justify="space-between">
            <Text size="sm">{shortcut.description}</Text>
            <Group gap={4}>
              {shortcut.keys.map((key, i) => (
                <span key={key}>
                  <Kbd>{key}</Kbd>
                  {i < shortcut.keys.length - 1 && (
                    <Text span size="xs" c="dimmed" mx={2}>
                      +
                    </Text>
                  )}
                </span>
              ))}
            </Group>
          </Group>
        ))}
      </Stack>
    </Modal>
  );
}
