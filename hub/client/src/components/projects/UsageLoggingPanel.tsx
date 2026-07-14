import { Badge, Box, Group, Paper, Switch, Text, Tooltip } from '@mantine/core';
import { TbAlertTriangle, TbCircleCheck } from 'react-icons/tb';
import { toast } from '~/components/Toast.js';
import { useSetUsageLogging, useUsageLogging } from '~/hooks/useUsageLogging.js';
import { useT } from '~/i18n/index.js';

/**
 * Google Sheet usage-logging status + on/off switch, shown in the scripts/.env
 * section beside the credential upload. Zero hand-config: readiness is derived
 * (credentials uploaded + SPREADSHEET_ID set), and the switch is disabled — with
 * the reason shown — until both are present. Turning it on flips FORCE_TRACK.
 */
export function UsageLoggingPanel() {
  const t = useT();
  const status = useUsageLogging();
  const setEnabled = useSetUsageLogging();
  const s = status.data;
  if (!s) return null;

  const blockedReason = !s.hasCredentials
    ? t('usage.needCreds')
    : !s.hasSpreadsheetId
      ? t('usage.needSheetId')
      : '';

  const handleToggle = (next: boolean) => {
    setEnabled.mutate(next, {
      onSuccess: () => toast.success(next ? t('usage.enabled') : t('usage.disabled')),
      onError: (err) => toast.error(err instanceof Error ? err.message : t('usage.toggleFailed')),
    });
  };

  return (
    <Paper p="xs" radius="sm" bg="var(--mantine-color-default-hover)" withBorder>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" truncate>
            {t('usage.title')}
          </Text>
          {!s.ready ? (
            <Badge size="xs" color="yellow" leftSection={<TbAlertTriangle size={10} />}>
              {blockedReason}
            </Badge>
          ) : s.forceTrack ? (
            <Badge size="xs" color="green" leftSection={<TbCircleCheck size={10} />}>
              {t('usage.on')}
            </Badge>
          ) : (
            <Badge size="xs" color="gray">
              {t('usage.readyOff')}
            </Badge>
          )}
        </Group>
        <Tooltip label={blockedReason} disabled={s.ready} withArrow position="left">
          <Box>
            <Switch
              size="sm"
              checked={s.forceTrack}
              disabled={!s.ready || setEnabled.isPending}
              onChange={(e) => handleToggle(e.currentTarget.checked)}
              aria-label={t('usage.title')}
            />
          </Box>
        </Tooltip>
      </Group>
    </Paper>
  );
}
