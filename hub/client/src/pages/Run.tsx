import type { RunRecord, RunRequest, RunStatus, ToolId } from '@hub/shared';
import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TbFolderPlus, TbPlus, TbRocket, TbX } from 'react-icons/tb';
import { api } from '~/api/client.js';
import { qProjects } from '~/api/queries.js';
import { BookmarkPanel } from '~/components/BookmarkPanel.js';
import { confirmDialog } from '~/components/confirmDialog.js';
import { EmptyState } from '~/components/EmptyState.js';
import { RunQueuePanel } from '~/components/RunQueuePanel.js';
import { useTools } from '~/hooks/useTools.js';
import { useT } from '~/i18n/index.js';
import { useNotifications } from '~/stores/hub.js';
import { useNavigationStore } from '~/stores/navigation.js';
import { getStatusColor } from '~/utils/run-status.js';
import { toolLabel } from '~/utils/tool-label.js';
import { RunSession, type SessionRef } from './RunSession.js';

function genId(): string {
  // crypto.randomUUID is available in all modern browsers and is collision-safe.
  return crypto.randomUUID();
}

interface SessionTab {
  id: string;
  status: RunStatus | 'idle';
  project: string;
  tool?: ToolId;
  initialConfig?: RunRequest;
  reconnectRunId?: string;
  reconnectCommand?: string;
}

