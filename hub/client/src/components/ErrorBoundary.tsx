import { Alert, Button, Code, Group, Stack } from '@mantine/core';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TbAlertTriangle, TbRefresh } from 'react-icons/tb';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level error boundary for routed pages.
 *
 * If any page component throws while rendering, this boundary catches the
 * error and shows a recoverable UI rather than letting the whole shell go
 * blank. Routing remains intact so the user can navigate away or reload.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console so devs can see the stack while we keep the UI alive.
    console.error('AppLayout caught an error:', error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Alert
        icon={<TbAlertTriangle size={20} />}
        color="red"
        title="Something went wrong"
        variant="light"
      >
        <Stack gap="sm">
          <Code block>{error.message || 'Unknown error'}</Code>
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={this.reset}>
              Try again
            </Button>
            <Button
              size="xs"
              color="red"
              variant="light"
              leftSection={<TbRefresh size={14} />}
              onClick={this.reload}
            >
              Reload page
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }
}
