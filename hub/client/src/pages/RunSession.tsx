/**
 * RunSession orchestrates the run/config state for one session. The imperative
 * terminal (xterm) and WebSocket plumbing now live in `useRunTerminal` and
 * `useRunSocket`. The effects that remain here intentionally omit the stable
 * `prefs` store from their deps (persisting / prefilling last-used tool, type,
 * and project) — including it would re-run them on unrelated preference changes.
 * The file-level ignore documents that these omissions are deliberate.
 */
// biome-ignore-all lint/correctness/useExhaustiveDependencies: remaining effects intentionally omit the stable prefs store; see note above.
import type {
  DoctorReport,
  HeadlessMode,
  PerformanceType,
  RunMode,
  RunRecord,
  RunRequest,
  RunStatus,
  ToolId,
} from '@hub/shared';
import { missingChecksForTool } from '@hub/shared';
import {
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  TbAlertTriangle,
  TbCopy,
  TbDeviceMobile,
  TbPlayerPlay,
  TbPlayerStop,
  TbRefresh,
  TbSearch,
  TbX,
} from 'react-icons/tb';
import { api } from '~/api/client.js';
import { qProjectEnv } from '~/api/queries.js';
import { confirmDialog } from '~/components/confirmDialog.js';
import { InlineAlert } from '~/components/InlineAlert.js';
import { SectionSelect } from '~/components/SectionSelect.js';
import { TagSelector } from '~/components/TagSelector.js';
import { toast } from '~/components/Toast.js';
import {
  useProjectList,
  useProjectSections,
  useProjectTags,
  useProjectTypes,
} from '~/hooks/useProjectQueries.js';
import { useRunSocket } from '~/hooks/useRunSocket.js';
import { useRunTerminal } from '~/hooks/useRunTerminal.js';
import { useTools } from '~/hooks/useTools.js';
import { useT } from '~/i18n/index.js';
import { usePreferences } from '~/stores/hub.js';
import { buildPerfTypeData } from '~/utils/perf-type-options.js';
import { getStatusColor } from '~/utils/run-status.js';
import { buildTagExpr, parseTagExpr } from '~/utils/tag-selection.js';
import { toolSelectData } from '~/utils/tool-label.js';

export interface SessionRef {
  cancel: () => void;
  getStatus: () => RunStatus | 'idle';
  getProject: () => string;
  getConfig: () => RunRequest;
}

interface RunSessionProps {
  sessionId: string;
  initialConfig?: RunRequest;
  reconnectRunId?: string;
  reconnectCommand?: string;
  onStatusChange: (
    sessionId: string,
    status: RunStatus | 'idle',
    project: string,
    tool?: ToolId,
  ) => void;
  visible: boolean;
}