export function RunPage() {
  const pendingConfig = useNavigationStore((s) => s.pendingRunConfig);
  const consumePendingRunConfig = useNavigationStore((s) => s.consumePendingRunConfig);
  const initialId = genId();
  const [sessions, setSessions] = useState<SessionTab[]>([
    { id: initialId, status: 'idle', project: '' },
  ]);
  const [activeId, setActiveId] = useState(initialId);
  const [reconnecting, setReconnecting] = useState(true);
  const sessionRefs = useRef<Map<string, SessionRef>>(new Map());
  const addNotification = useNotifications((s) => s.add);

  const navigate = useNavigate();
  const tools = useTools().data ?? [];
  const t = useT();

  // Detect first-time / no-projects state so we can guide the user instead of
  // showing an empty configuration form they cannot fill in.
  const projectsQ = useQuery({
    ...qProjects(),
    staleTime: 30_000,
  });
  const noProjects = !projectsQ.isLoading && (projectsQ.data?.length ?? 0) === 0;

  // Handle external config injection (from dashboard/spotlight). The effect
  // intentionally fires only when `pendingConfig` changes — the helpers it
  // calls are stable references that do not need to participate in the deps
  // array, so we silence the linter with an explicit reason.
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleLoadBookmark and consumePendingRunConfig are stable references; we deliberately respond only to pendingConfig changes.
  useEffect(() => {
    if (!pendingConfig) return;
    handleLoadBookmark(pendingConfig);
    consumePendingRunConfig();
  }, [pendingConfig]);

  // Warn before refresh/close when any session is running
  useEffect(() => {
    const hasRunning = sessions.some((s) => s.status === 'running' || s.status === 'pending');
    if (!hasRunning) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [sessions]);

  // Reconnect to active runs after page load
  useEffect(() => {
    async function reconnect() {
      try {
        const activeRuns: RunRecord[] = await api.get('/api/runs/active');
        if (activeRuns.length === 0) return;

        const tabs: SessionTab[] = activeRuns.map((record) => ({
          id: genId(),
          status: 'running' as const,
          project: record.request.project,
          tool: record.request.tool,
          initialConfig: record.request,
          reconnectRunId: record.id,
          reconnectCommand: record.command,
        }));

        setSessions(tabs);
        setActiveId(tabs[0]?.id ?? '');
      } catch {
        // Server not ready, ignore
      } finally {
        setReconnecting(false);
      }
    }
    reconnect();
  }, []);

  function addSession(config?: RunRequest) {
    const id = genId();
    setSessions((prev) => [
      ...prev,
      {
        id,
        status: 'idle',
        project: config?.project ?? '',
        tool: config?.tool,
        initialConfig: config,
      },
    ]);
    setActiveId(id);
  }

  async function closeSession(id: string) {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    const isRunning = session.status === 'running' || session.status === 'pending';
    const ok = await confirmDialog({
      title: isRunning ? t('run.closeRunningTitle') : t('run.closeSession'),
      message: isRunning ? t('run.closeRunningConfirm') : t('run.closeSessionConfirm'),
      confirmLabel: isRunning ? t('run.closeAndStop') : t('common.close'),
      danger: isRunning,
    });
    if (!ok) return;

    if (isRunning) {
      sessionRefs.current.get(id)?.cancel();
    }

    // Compute the next sessions list and the next active id outside the updater
    // so that React 19 concurrent re-runs of setSessions don't trigger duplicate
    // setActiveId calls or other side effects.
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const freshId = genId();
      setSessions([{ id: freshId, status: 'idle', project: '' }]);
      setActiveId(freshId);
    } else {
      setSessions(remaining);
      if (activeId === id) {
        setActiveId(remaining[0]?.id ?? '');
      }
    }
    sessionRefs.current.delete(id);
  }

  const handleStatusChange = useCallback(
    (sessionId: string, status: RunStatus | 'idle', project: string, tool?: ToolId) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status, project, tool: tool ?? s.tool } : s)),
      );
      // Add to notification center on completion
      if (status === 'passed' || status === 'failed' || status === 'cancelled') {
        addNotification({
          type: status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'warning',
          title:
            status === 'passed'
              ? t('run.testPassed')
              : status === 'failed'
                ? t('run.testFailed')
                : t('run.testCancelled'),
          message: tool ? `${project} · ${toolLabel(tool, tools)}` : project,
        });
      }
    },
    [addNotification, t, tools],
  );

  function handleLoadBookmark(config: RunRequest) {
    const active = sessions.find((s) => s.id === activeId);
    if (active && active.status === 'idle') {
      const freshId = genId();
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                id: freshId,
                status: 'idle',
                project: config.project,
                tool: config.tool,
                initialConfig: config,
              }
            : s,
        ),
      );
      sessionRefs.current.delete(activeId);
      setActiveId(freshId);
    } else {
      addSession(config);
    }
  }

  // Keyboard shortcuts
  useHotkeys([
    [
      'mod+T',
      (e) => {
        e.preventDefault();
        addSession();
      },
    ],
    [
      'mod+W',
      (e) => {
        e.preventDefault();
        if (sessions.length > 1) closeSession(activeId);
      },
    ],
  ]);

  if (reconnecting) {
    return (
      <Center h="100%">
        <Group gap="sm">
          <Loader size="sm" />
          <Text c="dimmed" size="sm">
            {t('run.checkingActive')}
          </Text>
        </Group>
      </Center>
    );
  }

  // First-time experience: no projects exist yet. Guide the user to create one
  // instead of presenting a form with empty dropdowns and no clear next step.
  if (noProjects) {
    return (
      <EmptyState
        fullHeight
        icon={<TbRocket size={40} color="var(--mantine-color-brand-6)" />}
        title={t('run.firstTitle')}
        description={t('run.firstDesc')}
        action={
          <Group gap="xs">
            <Button
              leftSection={<TbFolderPlus size={14} />}
              onClick={() => navigate({ to: '/projects' })}
            >
              {t('run.goToProjects')}
            </Button>
            <Button
              variant="default"
              onClick={() => projectsQ.refetch()}
              loading={projectsQ.isFetching}
            >
              {t('run.justAdded')}
            </Button>
          </Group>
        }
      />
    );
  }

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      {/* Bookmarks — prominent position at top */}
      <div style={{ flexShrink: 0 }}>
        <BookmarkPanel
          getConfig={() =>
            sessionRefs.current.get(activeId)?.getConfig() ?? {
              tool: 'playwright',
              type: '',
              project: '',
              mode: 'local',
            }
          }
          onLoad={handleLoadBookmark}
          disabled={sessions.find((s) => s.id === activeId)?.status === 'running'}
        />
      </div>

      {/* Queue & Active Runs — pinned in the fixed top region */}
      <div style={{ flexShrink: 0 }}>
        <RunQueuePanel />
      </div>

      {/* Tab bar */}
      <ScrollArea scrollbarSize={6} type="auto" style={{ flexShrink: 0 }}>
        <Group gap={4} wrap="nowrap" pb={6}>
          {sessions.map((s) => {
            const isActive = activeId === s.id;
            const sColor = getStatusColor(s.status);
            return (
              <Group
                key={s.id}
                gap={0}
                wrap="nowrap"
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--mantine-color-default-border)',
                  borderColor: isActive
                    ? 'var(--mantine-color-brand-filled)'
                    : 'var(--mantine-color-default-border)',
                  background: isActive
                    ? 'var(--mantine-color-brand-light)'
                    : 'var(--mantine-color-default)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                  }}
                >
                  <Badge
                    size="xs"
                    color={sColor}
                    variant={s.status === 'running' ? 'dot' : 'filled'}
                    circle
                  />
                  <Text size="xs" fw={isActive ? 600 : 400}>
                    {s.project || t('run.newSession')}
                  </Text>
                  {s.tool && (
                    <Badge size="xs" color="gray" variant="light">
                      {toolLabel(s.tool, tools)}
                    </Badge>
                  )}
                </button>
                {sessions.length > 1 && (
                  <Tooltip label={t('run.closeSessionTip')} withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeSession(s.id);
                      }}
                      aria-label="Close session"
                    >
                      <TbX size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            );
          })}
          <Tooltip label={t('run.newSessionTip')} withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={() => addSession()}
              aria-label="New session"
            >
              <TbPlus size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </ScrollArea>

      {/* Sessions */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {sessions.map((s) => (
          <RunSession
            key={s.id}
            ref={(r: SessionRef | null) => {
              if (r) sessionRefs.current.set(s.id, r);
            }}
            sessionId={s.id}
            initialConfig={s.initialConfig}
            reconnectRunId={s.reconnectRunId}
            reconnectCommand={s.reconnectCommand}
            onStatusChange={handleStatusChange}
            visible={activeId === s.id}
          />
        ))}
      </div>
    </Stack>
  );
}
