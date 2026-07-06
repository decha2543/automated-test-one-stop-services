import type { Bookmark, RunRequest } from '@hub/shared';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  TbBookmark,
  TbBookmarkPlus,
  TbCheck,
  TbDeviceFloppy,
  TbPencil,
  TbSearch,
  TbTrash,
  TbX,
} from 'react-icons/tb';
import { api } from '~/api/client.js';
import { CollapsibleCard } from '~/components/CollapsibleCard.js';
import { confirmDialog } from '~/components/confirmDialog.js';
import { toast } from '~/components/Toast.js';
import { useTools } from '~/hooks/useTools.js';
import { useT } from '~/i18n/index.js';
import { toolLabel } from '~/utils/tool-label.js';

interface BookmarkPanelProps {
  /** Pulls the LIVE run-form config at click time (not a stale render snapshot). */
  getConfig: () => RunRequest;
  onLoad: (config: RunRequest) => void;
  disabled?: boolean;
}

interface SaveBookmarkPayload {
  name: string;
  config: RunRequest;
}

/** Stable-ish accent per tool so Playwright/Robot/k6 groups are tellable at a glance. */
const TOOL_COLORS = ['blue', 'grape', 'teal', 'orange', 'cyan', 'pink', 'indigo'] as const;
function toolColor(toolId: string): string {
  let h = 0;
  for (let i = 0; i < toolId.length; i++) h = (h * 31 + toolId.charCodeAt(i)) | 0;
  return TOOL_COLORS[Math.abs(h) % TOOL_COLORS.length] as string;
}

/** The bits that vary within a tool/type/project group — shown on each row. */
function leafDigest(c: RunRequest): string {
  const parts: string[] = [c.mode];
  if (c.tag) parts.push(c.tag);
  if (c.section) parts.push(c.section);
  if (c.performanceType) parts.push(c.performanceType);
  if (c.headless) parts.push(c.headless);
  if (c.silent) parts.push('silent');
  if (c.noTrack) parts.push('no-track');
  return parts.filter(Boolean).join(' · ');
}

interface TreeGroup {
  key: string;
  tool: string;
  type: string;
  project: string;
  items: Bookmark[];
}

/**
 * Bookmarks as a self-contained SECTION at the top of the Run page (not a
 * hidden popover). Collapse the whole section to reclaim space; when open it
 * shows every saved run config grouped by tool → type → project. Click a row
 * to autofill; rename/delete happen inline. Save the current form as a new one
 * from the header.
 */
