import { Badge } from '@mantine/core';

interface VersionBadgeProps {
  readonly version: string;
}

/** Displays the tool's version as a subtle badge. */
export function VersionBadge({ version }: VersionBadgeProps) {
  return (
    <Badge size="xs" variant="outline" color="gray">
      v{version}
    </Badge>
  );
}
