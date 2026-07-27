import { Button } from '@mantine/core';
import { TbPlugConnectedX, TbRefresh } from 'react-icons/tb';
import { EmptyState } from '~/components/EmptyState.js';
import { useT } from '~/i18n/index.js';

interface ErrorStateProps {
  /** Re-runs the failed query. Omit when the caller has no refetch handle. */
  onRetry?: () => void;
  /** Overrides the default "could not load" line (e.g. a server message). */
  message?: string;
}

/**
 * What a page shows when its data could not be loaded.
 *
 * Without this a failed request is indistinguishable from "you have nothing
 * yet" — the page renders its empty state and quietly tells the user something
 * untrue. Says what happened, the most likely cause, and offers the one action
 * that helps.
 */
export function ErrorState({ onRetry, message }: ErrorStateProps) {
  const t = useT();
  return (
    <EmptyState
      icon={<TbPlugConnectedX size={48} color="var(--mantine-color-red-6)" />}
      title={t('error.loadFailed')}
      description={message ?? t('error.loadFailedDesc')}
      action={
        onRetry ? (
          <Button size="xs" variant="light" leftSection={<TbRefresh size={14} />} onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : undefined
      }
    />
  );
}
