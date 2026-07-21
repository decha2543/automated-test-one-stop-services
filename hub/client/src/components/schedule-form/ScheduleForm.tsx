import type { HeadlessMode, PerformanceType, RunMode, RunRequest, ToolId } from '@hub/shared';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api } from '~/api/client.js';
import { qProjectEnv } from '~/api/queries.js';
import { SectionSelect } from '~/components/SectionSelect.js';
import { TagSelector } from '~/components/TagSelector.js';
import { toast } from '~/components/Toast.js';
import {
  useProjectList,
  useProjectSections,
  useProjectTags,
  useProjectTypes,
} from '~/hooks/useProjectQueries.js';
import { useTools } from '~/hooks/useTools.js';
import { useT } from '~/i18n/index.js';
import { buildPerfTypeData } from '~/utils/perf-type-options.js';
import { buildTagExpr, parseTagExpr } from '~/utils/tag-selection.js';
import { toolSelectData } from '~/utils/tool-label.js';
import { fromConfigSilent, toConfigSilent } from './schedule-silent.js';

// ---------------------------------------------------------------------------
// Cron helpers
// ---------------------------------------------------------------------------

function describeNextRun(cronExpr: string): string {
  try {
    const interval = CronExpressionParser.parse(cronExpr);
    const next = interval.next().toDate();
    const diffMs = next.getTime() - Date.now();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'in <1 min';
    if (diffMin < 60) return `in ${diffMin} min`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `in ${diffHr}h ${diffMin % 60}m`;
    const diffDays = Math.round(diffHr / 24);
    return `in ${diffDays}d (${dayjs(next).format('DD MMM YYYY HH:mm')})`;
  } catch {
    return 'invalid cron';
  }
}

function humanizeCron(cronExpr: string): string {
  try {
    return cronstrue.toString(cronExpr, { use24HourTimeFormat: false });
  } catch {
    return 'invalid cron';
  }
}

/** Pull `(?=.*@TAG)` lookaheads back into a flat tag list when editing. */
function parseTagExpression(tag: string | undefined): string[] {
  return parseTagExpr(tag);
}

// ---------------------------------------------------------------------------
// Schedule shape (mirror of server-side type)
// ---------------------------------------------------------------------------

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  config: RunRequest;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastStatus?: string;
}

export interface ScheduleFormProps {
  /** When `mode === 'edit'`, a non-null schedule is required. */
  mode: 'create' | 'edit';
  /** Required for edit mode; modal stays closed when null in edit mode. */
  schedule?: Schedule | null;
  /** External `opened` flag for create mode (edit derives from `schedule != null`). */
  opened?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * One-form-fits-both Create + Edit modal for schedules. Replaces the two
 * ~250-line near-duplicate modals that used to live in `pages/Schedules.tsx`.
 *
 * The only behavioural differences between create and edit are:
 *   - initial state (defaults vs. populated from `schedule`)
 *   - HTTP verb (POST vs PUT) and URL
 *   - title and submit-button copy
 * Everything below — rendering, validation, query wiring — is identical.
 */
export function ScheduleForm({
  mode,
  schedule = null,
  opened = false,
  onClose,
  onSuccess,
}: ScheduleFormProps) {
  const isEdit = mode === 'edit';
  const isOpen = isEdit ? !!schedule : opened;
  const t = useT();
  const cronPresets = [
    { label: t('schedule.cronHourly'), value: '0 * * * *' },
    { label: t('schedule.cron6h'), value: '0 */6 * * *' },
    { label: t('schedule.cronDaily8'), value: '0 8 * * *' },
    { label: t('schedule.cronMidnight'), value: '0 0 * * *' },
    { label: t('schedule.cronWeekdays9'), value: '0 9 * * 1-5' },
    { label: t('schedule.cronMon7'), value: '0 7 * * 1' },
  ];
  const modeOptions = [
    { value: 'local', label: t('run.modeLocal') },
    { value: 'docker', label: 'Docker' },
  ];
  const headlessOptions = [
    { value: 'headless', label: t('run.headless') },
    { value: 'headed', label: t('run.headed') },
  ];

  const defaults = {
    name: '',
    cronExpr: '0 8 * * *',
    tool: 'playwright' as ToolId,
    type: '',
    project: '',
    runMode: 'local' as RunMode,
    headless: 'headless' as HeadlessMode,
    selectedTags: [] as string[],
    extraArgs: '',
    noTrack: false,
    silent: false,
    section: '',
    perfType: 'LOAD' as PerformanceType,
  };

  const [name, setName] = useState(defaults.name);
  const [cronExpr, setCronExpr] = useState(defaults.cronExpr);
  const [tool, setTool] = useState<ToolId>(defaults.tool);
  const [type, setType] = useState(defaults.type);
  const [project, setProject] = useState(defaults.project);
  const [runMode, setRunMode] = useState<RunMode>(defaults.runMode);
  const [headless, setHeadless] = useState<HeadlessMode>(defaults.headless);
  const [selectedTags, setSelectedTags] = useState<string[]>(defaults.selectedTags);
  const [extraArgs, setExtraArgs] = useState(defaults.extraArgs);
  const [noTrack, setNoTrack] = useState(defaults.noTrack);
  const [silent, setSilent] = useState(defaults.silent);
  const [section, setSection] = useState(defaults.section);
  const [perfType, setPerfType] = useState<PerformanceType>(defaults.perfType);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);

