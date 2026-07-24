import type { TestCaseDoc, ToolId } from '@hub/shared';
import { Badge, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TbChecklist, TbDownload, TbEye, TbFileSpreadsheet } from 'react-icons/tb';
import { api } from '~/api/client.js';
import { qProjectList, qProjectTypes } from '~/api/queries.js';
import { EmptyState } from '~/components/EmptyState.js';
import { PageHeader } from '~/components/PageHeader.js';
import { ListSkeleton } from '~/components/Skeletons.js';
import { TestCaseGridEditor } from '~/components/testcases/TestCaseGridEditor.js';
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

export function TestCasesPage() {
  const t = useT();
  const toolOptions = useToolOptions();
  const [tool, setTool] = useState<ToolId | ''>('');
  const [type, setType] = useState('');
  const [project, setProject] = useState('');
  const [openDoc, setOpenDoc] = useState<TestCaseDoc | null>(null);

  const typesQ = useQuery(qProjectTypes(tool));
  const projectsQ = useQuery(qProjectList(tool, type));
  const docsQ = useQuery<TestCaseDoc[]>({
    queryKey: ['testcases', tool, type, project],
    queryFn: () => api.get(`/api/testcases?tool=${tool}&type=${type}&project=${project}`),
    enabled: !!tool && !!type && !!project,
  });

  const onTool = (v: string | null) => {
    setTool((v as ToolId) ?? '');
    setType('');
    setProject('');
    setOpenDoc(null);
  };
  const onType = (v: string | null) => {
    setType(v ?? '');
    setProject('');
    setOpenDoc(null);
  };
  const onProject = (v: string | null) => {
    setProject(v ?? '');
    setOpenDoc(null);
  };

  const ready = !!tool && !!type && !!project;

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
                    variant={openDoc?.path === doc.path ? 'filled' : 'light'}
                    leftSection={<TbEye size={12} />}
                    onClick={() => setOpenDoc(doc)}
                  >
                    {t('testcases.open')}
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
      <Modal
        opened={!!openDoc && !!tool}
        onClose={() => setOpenDoc(null)}
        title={openDoc?.name}
        size="90%"
      >
        {openDoc && tool && (
          <TestCaseGridEditor doc={openDoc} tool={tool} type={type} project={project} />
        )}
      </Modal>
    </Stack>
  );
}