export function BookmarkPanel({ getConfig, onLoad, disabled }: BookmarkPanelProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const tools = useTools().data ?? [];
  // Collapsed by default so the run form + live output (the real work) own the
  // top of the page; the header stays a slim, discoverable bar (count + Save).
  const [sectionOpen, { toggle: toggleSection }] = useDisclosure(false);
  const [q, setQ] = useState('');
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const bookmarks = useQuery<Bookmark[]>({
    queryKey: ['bookmarks'],
    queryFn: () => api.get('/api/bookmarks'),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: SaveBookmarkPayload) => api.post('/api/bookmarks', payload),
    onSuccess: () => {
      toast.success(t('bookmark.saved'));
      setShowSave(false);
      setName('');
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/bookmarks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookmarks'] }),
  });

  const list = bookmarks.data ?? [];

  const groups = useMemo<TreeGroup[]>(() => {
    const query = q.trim().toLowerCase();
    const match = list.filter(
      (bm) =>
        !query ||
        bm.name.toLowerCase().includes(query) ||
        bm.config.project.toLowerCase().includes(query) ||
        bm.config.type.toLowerCase().includes(query) ||
        bm.config.tool.toLowerCase().includes(query) ||
        (bm.config.tag?.toLowerCase().includes(query) ?? false),
    );
    const map = new Map<string, TreeGroup>();
    for (const bm of match) {
      const { tool, type, project } = bm.config;
      const key = `${tool}|${type}|${project}`;
      const g = map.get(key);
      if (g) g.items.push(bm);
      else map.set(key, { key, tool, type, project, items: [bm] });
    }
    return [...map.values()].sort(
      (a, b) =>
        toolLabel(a.tool, tools).localeCompare(toolLabel(b.tool, tools)) ||
        a.type.localeCompare(b.type) ||
        a.project.localeCompare(b.project),
    );
  }, [list, q, tools]);

  function handleSaveNew() {
    if (!name.trim()) return;
    saveMutation.mutate({ name: name.trim(), config: getConfig() });
  }

  async function handleDelete(id: string) {
    const ok = await confirmDialog({
      title: t('bookmark.removeTitle'),
      message: t('bookmark.removeConfirm'),
      confirmLabel: t('common.remove'),
      danger: true,
    });
    if (ok) {
      if (editingId === id) setEditingId(null);
      deleteMutation.mutate(id);
    }
  }

  const canSave = !disabled && !!getConfig().project;

  return (
    <CollapsibleCard
      icon={<TbBookmark size={16} />}
      title={t('bookmark.title')}
      titleAfter={
        <Badge size="sm" variant="light" circle>
          {list.length}
        </Badge>
      }
      open={sectionOpen}
      onToggle={toggleSection}
      actions={
        <>
          {sectionOpen && list.length > 6 && (
            <TextInput
              size="xs"
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              placeholder={t('bookmark.searchPlaceholder')}
              leftSection={<TbSearch size={12} />}
              w={180}
            />
          )}
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<TbBookmarkPlus size={13} />}
            onClick={() => {
              setShowSave((v) => !v);
              if (!sectionOpen) toggleSection();
            }}
            disabled={!canSave}
          >
            {t('bookmark.saveCurrent')}
          </Button>
        </>
      }
    >
      <Stack gap="xs" pt="xs">
        {/* Inline "save current config" row */}
        {showSave && (
          <Group gap="xs" wrap="nowrap">
            <TextInput
              size="xs"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder={t('bookmark.namePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNew();
                if (e.key === 'Escape') setShowSave(false);
              }}
              style={{ flex: 1 }}
              data-autofocus
            />
            <Button
              size="compact-xs"
              color="green"
              onClick={handleSaveNew}
              loading={saveMutation.isPending}
              disabled={!name.trim()}
            >
              {t('common.save')}
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={() => setShowSave(false)}
            >
              {t('common.cancel')}
            </Button>
          </Group>
        )}

        {bookmarks.isLoading && <Loader size="sm" />}

        {!bookmarks.isLoading && list.length === 0 && (
          <Text size="xs" c="dimmed" py="xs">
            {t('bookmark.empty')}
          </Text>
        )}

        {!bookmarks.isLoading && list.length > 0 && groups.length === 0 && (
          <Text size="xs" c="dimmed" ta="center" py="xs">
            {t('bookmark.noMatch')}
          </Text>
        )}

        {groups.length > 0 && (
          <ScrollArea.Autosize mah={260} type="auto">
            <Stack gap="md">
              {groups.map((g) => (
                <Stack key={g.key} gap={4}>
                  {/* Group label: tool · type · project */}
                  <Group gap={6} wrap="nowrap">
                    <Badge size="xs" variant="dot" color={toolColor(g.tool)}>
                      {toolLabel(g.tool, tools)}
                    </Badge>
                    <Text size="xs" fw={500} c="dimmed" truncate>
                      {g.type} · {g.project}
                    </Text>
                  </Group>
                  {/* Bookmark chips/rows for this group */}
                  <Group gap={6} pl={4}>
                    {g.items.map((bm) =>
                      editingId === bm.id ? (
                        <InlineEdit
                          key={bm.id}
                          bookmark={bm}
                          getConfig={getConfig}
                          onDone={() => setEditingId(null)}
                        />
                      ) : (
                        <BookmarkChip
                          key={bm.id}
                          bookmark={bm}
                          applyDisabled={disabled}
                          onApply={() => !disabled && onLoad(bm.config)}
                          onEdit={() => setEditingId(bm.id)}
                          onDelete={() => handleDelete(bm.id)}
                        />
                      ),
                    )}
                  </Group>
                </Stack>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Stack>
    </CollapsibleCard>
  );
}

/**
 * One saved run config as a compact "chip" card: click the name to autofill,
 * hover reveals rename/delete. Kept as a bordered pill so a group can lay them
 * out side by side and still read cleanly.
 */
function BookmarkChip({
  bookmark,
  applyDisabled,
  onApply,
  onEdit,
  onDelete,
}: {
  bookmark: Bookmark;
  applyDisabled?: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const digest = leafDigest(bookmark.config);
  return (
    <Paper withBorder radius="sm" px={8} py={4} style={{ maxWidth: 260 }}>
      <Group gap={4} wrap="nowrap">
        <Tooltip label={digest || t('bookmark.apply')} withArrow openDelay={400} multiline>
          <UnstyledButton
            onClick={onApply}
            disabled={applyDisabled}
            style={{
              minWidth: 0,
              opacity: applyDisabled ? 0.5 : 1,
              cursor: applyDisabled ? 'default' : 'pointer',
            }}
          >
            <Text size="xs" fw={600} truncate>
              {bookmark.name}
            </Text>
          </UnstyledButton>
        </Tooltip>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xs"
          onClick={onEdit}
          aria-label={t('bookmark.edit')}
        >
          <TbPencil size={12} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="red"
          size="xs"
          onClick={onDelete}
          aria-label={t('bookmark.delete')}
        >
          <TbTrash size={12} />
        </ActionIcon>
      </Group>
    </Paper>
  );
}

/** Inline rename + optional "grab current form" — no modal, no page jump. */
function InlineEdit({
  bookmark,
  getConfig,
  onDone,
}: {
  bookmark: Bookmark;
  getConfig: () => RunRequest;
  onDone: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(bookmark.name);
  const [pendingConfig, setPendingConfig] = useState<RunRequest | null>(null);

  const updateMutation = useMutation({
    mutationFn: (body: { name: string; config?: RunRequest }) =>
      api.put(`/api/bookmarks/${bookmark.id}`, body),
    onSuccess: () => {
      toast.success(t('bookmark.updated'));
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
      onDone();
    },
  });

  function captureForm() {
    const live = getConfig();
    if (!live.project) {
      toast.error(t('bookmark.noFormConfig'));
      return;
    }
    setPendingConfig(live);
    toast.success(t('bookmark.synced'));
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateMutation.mutate({ name: trimmed, ...(pendingConfig ? { config: pendingConfig } : {}) });
  }

  return (
    <Paper
      withBorder
      radius="sm"
      px={6}
      py={4}
      style={{ borderColor: 'var(--mantine-color-brand-filled)' }}
    >
      <Group gap={4} wrap="nowrap">
        <TextInput
          size="xs"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') onDone();
          }}
          w={140}
          data-autofocus
        />
        <Tooltip
          label={pendingConfig ? t('bookmark.synced') : t('bookmark.syncFromForm')}
          withArrow
        >
          <ActionIcon
            variant={pendingConfig ? 'filled' : 'subtle'}
            color={pendingConfig ? 'green' : 'grape'}
            size="sm"
            onClick={captureForm}
            aria-label={t('bookmark.syncFromForm')}
          >
            <TbDeviceFloppy size={13} />
          </ActionIcon>
        </Tooltip>
        <ActionIcon
          variant="filled"
          color="green"
          size="sm"
          onClick={handleSave}
          loading={updateMutation.isPending}
          disabled={!name.trim()}
          aria-label={t('common.save')}
        >
          <TbCheck size={13} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={onDone}
          aria-label={t('common.cancel')}
        >
          <TbX size={13} />
        </ActionIcon>
      </Group>
    </Paper>
  );
}
