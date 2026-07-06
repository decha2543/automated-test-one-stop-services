import { ActionIcon, Badge, Button, Group, Modal, Stack, TextInput, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useState } from 'react';
import { TbBookmark, TbPlus, TbTrash } from 'react-icons/tb';
import { toast } from '~/components/Toast';
import { useT } from '~/i18n/index.js';

export interface FilterPreset {
  id: string;
  name: string;
  filters: Record<string, unknown>;
}

const STORAGE_KEY = 'hub-saved-filters';

function loadPresets(page: string): FilterPreset[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${page}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(page: string, presets: FilterPreset[]): void {
  localStorage.setItem(`${STORAGE_KEY}-${page}`, JSON.stringify(presets));
}

export function SavedFiltersBar({
  page,
  currentFilters,
  onLoad,
}: {
  page: string;
  currentFilters: Record<string, unknown>;
  onLoad: (filters: Record<string, unknown>) => void;
}) {
  const [presets, setPresets] = useState<FilterPreset[]>(() => loadPresets(page));
  const [saveOpen, { open: openSave, close: closeSave }] = useDisclosure(false);
  const [newName, setNewName] = useState('');
  const t = useT();

  function handleSave() {
    if (!newName.trim()) return;
    const preset: FilterPreset = {
      id: Math.random().toString(36).slice(2, 10),
      name: newName.trim(),
      filters: currentFilters,
    };
    const updated = [...presets, preset];
    setPresets(updated);
    savePresets(page, updated);
    setNewName('');
    closeSave();
    toast.success(`${t('savedFilters.saved')} (${preset.name})`);
  }

  function handleDelete(id: string) {
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    savePresets(page, updated);
    toast.success(t('savedFilters.deleted'));
  }

  function handleLoad(preset: FilterPreset) {
    onLoad(preset.filters);
    toast.info(`${t('savedFilters.loaded')}: ${preset.name}`);
  }

  const hasActiveFilters = Object.values(currentFilters).some((v) => {
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (v instanceof Set) return v.size > 0;
    return true;
  });

  return (
    <>
      <Group gap="xs" wrap="wrap">
        {presets.map((p) => (
          <Group key={p.id} gap={2}>
            <Badge
              size="sm"
              variant="light"
              color="violet"
              style={{ cursor: 'pointer' }}
              leftSection={<TbBookmark size={10} />}
              onClick={() => handleLoad(p)}
            >
              {p.name}
            </Badge>
            <Tooltip label={t('savedFilters.remove')}>
              <ActionIcon
                variant="subtle"
                size="xs"
                color="gray"
                onClick={() => handleDelete(p.id)}
              >
                <TbTrash size={10} />
              </ActionIcon>
            </Tooltip>
          </Group>
        ))}
        {hasActiveFilters && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="violet"
            leftSection={<TbPlus size={10} />}
            onClick={openSave}
          >
            {t('savedFilters.saveFilter')}
          </Button>
        )}
      </Group>

      <Modal
        opened={saveOpen}
        onClose={closeSave}
        title={t('savedFilters.saveTitle')}
        size="xs"
        centered
      >
        <Stack gap="sm">
          <TextInput
            label={t('webhook.name')}
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            placeholder="e.g. Failed Playwright this week"
            size="xs"
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={closeSave} size="xs">
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!newName.trim()} size="xs">
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
