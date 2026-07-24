import type { TestCaseCsv, TestCaseDoc, TestCaseWorkbook, ToolId } from '@hub/shared';
import {
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TbAlertTriangle, TbChecklist, TbDownload, TbEye, TbFileSpreadsheet } from 'react-icons/tb';
import { api } from '~/api/client.js';
import { qProjectList, qProjectTypes } from '~/api/queries.js';
import { EmptyState } from '~/components/EmptyState.js';
import { InlineAlert } from '~/components/InlineAlert.js';
import { PageHeader } from '~/components/PageHeader.js';
import { ListSkeleton } from '~/components/Skeletons.js';
import { useToolOptions } from '~/hooks/useTools.js';
import { useT } from '~/i18n/index.js';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadUrl(docPath: string): string {
  return `/api/testcases/download?path=${encodeURIComponent(docPath)}`;
}

/** Header row + body rows, shared by the CSV and xlsx previews. */
function PreviewTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <ScrollArea.Autosize mah="55vh">
      <Table striped highlightOnHover verticalSpacing={4} stickyHeader>
        <Table.Thead>
          <Table.Tr>
            {headers.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: header cells are positional
              <Table.Th key={i}>
                <Text size="xs">{h}</Text>
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row, ri) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional in a flat sheet
            <Table.Tr key={ri}>
              {row.map((cell, ci) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                <Table.Td key={ci}>
                  <Text size="xs">{cell}</Text>
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}

export function TestCasesPage() {
  const t = useT();
  const toolOptions = useToolOptions();
  const [tool, setTool] = useState<ToolId | ''>('');
  const [type, setType] = useState('');
  const [project, setProject] = useState('');
  const [preview, setPreview] = useState<TestCaseDoc | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);

  const typesQ = useQuery(qProjectTypes(tool));
  const projectsQ = useQuery(qProjectList(tool, type));
  const docsQ = useQuery<TestCaseDoc[]>({
    queryKey: ['testcases', tool, type, project],
    queryFn: () => api.get(`/api/testcases?tool=${tool}&type=${type}&project=${project}`),
    enabled: !!tool && !!type && !!project,
  });
  const csvQ = useQuery<TestCaseCsv>({
    queryKey: ['testcases-csv', preview?.path],
    queryFn: () => api.get(`/api/testcases/csv?path=${encodeURIComponent(preview?.path ?? '')}`),
    enabled: !!preview && preview.ext === 'csv',
  });
  const xlsxQ = useQuery<TestCaseWorkbook>({
    queryKey: ['testcases-xlsx', preview?.path],
    queryFn: () => api.get(`/api/testcases/xlsx?path=${encodeURIComponent(preview?.path ?? '')}`),
    enabled: !!preview && preview.ext === 'xlsx',
  });

  const onTool = (v: string | null) => {
    setTool((v as ToolId) ?? '');
    setType('');
    setProject('');
    setPreview(null);
  };
  const onType = (v: string | null) => {
    setType(v ?? '');
    setProject('');
    setPreview(null);
  };
  const onProject = (v: string | null) => {
    setProject(v ?? '');
    setPreview(null);
  };
  const openPreview = (doc: TestCaseDoc) => {
    setPreview(doc);
    setSheetIdx(0);
  };

  const ready = !!tool && !!type && !!project;
  const sheets = xlsxQ.data?.sheets ?? [];
  const activeSheet = sheets[Math.min(sheetIdx, Math.max(0, sheets.length - 1))];
  const previewTruncated = preview?.ext === 'csv' ? csvQ.data?.truncated : xlsxQ.data?.truncated;

  return (
    <Stack gap="md">
      <PageHeader title={t('testcases.title')} description={t('nav.testCases.desc')} />

      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
          <Select
            label={t('run.tool')}
            size="xs"
            data={toolOptions}
            value={tool || null}
            onChange={onTool}
            placeholder={t('run.tool')}
          />
          <Select
            label={t('table.type')}
            size="xs"
            data={typesQ.data ?? []}
            value={type || null}
            onChange={onType}
            placeholder={t('table.type')}
            disabled={!tool}
          />
          <Select
            label={t('run.project')}
            size="xs"
            searchable
            data={projectsQ.data ?? []}
            value={project || null}
            onChange={onProject}
            placeholder={t('run.project')}
            disabled={!type}
          />
        </SimpleGrid>
      </Paper>

      {!ready ? (
        <EmptyState
          icon={<TbChecklist size={48} color="var(--mantine-color-dimmed)" />}
          description={t('testcases.selectProject')}
        />
      ) : docsQ.isLoading ? (
        <ListSkeleton />
      ) : !docsQ.data || docsQ.data.length === 0 ? (
        <EmptyState
          icon={<TbChecklist size={48} color="var(--mantine-color-dimmed)" />}
          description={t('testcases.none')}
        />
      ) : (
        <Stack gap="xs">
          {docsQ.data.map((doc) => (
            <Paper key={doc.path} withBorder p="sm">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <TbFileSpreadsheet
                    size={20}
                    color={
                      doc.ext === 'csv'
                        ? 'var(--mantine-color-teal-6)'
                        : 'var(--mantine-color-green-6)'
                    }
                  />
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {doc.name}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace" truncate>
                      {doc.relPath}
                    </Text>
                  </Stack>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Badge size="xs" variant="light" color={doc.ext === 'csv' ? 'teal' : 'green'}>
                    {doc.ext}
                  </Badge>
                  <Badge size="xs" variant="light" color="gray">
                    {formatSize(doc.size)}
                  </Badge>
                  <Button
                    size="compact-xs"
                    variant="light"
                    leftSection={<TbEye size={12} />}
                    onClick={() => openPreview(doc)}
                  >
                    {t('testcases.preview')}
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="gray"
                    component="a"
                    href={downloadUrl(doc.path)}
                    leftSection={<TbDownload size={12} />}
                  >
                    {t('testcases.download')}
                  </Button>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {preview && (
        <Paper withBorder p="md">
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>
              {preview.name}
            </Text>
            {previewTruncated && (
              <InlineAlert
                icon={<TbAlertTriangle size={16} />}
                message={t('testcases.truncated')}
              />
            )}
          </Group>

          {preview.ext === 'csv' ? (
            csvQ.isLoading ? (
              <ListSkeleton rows={6} />
            ) : csvQ.data ? (
              <PreviewTable headers={csvQ.data.headers} rows={csvQ.data.rows} />
            ) : (
              <Text size="xs" c="dimmed">
                {t('testcases.none')}
              </Text>
            )
          ) : xlsxQ.isLoading ? (
            <ListSkeleton rows={6} />
          ) : activeSheet ? (
            <Stack gap="xs">
              {sheets.length > 1 && (
                <SegmentedControl
                  size="xs"
                  value={String(Math.min(sheetIdx, sheets.length - 1))}
                  onChange={(v) => setSheetIdx(Number(v))}
                  data={sheets.map((s, i) => ({ value: String(i), label: s.name }))}
                />
              )}
              <PreviewTable headers={activeSheet.rows[0] ?? []} rows={activeSheet.rows.slice(1)} />
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">
              {t('testcases.none')}
            </Text>
          )}
        </Paper>
      )}
    </Stack>
  );
}
