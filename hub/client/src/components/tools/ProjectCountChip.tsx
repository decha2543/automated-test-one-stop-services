import { Badge } from '@mantine/core';
import { Link } from '@tanstack/react-router';

interface ProjectCountChipProps {
  readonly count: number;
  readonly href: string;
}

/**
 * Shows the project count for a tool. When count > 0 renders as an active
 * link to the projects page filtered by tool; otherwise renders as a muted label.
 */
export function ProjectCountChip({ count, href }: ProjectCountChipProps) {
  const label = `${count} project${count === 1 ? '' : 's'}`;

  if (count > 0) {
    return (
      <Badge
        component={Link}
        to={href}
        size="xs"
        variant="light"
        color="blue"
        style={{ cursor: 'pointer', textDecoration: 'none' }}
      >
        {label}
      </Badge>
    );
  }

  return (
    <Badge size="xs" variant="light" color="gray">
      {label}
    </Badge>
  );
}