  // Populate state when an edit-target schedule arrives (or changes id).
  if (isEdit && schedule && initializedFor !== schedule.id) {
    setName(schedule.name);
    setCronExpr(schedule.cron);
    setTool(schedule.config.tool);
    setType(schedule.config.type);
    setProject(schedule.config.project);
    setRunMode(schedule.config.mode);
    setHeadless(schedule.config.headless ?? 'headless');
    setExtraArgs(schedule.config.extraArgs ?? '');
    setNoTrack(schedule.config.noTrack ?? false);
    setSilent(fromConfigSilent(schedule.config));
    setSection(schedule.config.section ?? '');
    setPerfType(schedule.config.performanceType ?? 'LOAD');
    setSelectedTags(parseTagExpression(schedule.config.tag));
    setInitializedFor(schedule.id);
  }

  function resetForm(): void {
    setName(defaults.name);
    setCronExpr(defaults.cronExpr);
    setTool(defaults.tool);
    setType(defaults.type);
    setProject(defaults.project);
    setRunMode(defaults.runMode);
    setHeadless(defaults.headless);
    setExtraArgs(defaults.extraArgs);
    setNoTrack(defaults.noTrack);
    setSilent(defaults.silent);
    setSection(defaults.section);
    setPerfType(defaults.perfType);
    setSelectedTags(defaults.selectedTags);
    setInitializedFor(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  // Tool options + per-tool project config come from the installed tools
  // (`useTools()`), not a static three-entry list. Only enabled tools are
  // schedulable.
  const { data: allTools = [] } = useTools();
  const toolOptions = toolSelectData(allTools);

  const types = useProjectTypes(tool);
  // Manifest-driven (replaces the `tool === 'k6'` literals): the selected tool's
  // ToolView.projects decides the type axis (effectiveType), whether a Section
  // axis exists, and therefore which controls render.
  const selectedView = allTools.find((t) => t.id === tool);
  const projectsCfg = selectedView?.projects ?? {
    depth: 1 as const,
    typeAxis: true,
    fixedType: null,
    root: 'projects',
    sectionAxis: false,
  };
  const sectionAxis = projectsCfg.sectionAxis;
  const effectiveType = projectsCfg.typeAxis ? type : (projectsCfg.fixedType ?? '');
  const projectsQ = useProjectList(tool, effectiveType);
  const sectionsQ = useProjectSections(project, sectionAxis);
  // Project .env drives the live VU counts in the perf-type labels (PEAK_VUS →
  // LOAD, MINIMAL_LOAD_VUS → MINIMAL_LOAD); only fetched for a section-axis tool.
  const projectEnvQ = useQuery(
    qProjectEnv(sectionAxis ? tool : '', effectiveType, sectionAxis ? project : ''),
  );
  const perfTypeData = buildPerfTypeData(projectEnvQ.data?.entries);
  const tags = useProjectTags(sectionAxis ? '' : tool, effectiveType, project);

  const tagExpr = buildTagExpr(selectedTags);

  const mutation = useMutation({
    mutationFn: () => {
      const config: RunRequest = {
        tool,
        type: effectiveType,
        project,
        mode: runMode,
        tag: tagExpr,
        headless: !sectionAxis ? headless : undefined,
        extraArgs: extraArgs || undefined,
        noTrack: noTrack || undefined,
        silent: toConfigSilent(silent),
        section: sectionAxis ? section || undefined : undefined,
        performanceType: sectionAxis ? perfType : undefined,
      };
      const body = { name, cron: cronExpr, config };
      return isEdit
        ? api.put(`/api/schedules/${schedule?.id}`, body)
        : api.post('/api/schedules', body);
    },
    onSuccess: () => {
      toast.success(isEdit ? t('schedule.updated') : t('schedule.created'));
      resetForm();
      onSuccess();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Modal
      opened={isOpen}
      onClose={handleClose}
      title={isEdit ? t('schedule.editTitle') : t('schedules.newSchedule')}
      size="lg"
      centered
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="sm">
        <TextInput
          label={t('webhook.name')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Nightly regression"
        />

        <Stack gap={4}>
          <TextInput
            label={t('schedule.cronExpr')}
            value={cronExpr}
            onChange={(e) => setCronExpr(e.currentTarget.value)}
            placeholder="0 8 * * *"
            styles={{ input: { fontFamily: 'monospace' } }}
            description={
              cronExpr
                ? `${humanizeCron(cronExpr)} · ${t('schedule.nextRun')} ${describeNextRun(cronExpr)}`
                : undefined
            }
          />
          <Group gap={4} wrap="wrap">
            {cronPresets.map((p) => (
              <Badge
                key={p.value}
                size="sm"
                variant={cronExpr === p.value ? 'filled' : 'outline'}
                color={cronExpr === p.value ? 'blue' : 'gray'}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-pressed={cronExpr === p.value}
                onClick={() => setCronExpr(p.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setCronExpr(p.value);
                  }
                }}
              >
                {p.label}
              </Badge>
            ))}
          </Group>
        </Stack>

        <Paper withBorder p="sm" mt="xs">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="sm">
            {t('schedule.runConfig')}
          </Text>
          <Stack gap="sm">
            <SimpleGrid cols={2} spacing="xs">
              <Select
                label={t('run.tool')}
                size="xs"
                value={tool}
                onChange={(v) => {
                  if (!v) return;
                  setTool(v as ToolId);
                  setType('');
                  setProject('');
                  setSelectedTags([]);
                }}
                data={toolOptions}
                allowDeselect={false}
              />
              <Select
                label={t('run.mode')}
                size="xs"
                value={runMode}
                onChange={(v) => v && setRunMode(v as RunMode)}
                data={modeOptions}
                allowDeselect={false}
              />
            </SimpleGrid>

            <SimpleGrid cols={projectsCfg.typeAxis ? 2 : 1} spacing="xs">
              {projectsCfg.typeAxis && (
                <Select
                  label={t('run.type')}
                  size="xs"
                  value={type || null}
                  onChange={(v) => {
                    setType(v ?? '');
                    setProject('');
                    setSelectedTags([]);
                  }}
                  placeholder={t('common.select')}
                  data={types.data ?? []}
                  searchable
                />
              )}
              <Select
                label={t('run.project')}
                size="xs"
                value={project || null}
                onChange={(v) => {
                  setProject(v ?? '');
                  setSelectedTags([]);
                }}
                placeholder={t('common.select')}
                data={projectsQ.data ?? []}
                searchable
              />
            </SimpleGrid>

            {sectionAxis && project && (
              <SimpleGrid cols={2} spacing="xs">
                <SectionSelect
                  label={t('run.section')}
                  value={section}
                  onChange={setSection}
                  placeholder={t('common.all')}
                  sections={sectionsQ.data ?? []}
                />
                <Select
                  label={t('run.perfType')}
                  size="xs"
                  value={perfType}
                  onChange={(v) => v && setPerfType(v as PerformanceType)}
                  data={perfTypeData}
                  allowDeselect={false}
                />
              </SimpleGrid>
            )}

            {!sectionAxis && project && (
              <TagSelector
                tags={tags.data}
                isLoading={tags.isLoading}
                selectedTags={selectedTags}
                onChange={setSelectedTags}
              />
            )}

            {!sectionAxis && (
              <SimpleGrid cols={2} spacing="xs">
                <Select
                  label={t('run.display')}
                  size="xs"
                  value={headless}
                  onChange={(v) => v && setHeadless(v as HeadlessMode)}
                  data={headlessOptions}
                  allowDeselect={false}
                />
                <TextInput
                  label={t('run.extraArgs')}
                  size="xs"
                  value={extraArgs}
                  onChange={(e) => setExtraArgs(e.currentTarget.value)}
                  placeholder="--workers=4"
                />
              </SimpleGrid>
            )}

            <Checkbox
              size="xs"
              label={t('run.skipUsageLogging')}
              checked={noTrack}
              onChange={(e) => setNoTrack(e.currentTarget.checked)}
            />

            <Checkbox
              size="xs"
              label={t('run.silentMode')}
              checked={silent}
              onChange={(e) => setSilent(e.currentTarget.checked)}
            />
          </Stack>
        </Paper>

        {selectedTags.length > 0 && (
          <Text size="xs" c="dimmed">
            {t('schedule.tagExpr')} <code>{tagExpr}</code>
          </Text>
        )}

        {mutation.isError && (
          <Text size="sm" c="red">
            {(mutation.error as Error).message}
          </Text>
        )}

        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="subtle" color="gray" onClick={handleClose} size="xs">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name || !project || !cronExpr}
            loading={mutation.isPending}
            size="xs"
          >
            {isEdit ? t('schedule.saveSchedule') : t('schedule.createSchedule')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
