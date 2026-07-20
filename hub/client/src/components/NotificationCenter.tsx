import {
  ActionIcon,
  Button,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import dayjs from 'dayjs';
import { TbBell, TbCheck, TbCircleCheck, TbCircleX, TbInfoCircle, TbTrash } from 'react-icons/tb';
import { type HubNotification, useNotifications } from '~/stores/hub.js';

function NotificationIcon({ type }: { type: HubNotification['type'] }) {
  switch (type) {
    case 'success':
      return <TbCircleCheck size={16} color="var(--mantine-color-green-6)" />;
    case 'error':
      return <TbCircleX size={16} color="var(--mantine-color-red-6)" />;
    case 'warning':
      return <TbInfoCircle size={16} color="var(--mantine-color-yellow-6)" />;
    default:
      return <TbInfoCircle size={16} color="var(--mantine-color-blue-6)" />;
  }
}

export function NotificationCenter() {
  const [_, { toggle, close }] = useDisclosure(false);
  const { notifications, unreadCount, markAllRead, markRead, clear } = useNotifications();

  return (
    <Popover
      onClose={close}
      position="bottom-end"
      width={360}
      shadow="lg"
      closeOnClickOutside
      clickOutsideEvents={['mouseup', 'touchend']}
      closeOnEscape
    >
      <Popover.Target>
        <Tooltip label="Notifications">
          <Indicator
            color="red"
            size={16}
            label={unreadCount > 0 ? unreadCount : undefined}
            disabled={unreadCount === 0}
          >
            <ActionIcon variant="subtle" onClick={toggle} aria-label="Notifications">
              <TbBell size={18} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <Group
          justify="space-between"
          px="md"
          py="sm"
          style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
        >
          <Text size="sm" fw={600}>
            Notifications
          </Text>
          <Group gap={4}>
            {unreadCount > 0 && (
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<TbCheck size={12} />}
                onClick={markAllRead}
              >
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                leftSection={<TbTrash size={12} />}
                onClick={clear}
              >
                Clear
              </Button>
            )}
          </Group>
        </Group>

        <ScrollArea.Autosize mah="45vh">
          {notifications.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              No notifications yet
            </Text>
          ) : (
            <Stack gap={0}>
              {notifications.map((n) => (
                <Group
                  key={n.id}
                  gap="sm"
                  px="md"
                  py="xs"
                  wrap="nowrap"
                  onMouseEnter={() => !n.read && markRead(n.id)}
                  style={{
                    borderBottom: '1px solid var(--mantine-color-default-border)',
                    background: n.read ? undefined : 'var(--mantine-color-brand-light)',
                    opacity: n.read ? 0.7 : 1,
                    cursor: 'default',
                  }}
                >
                  <NotificationIcon type={n.type} />
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Text size="xs" fw={500} truncate>
                      {n.title}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {n.message}
                    </Text>
                  </Stack>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {dayjs(n.timestamp).fromNow()}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
