import { Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { type ChangeEvent, useRef } from 'react';
import { TbAlertTriangle, TbCircleCheck, TbUpload } from 'react-icons/tb';
import { toast } from '~/components/Toast.js';
import {
  type CredentialStatus,
  useCredentials,
  useUploadCredentials,
} from '~/hooks/useCredentials.js';
import { useT } from '~/i18n/index.js';

function CredentialRow({ status }: { status: CredentialStatus }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadCredentials();

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const content = await file.text();
    upload.mutate(
      { tool: status.tool, content },
      {
        onSuccess: () => toast.success(`${t('creds.uploadedFor')} ${status.tool}`),
        onError: (err) => toast.error(err instanceof Error ? err.message : t('creds.uploadFailed')),
      },
    );
  }

  return (
    <Paper p="xs" radius="sm" bg="var(--mantine-color-default-hover)" withBorder>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" ff="monospace" truncate>
            scripts/third-party/{status.tool}/credentials
          </Text>
          {status.hasCredentials ? (
            <Badge size="xs" color="green" leftSection={<TbCircleCheck size={10} />}>
              {t('creds.set')}
            </Badge>
          ) : (
            <Badge size="xs" color="red" leftSection={<TbAlertTriangle size={10} />}>
              {t('creds.missing')}
            </Badge>
          )}
        </Group>
        <input
          type="file"
          accept="application/json,.json"
          hidden
          ref={inputRef}
          onChange={onFile}
        />
        <Button
          size="compact-xs"
          variant={status.hasCredentials ? 'default' : 'filled'}
          color={status.hasCredentials ? undefined : 'red'}
          leftSection={<TbUpload size={12} />}
          loading={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {status.hasCredentials ? t('creds.replace') : t('creds.upload')}
        </Button>
      </Group>
    </Paper>
  );
}

/**
 * Lists third-party integrations (e.g. Google OAuth) that ship a
 * `credentials/` folder and lets the user upload the missing
 * `credentials.json`. Rendered inside the scripts/.env section on the
 * Projects page. Renders nothing when no integration declares credentials.
 */
export function CredentialsPanel() {
  const creds = useCredentials();
  const tools = creds.data?.tools ?? [];
  if (tools.length === 0) return null;
  return (
    <Stack gap={4}>
      {tools.map((t) => (
        <CredentialRow key={t.tool} status={t} />
      ))}
    </Stack>
  );
}
