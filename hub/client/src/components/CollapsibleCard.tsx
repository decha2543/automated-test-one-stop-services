import { Collapse, Group, Paper, Text, UnstyledButton } from '@mantine/core';
import type { CSSProperties, ReactNode } from 'react';
import { TbChevronRight } from 'react-icons/tb';

interface CollapsibleCardProps {
  /** Section title (already localized by the caller). */
  title: string;
  /** Leading icon shown between the chevron and the title. */
  icon?: ReactNode;
  /** Rendered right after the title (e.g. a count badge). Part of the toggle. */
  titleAfter?: ReactNode;
  /** Right-aligned controls (search, buttons, status badges). NOT part of the toggle. */
  actions?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Paper padding token. Compact bars use `xs` (default); page sections use `md`. */
  padding?: string;
  style?: CSSProperties;
}

/**
 * One shared collapsible section card so every "click header to expand" block
 * in the Hub (Bookmarks, Active & Queue, …) looks and behaves identically: same
 * bordered Paper, same rotating chevron, same title weight, same header layout.
 * The chevron + icon + title area is the toggle; `actions` stay clickable on
 * their own. Uses Mantine `Collapse` (`expanded` prop, per this repo's usage).
 */
export function CollapsibleCard({
  title,
  icon,
  titleAfter,
  actions,
  open,
  onToggle,
  children,
  padding = 'xs',
  style,
}: CollapsibleCardProps) {
  return (
    <Paper withBorder radius="md" p={padding} style={style}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <UnstyledButton
          onClick={onToggle}
          aria-expanded={open}
          aria-label={title}
          style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}
        >
          <TbChevronRight
            size={16}
            style={{
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 150ms ease',
              opacity: 0.6,
              flexShrink: 0,
            }}
          />
          {icon}
          <Text size="sm" fw={600} truncate>
            {title}
          </Text>
          {titleAfter}
        </UnstyledButton>
        {actions && (
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {actions}
          </Group>
        )}
      </Group>
      <Collapse expanded={open}>{children}</Collapse>
    </Paper>
  );
}
