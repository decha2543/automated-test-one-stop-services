import type { ToolStatus } from '@hub/shared';
import { Badge } from '@mantine/core';

interface StatusBadgeProps {
  readonly status: ToolStatus;
}

const STATUS_CONFIG: Record<ToolStatus, { color: string; label: string }> = {
  enabled: { color: 'green', label: 'Enabled' },
  disabled: { color: 'gray', label: 'Disabled' },
  broken: { color: 'red', label: 'Broken' },
};

/** Colored badge indicating tool lifecycle status. */
export function StatusBadge({ status }: StatusBadgeProps) {
  const { color, label } = STATUS_CONFIG[status];
  return (
    <Badge size="xs" color={color} variant="light">
      {label}
    </Badge>
  );
}
