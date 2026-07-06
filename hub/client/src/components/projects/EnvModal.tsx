import type { EnvFile } from '@hub/shared';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useEffect, useRef } from 'react';
import { TbAlertTriangle, TbPlus, TbTrash } from 'react-icons/tb';
import { api } from '~/api/client.js';
import { FormModal } from '~/components/FormModal.js';
import { toast } from '~/components/Toast.js';
import { useT } from '~/i18n/index.js';

export interface EnvEntry {
  key: string;
  value: string;
}

export interface EnvModalEditingTarget {
  tool: string;
  type: string;
  project: string;
}

interface EnvModalProps {
  opened: boolean;
  title: string;
  envData: EnvFile | undefined;
  isLoading: boolean;
  entries: EnvEntry[];
  setEntries: (e: EnvEntry[]) => void;
  onPopulate: () => void;
  onSave: () => void;
  onClose: () => void;
  isSaving: boolean;
  editingEnv: EnvModalEditingTarget | null;
}

/**
 * Modal editor for a project's `.env` (or scripts/.env) file. Lets the user
 * add, rename, edit, and remove KEY=VALUE pairs and merge missing keys from
 * a `.env.template` when one exists alongside the project.
 */
export function EnvModal({
  opened,
  title,
  envData,
  isLoading,
  entries,
  setEntries,
  onPopulate,
  onSave,
  onClose,
  isSaving,
  editingEnv,
}: EnvModalProps) {
  const t = useT();
  // Seed editable entries from server data. Re-seed whenever a NEW `envData`
  // object arrives for an open modal (initial load OR a post-save refetch),
  // and reset on close so the next open re-seeds. The old `entries.length === 0`
  // guard caused stale values after save: React Query served the stale cache
  // first (seeding the old entries), and the guard then blocked re-seeding once
  // the fresh refetch landed. Tracking the seeded `envData` reference fixes that
  // without clobbering in-progress edits (envData only changes on (re)fetch,
  // not on keystrokes).
  const seededFor = useRef<EnvFile | undefined>(undefined);
  useEffect(() => {
    if (!opened) {
      seededFor.current = undefined;
      return;
    }
    if (envData && envData !== seededFor.current) {
      seededFor.current = envData;
      onPopulate();
    }
  }, [opened, envData, onPopulate]);

  const emptyValues = entries.filter((e) => e.key && !e.value);

  async function handleLoadFromTemplate() {
    if (!editingEnv || editingEnv.tool === 'scripts') return;
    try {
      const res = (await api.get(
        `/api/env/template?tool=${editingEnv.tool}&type=${editingEnv.type}&project=${editingEnv.project}`,
      )) as { entries: EnvEntry[] };
      // Merge: keep existing values, add new keys from template
      const existingKeys = new Map(entries.map((e) => [e.key, e.value]));
      const merged = [...entries];
      for (const tpl of res.entries) {
        if (!existingKeys.has(tpl.key)) {
          merged.push({ key: tpl.key, value: tpl.value });
        }
      }
      setEntries(merged);
      toast.success(t('env.templateMerged'));
    } catch {
      toast.error(t('env.templateLoadFailed'));
    }
  }

  return (
    <FormModal
      opened={opened}
      onClose={onClose}
      title={title}
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
      submitLabel={t('common.save')}
      submitColor="green"
      onSubmit={onSave}
      loading={isSaving}
    >
      <Stack gap="xs">
        {isLoading && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text c="dimmed" size="sm">
              {t('common.loading')}
            </Text>
          </Group>
        )}
        {emptyValues.length > 0 && (
          <Alert icon={<TbAlertTriangle size={14} />} color="orange" variant="light">
            <Text size="xs">
              {emptyValues.length} {t('env.keysEmptySuffix')}:{' '}
              {emptyValues.map((e) => e.key).join(', ')}
            </Text>
          </Alert>
        )}
        {entries.map((entry, idx) => (
          <Group key={idx as number} gap="xs" wrap="nowrap">
            <TextInput
              size="xs"
              w={180}
              value={entry.key}
              onChange={(e) => {
                const c = [...entries];
                c[idx] = { ...entry, key: e.currentTarget.value };
                setEntries(c);
              }}
              styles={{ input: { fontFamily: 'monospace' } }}
              placeholder="KEY"
            />
            <Text size="xs" c="dimmed">
              =
            </Text>
            <TextInput
              size="xs"
              style={{ flex: 1 }}
              value={entry.value}
              onChange={(e) => {
                const c = [...entries];
                c[idx] = { ...entry, value: e.currentTarget.value };
                setEntries(c);
              }}
              styles={{
                input: {
                  fontFamily: 'monospace',
                  borderColor:
                    entry.key && !entry.value ? 'var(--mantine-color-orange-6)' : undefined,
                },
              }}
              placeholder="value"
            />
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              onClick={() => setEntries(entries.filter((_, i) => i !== idx))}
              aria-label={t('env.removeEntry')}
            >
              <TbTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<TbPlus size={12} />}
          onClick={() => setEntries([...entries, { key: '', value: '' }])}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('env.addEntry')}
        </Button>

        {envData?.hasTemplate && editingEnv && editingEnv.tool !== 'scripts' && (
          <Button
            size="compact-xs"
            variant="light"
            color="blue"
            onClick={handleLoadFromTemplate}
            style={{ alignSelf: 'flex-start' }}
          >
            {t('envProfiles.loadFromTemplate')}
          </Button>
        )}
      </Stack>
    </FormModal>
  );
}
