import { Alert, Code, List, Text } from '@mantine/core';
import { TbAlertTriangle } from 'react-icons/tb';

interface ManifestErrorItem {
  readonly code: string;
  readonly message: string;
}

interface ErrorListProps {
  readonly errors: readonly ManifestErrorItem[];
}

/** Displays manifest validation errors when a tool's status is 'broken'. */
export function ErrorList({ errors }: ErrorListProps) {
  if (errors.length === 0) return null;

  return (
    <Alert
      icon={<TbAlertTriangle size={16} />}
      title="Manifest validation errors"
      color="red"
      variant="light"
    >
      <List size="xs" spacing={4}>
        {errors.map((err) => (
          <List.Item key={`${err.code}-${err.message}`}>
            <Code>{err.code}</Code>{' '}
            <Text component="span" size="xs">
              {err.message}
            </Text>
          </List.Item>
        ))}
      </List>
    </Alert>
  );
}
