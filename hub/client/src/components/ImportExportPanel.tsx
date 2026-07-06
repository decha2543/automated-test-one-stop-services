import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FileInput,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { TbAlertTriangle, TbCircleCheck, TbDownload, TbFileImport, TbUpload } from 'react-icons/tb';
import { api } from '~/api/client';
import { confirmDialog } from '~/components/confirmDialog';
import { toast } from '~/components/Toast';

interface ImportResult {
  bookmarks?: number;
  schedules?: number;
  webhooks?: number;
  envProfiles?: number;
}

interface ParsedPayload {
  version?: string;
  exportedAt?: string;
  bookmarks?: unknown[];
  schedules?: unknown[];
  webhooks?: unknown[];
  envProfiles?: unknown[];
}

const EXPORT_ITEMS = [
  { key: 'bookmarks', label: 'Bookmarks' },
  { key: 'schedules', label: 'Schedules' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'envProfiles', label: 'Environment Profiles' },
] as const;

type ExportKey = (typeof EXPORT_ITEMS)[number]['key'];
const ALL_KEYS: ExportKey[] = EXPORT_ITEMS.map((i) => i.key);

/**
 * Read a JSON file and validate it is a hub export payload. Returns the parsed
 * payload or null on failure (with a toast). Used to power the import preview.
 */
async function parseImportFile(file: File): Promise<ParsedPayload | null> {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('File is not a valid hub export.');
    }
    const obj = parsed as ParsedPayload;
    // Sanity check: at least one known section must be present.
    const hasAnySection = ALL_KEYS.some((k) => Array.isArray(obj[k]));
    if (!hasAnySection) {
      throw new Error('No bookmarks, schedules, webhooks, or envProfiles found.');
    }
    return obj;
  } catch (err) {
    toast.error(`Invalid export file: ${(err as Error).message}`);
    return null;
  }
}

