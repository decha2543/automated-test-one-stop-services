import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { type ChangeEvent, type ReactNode, useRef } from 'react';
import { TbAlertTriangle, TbBrandGoogle, TbCircleCheck, TbTable, TbUpload } from 'react-icons/tb';
import { toast } from '~/components/Toast.js';
import { useUploadCredentials } from '~/hooks/useCredentials.js';
import {
  useAuthenticateGoogle,
  useSetUsageLogging,
  useUsageLogging,
} from '~/hooks/useUsageLogging.js';
import { useT } from '~/i18n/index.js';

/** The single third-party integration this setup wires up. */
const GOOGLE_TOOL = 'google';

/**
 * One labelled step inside the setup card: a numbered header plus its body
 * (badge + action). Kept visually self-contained so the three steps read as a
 * sequence and reflow cleanly to a single column on narrow screens.
 */
function SetupStep({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <Paper p="xs" radius="sm" bg="var(--mantine-color-default-hover)" withBorder>
      <Stack gap={8}>
        <Group gap={8} wrap="nowrap">
          <ThemeIcon size={18} radius="xl" variant="light">
            <Text fw={700} fz={11}>
              {step}
            </Text>
          </ThemeIcon>
          <Text size="sm" fw={500} truncate>
            {title}
          </Text>
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}

/**
 * Guided Google Sheet usage-logging setup, grouped into ONE bordered card with a
 * header so it reads as a single feature rather than blending into the flat tool
 * rows around it. Three responsive steps (credentials → connect Google → force
 * switch) sit side-by-side on desktop and stack on mobile. Every step is gated on
 * the previous one, and the switch flips on automatically after a successful
 * connect — so a non-technical user is walked through it with no terminal.
 */
export function UsageLoggingSetup() {
  const t = useT();
  const status = useUsageLogging();
  const upload = useUploadCredentials();
  const authenticate = useAuthenticateGoogle();
  const setEnabled = useSetUsageLogging();
  const fileRef = useRef<HTMLInputElement>(null);
  const s = status.data;
  if (!s) return null;

  const blockedReason = !s.hasCredentials
    ? t('usage.needCreds')
    : !s.hasSpreadsheetId
      ? t('usage.needSheetId')
      : !s.hasToken
        ? t('usage.needAuth')
        : '';

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const content = await file.text();
    upload.mutate(
      { tool: GOOGLE_TOOL, content },
      {
        onSuccess: () => toast.success(`${t('creds.uploadedFor')} ${GOOGLE_TOOL}`),
        onError: (err) => toast.error(err instanceof Error ? err.message : t('creds.uploadFailed')),
      },
    );
  }

  const handleConnect = () => {
    toast.info(t('auth.opening'));
    authenticate.mutate(undefined, {
      onSuccess: () => toast.success(t('auth.connected')),
      onError: (err) => toast.error(err instanceof Error ? err.message : t('auth.failed')),
    });
  };

  const handleToggle = (next: boolean) => {
    setEnabled.mutate(next, {
      onSuccess: () => toast.success(next ? t('usage.enabled') : t('usage.disabled')),
      onError: (err) => toast.error(err instanceof Error ? err.message : t('usage.toggleFailed')),
    });
  };

  return (
    <Paper
      radius="md"
      p="sm"
      withBorder
      style={{ borderLeft: '3px solid var(--mantine-primary-color-filled)' }}
    >
      <Group gap={8} wrap="nowrap" mb={4}>
        <ThemeIcon size={20} radius="sm" variant="light">
          <TbTable size={13} />
        </ThemeIcon>
        <Text size="sm" fw={600}>
          {t('usage.setupTitle')}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        {t('usage.setupHint')}
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        {/* Step 1 — upload Google credentials.json */}
        <SetupStep step={1} title={t('creds.title')}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            {s.hasCredentials ? (
              <Badge size="xs" color="green" leftSection={<TbCircleCheck size={10} />}>
                {t('creds.set')}
              </Badge>
            ) : (
              <Badge size="xs" color="red" leftSection={<TbAlertTriangle size={10} />}>
                {t('creds.missing')}
              </Badge>
            )}
            <input
              type="file"
              accept="application/json,.json"
              hidden
              ref={fileRef}
              onChange={onFile}
            />
            <Button
              size="compact-xs"
              variant={s.hasCredentials ? 'default' : 'filled'}
              color={s.hasCredentials ? undefined : 'red'}
              leftSection={<TbUpload size={12} />}
              loading={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {s.hasCredentials ? t('creds.replace') : t('creds.upload')}
            </Button>
          </Group>
        </SetupStep>

        {/* Step 2 — connect the Google account (interactive OAuth) */}
        <SetupStep step={2} title={t('auth.title')}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            {!s.hasCredentials ? (
              <Badge size="xs" color="gray">
                {t('auth.needCreds')}
              </Badge>
            ) : s.hasToken ? (
              <Badge size="xs" color="green" leftSection={<TbCircleCheck size={10} />}>
                {t('auth.connected')}
              </Badge>
            ) : (
              <Badge size="xs" color="yellow" leftSection={<TbAlertTriangle size={10} />}>
                {t('auth.notConnected')}
              </Badge>
            )}
            <Tooltip
              label={t('auth.needCreds')}
              disabled={s.hasCredentials}
              withArrow
              position="top"
            >
              <Box>
                <Button
                  size="compact-xs"
                  variant={s.hasToken ? 'default' : 'filled'}
                  leftSection={<TbBrandGoogle size={12} />}
                  loading={authenticate.isPending}
                  disabled={!s.hasCredentials}
                  onClick={handleConnect}
                >
                  {authenticate.isPending
                    ? t('auth.connecting')
                    : s.hasToken
                      ? t('auth.reconnect')
                      : t('auth.connect')}
                </Button>
              </Box>
            </Tooltip>
          </Group>
        </SetupStep>

        {/* Step 3 — force usage logging on/off (auto-on once ready) */}
        <SetupStep step={3} title={t('usage.title')}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
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
            <Tooltip label={blockedReason} disabled={s.ready} withArrow position="top">
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
        </SetupStep>
      </SimpleGrid>
    </Paper>
  );
}
