import {
  TAG_KIND_ORDER,
  type TagGroup,
  type TagGroupKind,
  type TagsResponse,
  type TestSummary,
} from '@hub/shared';
import {
  Badge,
  Button,
  Collapse,
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
import { type ReactNode, useMemo, useState } from 'react';
import { TbCheck, TbChevronDown, TbChevronRight, TbSearch, TbTag, TbX } from 'react-icons/tb';
import { useT } from '~/i18n/index.js';
import { matchTests } from '~/utils/tag-selection';

interface TagSelectorProps {
  tags: TagsResponse | undefined;
  isLoading: boolean;
  selectedTags: string[];
  onChange: (next: string[]) => void;
  /**
   * Fill the parent's height and make the category-group list the only scroll
   * region (used in the Run form, so the surrounding fields stay fixed and the
   * panel bottom sits flush). Default: autosize the list up to a capped height.
   */
  fill?: boolean;
}

// Stable group display order — single source of truth: @hub/shared.
function groupRank(kind: TagGroupKind): number {
  const index = TAG_KIND_ORDER.indexOf(kind);
  return index === -1 ? TAG_KIND_ORDER.length : index;
}

const GROUP_COLORS: Record<string, string> = {
  severity: 'red',
  'test-type': 'grape',
  'flow-type': 'orange',
  device: 'cyan',
  domain: 'teal',
  'domain-single': 'green',
  'case-id': 'gray',
};

/**
 * Scroll wrapper for the category-group list.
 * - `fill`: fills the parent's remaining height and scrolls, so ONLY this list
 *   scrolls while the surrounding form stays fixed (Run form).
 * - default: autosizes up to a capped height (e.g. schedule form).
 */
function GroupList({ fill, children }: { fill: boolean; children: ReactNode }) {
  if (fill) {
    return (
      <Paper
        withBorder
        style={{
          overflow: 'hidden',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ScrollArea type="auto" scrollbarSize={8} style={{ flex: 1, minHeight: 0 }}>
          {children}
        </ScrollArea>
      </Paper>
    );
  }
  return (
    <Paper withBorder style={{ overflow: 'hidden' }}>
      <ScrollArea.Autosize mah="40vh">{children}</ScrollArea.Autosize>
    </Paper>
  );
}

export function TagSelector({
  tags,
  isLoading,
  selectedTags,
  onChange,
  fill = false,
}: TagSelectorProps) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['case-id']));
  const [showMatchedTests, setShowMatchedTests] = useState(false);

  const tests = tags?.tests ?? [];
  const totalCount = tests.length;

  // Tests that match current selection (deduped by id+title — reporters
  // sometimes emit the same logical test twice across scenarios).
  const matchedTests = useMemo<TestSummary[]>(() => {
    if (totalCount === 0) return [];
    const matched = matchTests(tests, selectedTags);
    const seen = new Set<string>();
    const unique: TestSummary[] = [];
    for (const t of matched) {
      const key = `${t.id}\u0001${t.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(t);
    }
    return unique;
  }, [tests, selectedTags, totalCount]);

  const matchingCount = matchedTests.length;
  const isFiltered = selectedTags.length > 0;
  const matchColor =
    matchingCount === 0 ? 'red' : isFiltered && matchingCount < totalCount ? 'green' : 'blue';

  // Simple toggle: just add or remove.
  function toggle(tag: string) {
    onChange(
      selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...new Set([...selectedTags, tag])],
    );
  }

  function toggleGroup(kind: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  // Sort groups in stable order.
  const orderedGroups = useMemo<TagGroup[]>(() => {
    if (!tags) return [];
    return [...tags.groups].sort((a, b) => groupRank(a.kind) - groupRank(b.kind));
  }, [tags]);

  // Filter by search.
  const searchLower = search.toLowerCase();
  const filteredGroups = orderedGroups
    .map((g) => ({ ...g, tags: g.tags.filter((t) => t.toLowerCase().includes(searchLower)) }))
    .filter((g) => g.tags.length > 0);

  if (isLoading) {
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="xs" c="dimmed">
          {t('run.loadingTags')}
        </Text>
      </Group>
    );
  }

  if (!tags || tags.all.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        {t('tagSelector.noTags')}
      </Text>
    );
  }

  return (
    <Stack gap="xs" style={fill ? { flex: 1, minHeight: 0 } : undefined}>
      {/* ─── Match panel ON TOP ─── */}
      {totalCount > 0 && (
        <Paper
          withBorder
          p="sm"
          style={{
            borderColor: `var(--mantine-color-${matchColor}-6)`,
            borderWidth: 2,
            backgroundColor: `var(--mantine-color-${matchColor}-light)`,
          }}
        >
          <Stack gap={6}>
            <Group justify="space-between" wrap="nowrap">
              <Group gap={6} wrap="nowrap">
                <TbCheck size={16} color={`var(--mantine-color-${matchColor}-7)`} />
                <Text size="sm" fw={700} c={`${matchColor}.8`}>
                  {matchingCount === 0
                    ? t('tagSelector.noMatch')
                    : isFiltered
                      ? `${t('tagSelector.willRun')} ${matchingCount}/${totalCount} ${t('tagSelector.testsWord')}`
                      : `${t('tagSelector.willRun')} ${t('common.all')} ${matchingCount} ${t('tagSelector.testsWord')}`}
                </Text>
              </Group>
              {matchingCount > 0 && (
                <UnstyledButton
                  onClick={() => setShowMatchedTests((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Text size="xs" c="dimmed">
                    {showMatchedTests ? t('tagSelector.hide') : t('tagSelector.show')}{' '}
                    {t('tagSelector.list')}
                  </Text>
                  <TbChevronDown
                    size={14}
                    style={{
                      // biome-ignore lint/security/noSecrets: CSS transform value, not a secret
                      transform: showMatchedTests ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 150ms',
                    }}
                  />
                </UnstyledButton>
              )}
            </Group>
            <Collapse expanded={showMatchedTests && matchingCount > 0}>
              <ScrollArea.Autosize mah="25vh">
                <Stack gap={2}>
                  {matchedTests.map((t, idx) => (
                    <Group
                      key={`${t.id}-${idx as number}`}
                      gap={6}
                      wrap="nowrap"
                      align="flex-start"
                    >
                      <Badge size="xs" color="gray" variant="light" style={{ flexShrink: 0 }}>
                        {t.id || '?'}
                      </Badge>
                      <Tooltip label={t.title} multiline maw={420} withArrow openDelay={300}>
                        <Text size="xs" lineClamp={1}>
                          {t.title}
                        </Text>
                      </Tooltip>
                    </Group>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </Collapse>
          </Stack>
        </Paper>
      )}

      {/* ─── Header ─── */}
      <Group justify="space-between">
        <Group gap={6}>
          <TbTag size={14} color="var(--mantine-color-dimmed)" />
          <Text size="xs" fw={600} c="dimmed">
            {t('tagSelector.tags')} ({tags.all.length})
          </Text>
        </Group>
        {selectedTags.length > 0 && (
          <Button size="compact-xs" variant="subtle" color="red" onClick={() => onChange([])}>
            {t('common.clearAll')}
          </Button>
        )}
      </Group>

      {/* ─── Search ─── */}
      <TextInput
        size="xs"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        placeholder={t('tagSelector.searchPlaceholder')}
        leftSection={<TbSearch size={12} />}
        rightSection={
          search ? (
            <UnstyledButton onClick={() => setSearch('')}>
              <TbX size={12} />
            </UnstyledButton>
          ) : null
        }
      />

      {/* ─── Category groups (flat) — in `fill` mode this is the ONLY scroll
          region (the rest of the Run form stays fixed). ─── */}
      <GroupList fill={fill}>
        <Stack gap={0}>
          {filteredGroups.map((group) => {
            const color = GROUP_COLORS[group.kind] ?? 'teal';
            const isCollapsed = collapsed.has(group.kind);
            const selectedInGroup = group.tags.filter((t) => selectedTags.includes(t)).length;

            return (
              <div
                key={group.kind + group.label}
                style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
              >
                {/* Group header */}
                <UnstyledButton
                  onClick={() => toggleGroup(group.kind)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Group gap={6} wrap="nowrap">
                    <TbChevronRight
                      size={12}
                      style={{
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 150ms',
                      }}
                    />
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                      {group.label}
                    </Text>
                    <Text size="xs" c="dimmed" fw={400}>
                      ({group.tags.length})
                    </Text>
                  </Group>
                  {selectedInGroup > 0 && (
                    <Badge size="xs" color="blue" circle>
                      {selectedInGroup}
                    </Badge>
                  )}
                </UnstyledButton>

                {/* Group tags */}
                <Collapse expanded={!isCollapsed}>
                  <Group gap={6} px="sm" pb="sm" wrap="wrap">
                    {group.tags.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      const detail = tags.details?.[tag];
                      const tooltipLabel = detail
                        ? detail.tests.length === 1
                          ? detail.tests[0]?.title || tag
                          : `${detail.count} tests`
                        : tag;
                      return (
                        <Tooltip
                          key={tag}
                          label={tooltipLabel}
                          withArrow
                          openDelay={300}
                          multiline
                          maw={420}
                        >
                          <Badge
                            size="sm"
                            variant={isSelected ? 'filled' : 'outline'}
                            color={isSelected ? 'blue' : color}
                            style={{ cursor: 'pointer' }}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            onClick={() => toggle(tag)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggle(tag);
                              }
                            }}
                          >
                            {tag}
                            {detail && detail.count > 1 && group.kind !== 'case-id'
                              ? ` (${detail.count})`
                              : ''}
                          </Badge>
                        </Tooltip>
                      );
                    })}
                  </Group>
                </Collapse>
              </div>
            );
          })}
          {filteredGroups.length === 0 && (
            <Text size="xs" c="dimmed" p="sm">
              {t('tagSelector.noMatchSearch')} &ldquo;{search}&rdquo;
            </Text>
          )}
        </Stack>
      </GroupList>
    </Stack>
  );
}
