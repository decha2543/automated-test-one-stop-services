import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TbCopy, TbDots, TbFolder, TbPlayerPlay, TbRoute } from 'react-icons/tb';
import { api } from '~/api/client.js';
import { toast } from '~/components/Toast.js';

export interface ArtifactGroup {
  name: string;
  traces: { name: string; path: string }[];
  videos: { name: string; path: string }[];
}

export interface ArtifactData {
  groups: ArtifactGroup[];
}

export interface ArtifactMenuProps {
  /** Absolute path to the report file (`.../html-results/index.html`). */
  reportPath: string;
}

/**
 * Modal dropdown that lists trace + video artifacts for a single report.
 * Extracted from `pages/Reports.tsx` (was ~260 inline lines) to keep that
 * file focused on the report table itself.
 */
export function ArtifactMenu({ reportPath }: ArtifactMenuProps) {
  const [artifactOpen, { open: openArtifacts, close: closeArtifacts }] = useDisclosure(false);
  const [videoOpen, { open: openVideo, close: closeVideo }] = useDisclosure(false);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [runningTraces, setRunningTraces] = useState<Set<string>>(new Set());

  const artifacts = useQuery<ArtifactData>({
    queryKey: ['artifacts', reportPath],
    queryFn: () => api.post('/api/reports/artifacts', { path: reportPath }),
    enabled: artifactOpen,
  });

  function toggleGroup(name: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function pollTraceStatus(tracePath: string) {
    const interval = setInterval(async () => {
      try {
        const res = await api.post<{ running: boolean }>('/api/reports/trace/status', {
          path: tracePath,
        });
        if (!res.running) {
          clearInterval(interval);
          setRunningTraces((prev) => {
            const next = new Set(prev);
            next.delete(tracePath);
            return next;
          });
        }
      } catch {
        clearInterval(interval);
        setRunningTraces((prev) => {
          const next = new Set(prev);
          next.delete(tracePath);
          return next;
        });
      }
    }, 3000);
  }

  async function openTrace(tracePath: string) {
    try {
      setRunningTraces((prev) => new Set(prev).add(tracePath));
      await api.post('/api/reports/trace/open', { path: tracePath });
      pollTraceStatus(tracePath);
    } catch {
      setRunningTraces((prev) => {
        const next = new Set(prev);
        next.delete(tracePath);
        return next;
      });
      toast.error('Failed to open trace viewer');
    }
  }

  async function closeTrace(tracePath: string) {
    try {
      await api.post('/api/reports/trace/close', { path: tracePath });
    } catch {
      // ignore — the viewer may already be gone
    }
    setRunningTraces((prev) => {
      const next = new Set(prev);
      next.delete(tracePath);
      return next;
    });
  }

  function handleVideoClick(videoPath: string) {
    setSelectedVideo(`/api/reports/artifact/serve?path=${encodeURIComponent(videoPath)}`);
    openVideo();
  }

  function handleOpen() {
    setExpandedGroups(new Set());
    openArtifacts();
  }

  // Artifact run-directory = parent of html-results folder.
  // reportPath: .../<time>/html-results/index.html → dir: .../<time>/
  const artifactDir = (() => {
    const norm = reportPath.replace(/\\/g, '/');
    const lastSep = norm.lastIndexOf('/');
    if (lastSep === -1) return reportPath;
    const htmlResultsDir = norm.slice(0, lastSep);
    const prevSep = htmlResultsDir.lastIndexOf('/');
    return prevSep === -1 ? htmlResultsDir : htmlResultsDir.slice(0, prevSep);
  })();

  function handleCopyDir() {
    navigator.clipboard.writeText(artifactDir);
    toast.success('Artifact directory copied');
  }

  async function handleRevealDir() {
    try {
      await api.post('/api/system/reveal', { path: artifactDir });
    } catch (err) {
      toast.error((err as Error).message || 'Reveal failed');
    }
  }

  const totalArtifacts = (artifacts.data?.groups ?? []).reduce(
    (sum, g) => sum + g.traces.length + g.videos.length,
    0,
  );

  return (
    <>
      <Tooltip label="View artifacts (trace/video)">
        <ActionIcon variant="subtle" size="sm" onClick={handleOpen} aria-label="Artifacts">
          <TbDots size={14} />
        </ActionIcon>
      </Tooltip>

      <Modal
        opened={artifactOpen}
        onClose={closeArtifacts}
        title={
          <Group gap="xs" wrap="nowrap">
            <Text fw={600}>Test Artifacts</Text>
            <Tooltip label={artifactDir} withArrow>
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<TbCopy size={12} />}
                onClick={handleCopyDir}
              >
                Copy directory
              </Button>
            </Tooltip>
            <Tooltip label="Reveal in file explorer" withArrow>
              <Button
                size="compact-xs"
                variant="light"
                color="gray"
                leftSection={<TbFolder size={12} />}
                onClick={handleRevealDir}
              >
                Reveal
              </Button>
            </Tooltip>
          </Group>
        }
        size="lg"
        centered
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {artifacts.isLoading && (
          <Text size="sm" c="dimmed">
            Loading artifacts...
          </Text>
        )}
        {artifacts.data && totalArtifacts === 0 && (
          <Text size="sm" c="dimmed">
            No traces or videos found for this report.
          </Text>
        )}
        {artifacts.data && totalArtifacts > 0 && (
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              {totalArtifacts} artifact(s) in {artifacts.data.groups.length} test(s)
            </Text>
            {artifacts.data.groups.map((group) => {
              const isExpanded = expandedGroups.has(group.name);
              const displayName = group.name === '_root' ? 'Root' : group.name;
              return (
                <Paper key={group.name} withBorder style={{ overflow: 'hidden' }}>
                  <Button
                    variant="subtle"
                    fullWidth
                    justify="space-between"
                    onClick={() => toggleGroup(group.name)}
                    rightSection={
                      <Badge size="xs" color="gray" variant="light">
                        {group.traces.length + group.videos.length}
                      </Badge>
                    }
                    styles={{ inner: { justifyContent: 'space-between' } }}
                  >
                    <Text size="xs" fw={500} truncate style={{ textAlign: 'left' }}>
                      {displayName}
                    </Text>
                  </Button>
                  {isExpanded && (
                    <Stack gap={4} px="sm" pb="sm">
                      {group.traces.map((t) => (
                        <Group key={t.path} gap="xs" wrap="nowrap">
                          <TbRoute size={14} color="var(--mantine-color-violet-6)" />
                          <Text size="xs" truncate style={{ flex: 1 }}>
                            {t.name}
                          </Text>
                          {runningTraces.has(t.path) ? (
                            <Button
                              size="compact-xs"
                              variant="filled"
                              color="red"
                              onClick={() => closeTrace(t.path)}
                            >
                              Stop
                            </Button>
                          ) : (
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="violet"
                              onClick={() => openTrace(t.path)}
                            >
                              Open
                            </Button>
                          )}
                        </Group>
                      ))}
                      {group.videos.map((v) => (
                        <Group key={v.path} gap="xs" wrap="nowrap">
                          <TbPlayerPlay size={14} color="var(--mantine-color-blue-6)" />
                          <Text size="xs" truncate style={{ flex: 1 }}>
                            {v.name}
                          </Text>
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="blue"
                            onClick={() => handleVideoClick(v.path)}
                          >
                            Play
                          </Button>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Paper>
              );
            })}
          </Stack>
        )}
      </Modal>

      <Modal opened={videoOpen} onClose={closeVideo} title="Test Video" size="lg" centered>
        {selectedVideo && (
          <video
            src={selectedVideo}
            controls
            autoPlay
            style={{ width: '100%', maxHeight: '70vh', borderRadius: 8 }}
          >
            <track kind="captions" />
          </video>
        )}
      </Modal>
    </>
  );
}