export const RunSession = forwardRef<SessionRef, RunSessionProps>(function RunSession(
  { sessionId, initialConfig, reconnectRunId, reconnectCommand, onStatusChange, visible },
  ref,
) {
  const t = useT();
  const prefs = usePreferences();
  const queryClient = useQueryClient();

  const [tool, setTool] = useState<ToolId>(initialConfig?.tool ?? prefs.lastTool);
  const [mode, setMode] = useState<RunMode>(initialConfig?.mode ?? prefs.defaultMode);
  const [type, setType] = useState(initialConfig?.type ?? '');
  const [project, setProject] = useState(initialConfig?.project ?? '');
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    parseTagExpr(initialConfig?.tag),
  );
  const [headless, setHeadless] = useState<HeadlessMode>(
    initialConfig?.headless ?? prefs.defaultHeadless,
  );
  const [extraArgs, setExtraArgs] = useState(initialConfig?.extraArgs ?? '');
  const [noTrack, setNoTrack] = useState(initialConfig?.noTrack ?? false);
  const [silent, setSilent] = useState(initialConfig?.silent ?? false);
  const [section, setSection] = useState(initialConfig?.section ?? '');
  const [perfType, setPerfType] = useState<PerformanceType>(
    initialConfig?.performanceType ?? 'LOAD',
  );

  const [runStatus, setRunStatus] = useState<RunStatus | 'idle'>('idle');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState('');
  const [runSummary, setRunSummary] = useState<{
    passed: number;
    failed: number;
    skipped?: number;
  } | null>(null);
  const fullOutputRef = useRef('');
  const activeRunIdRef = useRef<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const isRunning = runStatus === 'running' || runStatus === 'pending';

  // Terminal (xterm) and the per-session WebSocket live in dedicated hooks so
  // this component orchestrates state while the imperative plumbing stays in
  // one place. `term` is a stable API; `send` posts subscribe/cancel messages.
  const { termRef, term } = useRunTerminal({ visible, refitKey: runStatus });
  const { send } = useRunSocket({
    term,
    activeRunIdRef,
    fullOutputRef,
    setRunStatus,
    setRunSummary,
    setActiveRunId,
    setLastCommand,
    reconnectRunId,
    reconnectCommand,
    t,
  });

  useImperativeHandle(ref, () => ({
    cancel: () => handleCancel(),
    getStatus: () => runStatus,
    getProject: () => project,
    getConfig: () => ({
      tool,
      type: effectiveType,
      project,
      mode,
      tag: buildTagExpr(selectedTags),
      headless: !sectionAxis ? headless : undefined,
      extraArgs: extraArgs || undefined,
      noTrack,
      silent,
      section: sectionAxis ? section : undefined,
      performanceType: sectionAxis ? perfType : undefined,
    }),
  }));

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  // Keep the latest onStatusChange without making it an effect dependency. The
  // parent recreates this callback every render (it closes over the i18n `t`,
  // which is a fresh function per render). Depending on its identity here would
  // re-fire the effect on every render → setState → re-render → React error
  // #185 (maximum update depth). We report only when the real status/identity
  // values change.
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    onStatusChangeRef.current(sessionId, runStatus, project, tool);
  }, [sessionId, runStatus, project, tool]);

  // Persist last-used type and project (for bookmark/reconnect convenience only)
  useEffect(() => {
    if (tool && type) prefs.setLastType(tool, type);
  }, [tool, type]);

  useEffect(() => {
    if (tool && type && project) prefs.setLastProject(tool, type, project);
  }, [tool, type, project]);

  const config = useQuery<{ forceTrack: boolean; dockerRunning: boolean }>({
    queryKey: ['config'],
    queryFn: () => api.get('/api/config'),
    gcTime: Infinity,
    // Config (forceTrack/dockerRunning) is stable within a session; without a
    // staleTime it refetched on every session mount / window refocus.
    staleTime: Infinity,
  });

  // Full doctor report (shares the ['doctor'] cache with the Dashboard panel).
  // Drives both the credentials notice and the per-tool run-requirement gate.
  const doctorQ = useQuery<DoctorReport>({
    queryKey: ['doctor'],
    queryFn: () => api.get('/api/doctor'),
    staleTime: 10_000,
  });

  // Force mode to local if Docker is not running
  useEffect(() => {
    if (config.data && !config.data.dockerRunning && mode === 'docker') {
      setMode('local');
    }
  }, [config.data, mode]);

  // Derive the selected tool's project axes from its manifest (via useTools),
  // replacing hardcoded `tool === 'k6'` branches so any portable tool works.
  const toolsQuery = useTools();
  const toolView = (toolsQuery.data ?? []).find((t) => t.id === tool);
  const sectionAxis = toolView?.projects.sectionAxis ?? false;
  const typeAxis = toolView?.projects.typeAxis ?? true;
  const fixedType = toolView?.projects.fixedType ?? null;

  // Run-requirement gate: doctor checks this tool needs but that are missing
  // (e.g. Robot → uv, python). Blocks Run up-front and lists exactly what to
  // install, so the user never launches a doomed run.
  const missingReqs =
    toolView && doctorQ.data ? missingChecksForTool(toolView, doctorQ.data.checks) : [];

  const effectiveType = typeAxis ? type : (fixedType ?? '');
  const types = useProjectTypes(tool);
  const projectsQ = useProjectList(tool, effectiveType);
  const sectionsQ = useProjectSections(project, sectionAxis);
  // Project .env drives the live VU counts shown in the perf-type labels
  // (PEAK_VUS → LOAD, MINIMAL_LOAD_VUS → MINIMAL_LOAD); only fetched for a
  // section-axis tool (k6), where the perf-type Select is shown.
  const projectEnvQ = useQuery(
    qProjectEnv(sectionAxis ? tool : '', effectiveType, sectionAxis ? project : ''),
  );
  const perfTypeData = buildPerfTypeData(projectEnvQ.data?.entries);
  const tags = useProjectTags(sectionAxis ? '' : tool, effectiveType, project);

  // Mobile (Robot type=mobile) needs the host Appium server running. Gate the
  // Run button on it and offer a one-click start (Option A: host appium).
  const isMobile = effectiveType === 'mobile';
  const appiumQ = useQuery<{ running: boolean; installed: boolean }>({
    queryKey: ['appium-status'],
    queryFn: () => api.get('/api/appium/status'),
    enabled: isMobile,
    refetchInterval: isMobile ? 5000 : false,
  });
  const appiumRunning = appiumQ.data?.running ?? false;
  const startAppium = useMutation({
    mutationFn: () => api.post('/api/appium/start'),
    onSuccess: () => {
      toast.success(t('run.appiumStarting'));
      queryClient.invalidateQueries({ queryKey: ['appium-status'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  useEffect(() => {
    if (typeAxis && types.data && types.data.length > 0 && !type) {
      // Prefer the last-used type for this tool so returning users don't re-pick
      // it every session; fall back to the first available type.
      const preferred = prefs.lastType[tool];
      setType(preferred && types.data.includes(preferred) ? preferred : (types.data[0] ?? ''));
    }
  }, [typeAxis, types.data, type, tool]);

  // Auto-select the last-used project once the project list loads. Applies to
  // every session (fresh, bookmark, or reconnect) so a returning user lands on
  // a ready-to-run form; they can still change it. Only fills when the saved
  // project actually exists in the current list.
  useEffect(() => {
    if (projectsQ.data && projectsQ.data.length > 0 && !project) {
      const lastProj = prefs.lastProject[`${tool}/${effectiveType}`];
      if (lastProj && projectsQ.data.includes(lastProj)) {
        setProject(lastProj);
      }
    }
  }, [projectsQ.data, project, tool, effectiveType]);

  // Timer
  useEffect(() => {
    if (!isRunning || !startTime) return;
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(m > 0 ? `${m}m ${s}s` : `${s}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  const runMutation = useMutation<RunRecord, Error, RunRequest>({
    mutationFn: (req) => api.post('/api/runs', req),
    onSuccess: (record) => {
      setRunStatus('running');
      setActiveRunId(record.id);
      setLastCommand(record.command);
      setStartTime(Date.now());
      setElapsed('0s');
      setRunSummary(null);
      fullOutputRef.current = '';
      term.clear();
      term.writeln(`\x1b[32m[Started]\x1b[0m Run ${record.id}`);
      term.writeln(`\x1b[90m$ ${record.command}\x1b[0m\n`);
      send({ kind: 'subscribe', runId: record.id, replay: true });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      queryClient.invalidateQueries({ queryKey: ['activeRuns'] });
    },
  });

  function handleRun() {
    const tagExpr = buildTagExpr(selectedTags);
    const effectiveNoTrack = config.data?.forceTrack ? false : noTrack;
    runMutation.mutate({
      tool,
      type: effectiveType,
      project,
      mode,
      tag: tagExpr,
      headless: !sectionAxis ? headless : undefined,
      extraArgs: extraArgs || undefined,
      noTrack: effectiveNoTrack,
      silent,
      section: sectionAxis ? section : undefined,
      performanceType: sectionAxis ? perfType : undefined,
    });
  }

  async function handleCancel() {
    if (!activeRunId) return;
    const ok = await confirmDialog({
      title: t('run.cancelTestTitle'),
      message: t('run.cancelTestConfirm'),
      confirmLabel: t('run.cancelTestConfirmLabel'),
      cancelLabel: t('run.keepRunning'),
      danger: true,
    });
    if (!ok) return;
    send({ kind: 'cancel', runId: activeRunId });
  }

  function handleRerun() {
    if (runMutation.data) runMutation.mutate(runMutation.data.request);
  }

  async function handleCopyCommand() {
    if (!lastCommand) return;
    try {
      await navigator.clipboard.writeText(lastCommand);
      toast.success('Command copied');
    } catch {
      toast.error('Copy failed');
    }
  }

  // Ctrl/Cmd + Enter to run when this session is visible
  useHotkeys([
    [
      'mod+Enter',
      () => {
        if (visible && project && !isRunning) handleRun();
      },
    ],
    [
      'mod+f',
      () => {
        if (visible) {
          setSearchOpen((v) => !v);
        }
      },
    ],
  ]);

  return (
    <div
      style={{
        display: visible ? 'flex' : 'none',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 'var(--mantine-spacing-sm)',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Left column: the form scrolls on its own (flex:1), while the Run/Stop
          actions are pinned to the bottom of this column (below the scroll
          area) so they stay level with the command bar on the right and never
          scroll out of reach. Explicit height:100% (against the bounded row)
          keeps the scroll internal instead of growing the page. */}
      <Stack
        gap="sm"
        w={{ base: '100%', lg: '40%' }}
        style={{ flexShrink: 0, height: '100%', minHeight: 0 }}
      >
        <ScrollArea
          scrollbarSize={6}
          type="auto"
          offsetScrollbars
          style={{ flex: 1, minHeight: 0 }}
        >
          <Paper p="md" withBorder style={{ opacity: isRunning ? 0.85 : 1 }}>
            <Stack gap="sm">
              <SimpleGrid cols={2} spacing="xs">
                <Select
                  label={t('run.tool')}
                  size="xs"
                  disabled={isRunning}
                  value={tool}
                  onChange={(v) => {
                    if (!v) return;
                    setTool(v as ToolId);
                    setType('');
                    setProject('');
                    setSelectedTags([]);
                  }}
                  data={toolSelectData(toolsQuery.data ?? [])}
                  allowDeselect={false}
                />
                <Select
                  label={t('run.mode')}
                  size="xs"
                  disabled={isRunning}
                  value={mode}
                  onChange={(v) => v && setMode(v as RunMode)}
                  data={[
                    { value: 'local', label: t('run.modeLocal') },
                    {
                      value: 'docker',
                      label: `Docker${!config.data?.dockerRunning ? ` (${t('run.notRunning')})` : ''}`,
                      disabled: !config.data?.dockerRunning,
                    },
                  ]}
                  allowDeselect={false}
                />
              </SimpleGrid>

              <SimpleGrid cols={typeAxis ? 2 : 1} spacing="xs">
                {typeAxis && (
                  <Select
                    label={t('run.type')}
                    size="xs"
                    disabled={isRunning}
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
                  disabled={isRunning}
                  value={project || null}
                  onChange={(v) => {
                    setProject(v ?? '');
                    setSelectedTags([]);
                  }}
                  placeholder={projectsQ.isLoading ? t('common.loading') : t('common.select')}
                  data={projectsQ.data ?? []}
                  searchable
                />
              </SimpleGrid>

              {sectionAxis && project && (
                <SimpleGrid cols={2} spacing="xs">
                  <SectionSelect
                    label={t('run.section')}
                    disabled={isRunning}
                    value={section}
                    onChange={setSection}
                    placeholder={t('common.select')}
                    sections={sectionsQ.data ?? []}
                  />
                  <Select
                    label={t('run.perfType')}
                    size="xs"
                    disabled={isRunning}
                    value={perfType}
                    onChange={(v) => v && setPerfType(v as PerformanceType)}
                    data={perfTypeData}
                    allowDeselect={false}
                  />
                </SimpleGrid>
              )}

              {!sectionAxis && project && !isRunning && (
                <TagSelector
                  tags={tags.data}
                  isLoading={tags.isLoading}
                  selectedTags={selectedTags}
                  onChange={setSelectedTags}
                />
              )}
              {!sectionAxis && project && isRunning && selectedTags.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed">
                    {t('run.tags')}
                  </Text>
                  <Group gap={4}>
                    {selectedTags.map((tag) => (
                      <Badge key={tag} size="sm" color="blue" variant="filled">
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              )}

              {!sectionAxis && (
                <SimpleGrid cols={2} spacing="xs">
                  <Select
                    label={t('run.display')}
                    size="xs"
                    disabled={isRunning}
                    value={headless}
                    onChange={(v) => v && setHeadless(v as HeadlessMode)}
                    data={[
                      { value: 'headless', label: t('run.headless') },
                      { value: 'headed', label: t('run.headed') },
                    ]}
                    allowDeselect={false}
                  />
                  <TextInput
                    label={t('run.extraArgs')}
                    size="xs"
                    disabled={isRunning}
                    value={extraArgs}
                    onChange={(e) => setExtraArgs(e.currentTarget.value)}
                    placeholder="--workers=4"
                  />
                </SimpleGrid>
              )}

              <Group gap="lg" wrap="wrap">
                {!config.data?.forceTrack && (
                  <Checkbox
                    size="xs"
                    label={t('run.skipUsageLogging')}
                    disabled={isRunning}
                    checked={noTrack}
                    onChange={(e) => setNoTrack(e.currentTarget.checked)}
                  />
                )}

                <Checkbox
                  size="xs"
                  label={t('run.silentMode')}
                  disabled={isRunning}
                  checked={silent}
                  onChange={(e) => setSilent(e.currentTarget.checked)}
                />
              </Group>

              {doctorQ.data && !doctorQ.data.credentialsOk && !noTrack && (
                <InlineAlert
                  icon={<TbAlertTriangle size={14} />}
                  message={t('run.credentialsMissing')}
                  action={
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="yellow"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.json';
                        input.onchange = async () => {
                          const file = input.files?.[0];
                          if (!file) return;
                          const content = await file.text();
                          try {
                            await api.post('/api/doctor/upload-credentials', {
                              content,
                              filename: file.name,
                            });
                            toast.success(t('run.credentialsUploaded'));
                            doctorQ.refetch();
                          } catch {
                            toast.error(t('run.credentialsUploadFailed'));
                          }
                        };
                        input.click();
                      }}
                    >
                      {t('run.uploadCredentials')}
                    </Button>
                  }
                />
              )}

              {missingReqs.length > 0 && (
                <InlineAlert
                  icon={<TbAlertTriangle size={14} />}
                  message={`${t('run.missingRequirements')}: ${missingReqs.join(', ')}. ${t('run.missingRequirementsHint')}`}
                />
              )}

              {isMobile && !appiumRunning && (
                <InlineAlert
                  icon={<TbDeviceMobile size={14} />}
                  message={t('run.appiumWarning')}
                  action={
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="yellow"
                      onClick={() => startAppium.mutate()}
                      loading={startAppium.isPending}
                      disabled={appiumQ.data ? !appiumQ.data.installed : false}
                    >
                      {t('run.startAppium')}
                    </Button>
                  }
                />
              )}
            </Stack>
          </Paper>
        </ScrollArea>

        {/* Pinned action footer — stays level with the command bar on the right;
            the form above scrolls independently behind it. */}
        <Group gap="xs" grow style={{ flexShrink: 0 }}>
          {(() => {
            const tagsLoading = !sectionAxis && !!project && !!effectiveType && tags.isLoading;
            const disabledReason =
              missingReqs.length > 0
                ? `${t('run.missingRequirements')}: ${missingReqs.join(', ')}`
                : !project
                  ? t('run.selectProjectFirst')
                  : isRunning
                    ? t('run.testRunning')
                    : tagsLoading
                      ? t('run.loadingTags')
                      : isMobile && !appiumRunning
                        ? t('run.appiumNotRunning')
                        : null;
            return (
              <Tooltip
                label={disabledReason ?? t('run.runTooltip')}
                disabled={!disabledReason}
                withArrow
              >
                {/* Wrapper div is required so Tooltip can show on a disabled button. */}
                <div style={{ flex: 1 }}>
                  <Button
                    size="sm"
                    color="green"
                    fullWidth
                    onClick={handleRun}
                    loading={runMutation.isPending}
                    disabled={!!disabledReason}
                    leftSection={<TbPlayerPlay size={16} />}
                  >
                    {t('run.runButton')}
                  </Button>
                </div>
              </Tooltip>
            );
          })()}
          {isRunning && (
            <Button
              size="sm"
              color="red"
              onClick={handleCancel}
              leftSection={<TbPlayerStop size={16} />}
              style={{ flex: 'none' }}
            >
              {t('run.stop')}
            </Button>
          )}
        </Group>
      </Stack>

      {/* Right column: terminal scrolls internally (flex:1); the command bar is
          pinned at the bottom, level with the Run button on the left. */}
      <Stack gap="sm" style={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0 }}>
        <Paper
          withBorder
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <Group
            justify="space-between"
            px="sm"
            py={6}
            style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
          >
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                {t('run.liveOutput')}
              </Text>
              {isRunning && elapsed && (
                <Text size="xs" c="blue" ff="monospace">
                  {elapsed}
                </Text>
              )}
              {!isRunning && runSummary && (
                <Group gap={6}>
                  {runSummary.passed > 0 && (
                    <Badge size="xs" color="green" variant="light">
                      {runSummary.passed} {t('run.passed')}
                    </Badge>
                  )}
                  {runSummary.failed > 0 && (
                    <Badge size="xs" color="red" variant="light">
                      {runSummary.failed} {t('run.failed')}
                    </Badge>
                  )}
                  {runSummary.skipped !== undefined && runSummary.skipped > 0 && (
                    <Badge size="xs" color="yellow" variant="light">
                      {runSummary.skipped} {t('run.skipped')}
                    </Badge>
                  )}
                </Group>
              )}
            </Group>
            <Group gap="xs">
              <Badge
                size="sm"
                color={getStatusColor(runStatus)}
                variant={runStatus === 'running' ? 'dot' : 'filled'}
              >
                {runStatus}
              </Badge>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => setSearchOpen((v) => !v)}
                leftSection={<TbSearch size={12} />}
              >
                {t('run.find')}
              </Button>
            </Group>
          </Group>
          {searchOpen && (
            <Group
              px="sm"
              py={4}
              gap="xs"
              style={{
                borderBottom: '1px solid var(--mantine-color-default-border)',
                flexShrink: 0,
              }}
            >
              <TextInput
                size="xs"
                placeholder={t('run.searchOutput')}
                value={searchTerm}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setSearchTerm(v);
                  if (v) term.findNext(v);
                  else term.clearSearch();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.shiftKey) term.findPrevious(searchTerm);
                    else term.findNext(searchTerm);
                  }
                  if (e.key === 'Escape') {
                    setSearchOpen(false);
                    term.clearSearch();
                  }
                }}
                leftSection={<TbSearch size={12} />}
                rightSection={
                  searchTerm ? (
                    <TbX
                      size={12}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSearchTerm('');
                        term.clearSearch();
                      }}
                    />
                  ) : null
                }
                style={{ flex: 1 }}
                autoFocus
              />
              <Text size="xs" c="dimmed">
                {t('run.searchHint')}
              </Text>
            </Group>
          )}
          <div ref={termRef} style={{ flex: 1, minHeight: 0 }} />
        </Paper>

        {lastCommand && (
          <Paper p="xs" withBorder style={{ flexShrink: 0 }}>
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed">
                {t('run.command')}
              </Text>
              <Group gap="xs">
                {!isRunning && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={handleRerun}
                    leftSection={<TbRefresh size={12} />}
                  >
                    {t('run.rerun')}
                  </Button>
                )}
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  onClick={handleCopyCommand}
                  leftSection={<TbCopy size={12} />}
                >
                  {t('run.copy')}
                </Button>
              </Group>
            </Group>
            <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {lastCommand}
            </Code>
            {!isRunning && elapsed && (
              <Text size="xs" c="dimmed" mt={4}>
                {t('run.duration')}: {elapsed}
              </Text>
            )}
          </Paper>
        )}
      </Stack>
    </div>
  );
});