export function ImportExportPanel() {
  // Export state
  const [exportIncludes, setExportIncludes] = useState<ExportKey[]>([...ALL_KEYS]);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedPayload | null>(null);
  const [mergeMode, setMergeMode] = useState(true);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Re-parse preview whenever the selected file changes.
  useEffect(() => {
    let cancelled = false;
    if (!importFile) {
      setImportPreview(null);
      setImportResult(null);
      return;
    }
    void parseImportFile(importFile).then((p) => {
      if (cancelled) return;
      setImportPreview(p);
      // Clear stale result from a previous import.
      setImportResult(null);
    });
    return () => {
      cancelled = true;
    };
  }, [importFile]);

  function toggleExportItem(key: ExportKey) {
    setExportIncludes((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const allExportSelected = exportIncludes.length === ALL_KEYS.length;

  const exportMutation = useMutation({
    mutationFn: async () => {
      const params = exportIncludes.join(',');
      const data = await api.get<unknown>(`/api/export?include=${params}`);
      return data;
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hub-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const importMutation = useMutation({
    mutationFn: async (payload: ParsedPayload) =>
      api.post<ImportResult>('/api/import', { ...payload, merge: mergeMode }),
    onSuccess: (data) => {
      setImportResult(data);
      setImportFile(null);
      setImportPreview(null);
      toast.success('Import completed');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  async function handleImportClick() {
    if (!importPreview) return;
    if (!mergeMode) {
      const ok = await confirmDialog({
        title: 'Replace existing data?',
        message:
          'Replace mode will overwrite all current bookmarks, schedules, webhooks, and environment profiles with the contents of this file. This cannot be undone.',
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!ok) return;
    }
    importMutation.mutate(importPreview);
  }

  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        <Title order={5}>Import / Export</Title>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {/* Export card */}
          <Card withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <TbDownload size={16} />
                <Text size="sm" fw={600}>
                  Export
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Download hub configuration as a JSON file.
              </Text>

              <Group justify="space-between" align="center">
                <Text size="xs" fw={500}>
                  Include
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setExportIncludes(allExportSelected ? [] : [...ALL_KEYS])}
                >
                  {allExportSelected ? 'Clear all' : 'Select all'}
                </Button>
              </Group>

              <Stack gap={4}>
                {EXPORT_ITEMS.map((item) => (
                  <Checkbox
                    key={item.key}
                    label={item.label}
                    size="xs"
                    checked={exportIncludes.includes(item.key)}
                    onChange={() => toggleExportItem(item.key)}
                  />
                ))}
              </Stack>

              <Button
                size="xs"
                leftSection={<TbDownload size={14} />}
                onClick={() => exportMutation.mutate()}
                loading={exportMutation.isPending}
                disabled={exportIncludes.length === 0}
                mt="auto"
              >
                Export
              </Button>
            </Stack>
          </Card>

          {/* Import card */}
          <Card withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <TbUpload size={16} />
                <Text size="sm" fw={600}>
                  Import
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Upload a previously exported JSON file to restore configuration.
              </Text>

              <FileInput
                size="xs"
                placeholder="Select .json file"
                accept=".json,application/json"
                value={importFile}
                onChange={setImportFile}
                leftSection={<TbFileImport size={14} />}
                clearable
              />

              {/* Preview of file contents */}
              {importPreview && (
                <Card withBorder p="xs" radius="sm" bg="var(--mantine-color-default-hover)">
                  <Stack gap={4}>
                    <Group gap={6} align="center">
                      <TbCircleCheck size={14} color="var(--mantine-color-green-6)" />
                      <Text size="xs" fw={500}>
                        Preview
                      </Text>
                      {importPreview.version && (
                        <Badge size="xs" variant="light">
                          v{importPreview.version}
                        </Badge>
                      )}
                    </Group>
                    <List size="xs" spacing={2} center>
                      {ALL_KEYS.map((k) => {
                        const arr = importPreview[k];
                        const count = Array.isArray(arr) ? arr.length : null;
                        if (count === null) return null;
                        return (
                          <List.Item key={k}>
                            <Text size="xs">
                              {EXPORT_ITEMS.find((i) => i.key === k)?.label}:{' '}
                              <Text span fw={600}>
                                {count}
                              </Text>
                            </Text>
                          </List.Item>
                        );
                      })}
                    </List>
                  </Stack>
                </Card>
              )}

              <Switch
                label={mergeMode ? 'Merge with existing' : 'Replace existing'}
                checked={mergeMode}
                onChange={(e) => setMergeMode(e.currentTarget.checked)}
                size="sm"
                color={mergeMode ? 'blue' : 'red'}
              />
              {!mergeMode && (
                <Group gap={6} align="center" wrap="nowrap">
                  <TbAlertTriangle size={14} color="var(--mantine-color-red-6)" />
                  <Text size="xs" c="red">
                    Replace mode overwrites existing data.
                  </Text>
                </Group>
              )}

              <Button
                size="xs"
                color={mergeMode ? 'blue' : 'red'}
                leftSection={<TbUpload size={14} />}
                onClick={handleImportClick}
                loading={importMutation.isPending}
                disabled={!importPreview}
                mt="auto"
              >
                {mergeMode ? 'Import (Merge)' : 'Import (Replace)'}
              </Button>

              {importResult && (
                <Alert color="green" variant="light" title="Import Complete" p="xs">
                  <Stack gap={2}>
                    {importResult.bookmarks != null && (
                      <Text size="xs">Bookmarks: {importResult.bookmarks} imported</Text>
                    )}
                    {importResult.schedules != null && (
                      <Text size="xs">Schedules: {importResult.schedules} imported</Text>
                    )}
                    {importResult.webhooks != null && (
                      <Text size="xs">Webhooks: {importResult.webhooks} imported</Text>
                    )}
                    {importResult.envProfiles != null && (
                      <Text size="xs">Env Profiles: {importResult.envProfiles} imported</Text>
                    )}
                  </Stack>
                </Alert>
              )}
            </Stack>
          </Card>
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}
