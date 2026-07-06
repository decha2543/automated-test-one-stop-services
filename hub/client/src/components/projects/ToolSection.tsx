import { Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import { CollapsibleCard } from '~/components/CollapsibleCard.js';

interface ToolSectionProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Optional action controls rendered on the right of the header (e.g. tool lifecycle buttons). */
  headerRight?: ReactNode;
}

/**
 * Collapsible group header used on the Projects page to organise rows by
 * tool (Playwright / Robot Framework / k6 / scripts). Thin wrapper over the
 * shared `CollapsibleCard` (page-section `md` padding) so it looks and behaves
 * identically to every other collapsible section in the Hub; the per-tool
 * lifecycle actions ride in the card's `actions` slot, outside the toggle.
 */
export function ToolSection({
  label,
  expanded,
  onToggle,
  children,
  headerRight,
}: ToolSectionProps) {
  return (
    <CollapsibleCard
      title={label}
      open={expanded}
      onToggle={onToggle}
      actions={headerRight}
      padding="md"
    >
      <Stack gap="xs" pt="sm">
        {children}
      </Stack>
    </CollapsibleCard>
  );
}
