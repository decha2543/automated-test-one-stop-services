import { Group, Paper, Text } from '@mantine/core';
import type { ReactNode } from 'react';

interface InlineAlertProps {
  /** Leading status icon (sized ~14). */
  icon: ReactNode;
  /** Short message text. */
  message: ReactNode;
  /** Optional right-aligned action (e.g. a fix/upload button). */
  action?: ReactNode;
  /** Mantine color name for the border/tint/text. Defaults to a warning yellow. */
  color?: string;
}

/**
 * Compact inline warning/notice strip: a tinted bordered Paper with a leading
 * icon, a message, and an optional action on the right. One place for the
 * "something needs your attention before you can proceed" box (missing
 * credentials, Appium not running, …) so every such notice looks identical.
 */
export function InlineAlert({ icon, message, action, color = 'yellow' }: InlineAlertProps) {
  return (
    <Paper
      p="xs"
      withBorder
      style={{
        borderColor: `var(--mantine-color-${color}-6)`,
        background: `var(--mantine-color-${color}-light)`,
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
          <Text size="xs" c={`${color}.8`}>
            {message}
          </Text>
        </Group>
        {action}
      </Group>
    </Paper>
  );
}
