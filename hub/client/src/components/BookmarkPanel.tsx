import type { Bookmark, RunRequest } from '@hub/shared';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Kbd,
  Loader,
  Menu,
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
  TbCheck,
  TbChevronDown,
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

export interface SaveBookmarkPayload {
  name: string;
  config: RunRequest;
}

/**
 * The one write path for "save this run-form config as a new bookmark". It lives
 * next to the list it invalidates and is called from the Run footer's save
 * action, the only place that creates a bookmark. Callers add their own per-call
 * `onSuccess` for local UI (closing the modal, clearing a field).
 */
export function useSaveBookmark() {
  const t = useT();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveBookmarkPayload) => api.post<Bookmark>('/api/bookmarks', payload),
    onSuccess: () => {
      toast.success(t('bookmark.saved'));
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });
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
  if (c.discardReport) parts.push('no report');
  if (c.noTrack) parts.push('no-track');
  return parts.filter(Boolean).join(' · ');
}

/** How many bookmarks the inline panel shows at rest. The rest live behind the
 * panel's search field and ⌘K, so the list cannot grow into the run form. */
const RECENT_CAP = 5;

/** Newest first. `createdAt` is an ISO timestamp, so a lexical compare is chronological. */
function byNewest(a: Bookmark, b: Bookmark): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** `query` must already be trimmed + lowercased; an empty query matches everything. */
function matchesQuery(bm: Bookmark, query: string): boolean {
  if (!query) return true;
  const c = bm.config;
  return (
    bm.name.toLowerCase().includes(query) ||
    c.project.toLowerCase().includes(query) ||
    c.type.toLowerCase().includes(query) ||
    c.tool.toLowerCase().includes(query) ||
    (c.tag?.toLowerCase().includes(query) ?? false)
  );
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
 * shows the `RECENT_CAP` newest saved run configs, grouped by tool → type →
 * project, with the count of what is hidden — searching the panel or ⌘K reaches
 * the rest. Click a row to autofill; rename/delete happen inline. New bookmarks
 * are created from the Run footer's save action, not here.
 */
export function BookmarkPanel({ getConfig, onLoad, disabled }: BookmarkPanelProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const tools = useTools().data ?? [];
  // Collapsed by default so the run form + live output (the real work) own the
  // top of the page; the header stays a slim, discoverable bar (count + search).
  const [sectionOpen, { toggle: toggleSection }] = useDisclosure(false);
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const bookmarks = useQuery<Bookmark[]>({
    queryKey: ['bookmarks'],
    queryFn: () => api.get('/api/bookmarks'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/bookmarks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookmarks'] }),
  });

  const list = bookmarks.data ?? [];

  // A search shows every match; at rest only the newest `RECENT_CAP` render, so
  // the group order below stays stable while the panel keeps a fixed height cost.
  const { groups, hiddenCount } = useMemo(() => {
    const query = q.trim().toLowerCase();
    const matched = list.filter((bm) => matchesQuery(bm, query));
    const visible = query ? matched : [...matched].sort(byNewest).slice(0, RECENT_CAP);
    const map = new Map<string, TreeGroup>();
    for (const bm of visible) {
      const { tool, type, project } = bm.config;
      const key = `${tool}|${type}|${project}`;
      const g = map.get(key);
      if (g) g.items.push(bm);
      else map.set(key, { key, tool, type, project, items: [bm] });
    }
    const sorted = [...map.values()].sort(
      (a, b) =>
        toolLabel(a.tool, tools).localeCompare(toolLabel(b.tool, tools)) ||
        a.type.localeCompare(b.type) ||
        a.project.localeCompare(b.project),
    );
    return { groups: sorted, hiddenCount: query ? 0 : list.length - visible.length };
  }, [list, q, tools]);

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
        sectionOpen &&
        list.length > RECENT_CAP && (
          <TextInput
            size="xs"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            placeholder={t('bookmark.searchPlaceholder')}
            leftSection={<TbSearch size={12} />}
            w={180}
          />
        )
      }
    >
      <Stack gap="xs" pt="xs">
        {bookmarks.isLoading && <Loader size="sm" />}

        {!bookmarks.isLoading && list.length === 0 && (
          <Stack gap={2} py="xs">
            <Text size="xs" c="dimmed">
              {t('bookmark.empty')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('bookmark.hint')}
            </Text>
          </Stack>
        )}

        {!bookmarks.isLoading && list.length > 0 && groups.length === 0 && (
          <Text size="xs" c="dimmed" ta="center" py="xs">
            {t('bookmark.noMatch')}
          </Text>
        )}

        {groups.length > 0 && (
          <ScrollArea.Autosize mah="30vh" type="auto">
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

        {hiddenCount > 0 && (
          <Group gap={6} wrap="nowrap">
            <Badge size="xs" variant="light" color="gray">
              +{hiddenCount}
            </Badge>
            <Text size="xs" c="dimmed" truncate>
              {t('bookmark.load')}
            </Text>
            <Kbd size="xs">⌘K</Kbd>
          </Group>
        )}
      </Stack>
    </CollapsibleCard>
  );
}

interface BookmarkLoadMenuProps {
  /** Pulls the LIVE run-form config of the active session — the filter scope. */
  getConfig: () => RunRequest;
  onLoad: (config: RunRequest) => void;
}

/**
 * The compact load path that lives beside the run page's session tabs: a
 * dropdown, so it costs no page height. It opens scoped to the run target of
 * the active session (tool + type + project) and falls back to the full list
 * when that scope holds no bookmarks or the user asks for all of them. Loading
 * goes through the caller's `onLoad` — the same handler the inline panel uses.
 */
export function BookmarkLoadMenu({ getConfig, onLoad }: BookmarkLoadMenuProps) {
  const t = useT();
  const tools = useTools().data ?? [];
  const [scope, setScope] = useState<RunRequest | null>(null);
  const [showAll, setShowAll] = useState(false);

  const bookmarks = useQuery<Bookmark[]>({
    queryKey: ['bookmarks'],
    queryFn: () => api.get('/api/bookmarks'),
  });

  const list = bookmarks.data ?? [];

  const visible = useMemo(() => {
    const scoped = scope?.project
      ? list.filter(
          (bm) =>
            bm.config.tool === scope.tool &&
            bm.config.type === scope.type &&
            bm.config.project === scope.project,
        )
      : [];
    return [...(showAll || scoped.length === 0 ? list : scoped)].sort(byNewest);
  }, [list, scope, showAll]);

  const restCount = list.length - visible.length;
  const scopeLabel =
    restCount > 0 && scope ? `${toolLabel(scope.tool, tools)} · ${scope.project}` : t('common.all');

  return (
    <Menu
      position="bottom-end"
      withArrow
      shadow="md"
      width={280}
      onOpen={() => {
        setScope(getConfig());
        setShowAll(false);
      }}
    >
      <Menu.Target>
        <Button
          size="xs"
          variant="light"
          color="gray"
          leftSection={<TbBookmark size={14} />}
          rightSection={<TbChevronDown size={12} />}
        >
          {t('bookmark.load')}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {bookmarks.isLoading && (
          <Group justify="center" py="xs">
            <Loader size="xs" />
          </Group>
        )}

        {!bookmarks.isLoading && list.length === 0 && (
          <Text size="xs" c="dimmed" p="xs">
            {t('bookmark.empty')}
          </Text>
        )}

        {visible.length > 0 && <Menu.Label>{scopeLabel}</Menu.Label>}

        <ScrollArea.Autosize mah="40vh" type="auto">
          {visible.map((bm) => (
            <Menu.Item key={bm.id} onClick={() => onLoad(bm.config)}>
              <Text size="xs" fw={500} lineClamp={1}>
                {bm.name}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {bm.config.project} · {leafDigest(bm.config)}
              </Text>
            </Menu.Item>
          ))}
        </ScrollArea.Autosize>

        {restCount > 0 && (
          <>
            <Menu.Divider />
            <Menu.Item closeMenuOnClick={false} onClick={() => setShowAll(true)}>
              <Group gap={6} wrap="nowrap">
                <Text size="xs">{t('common.all')}</Text>
                <Badge size="xs" variant="light" color="gray">
                  {list.length}
                </Badge>
              </Group>
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
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
