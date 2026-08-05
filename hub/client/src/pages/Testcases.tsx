import type { TestCaseDoc, TestCaseModule, ToolId } from '@hub/shared';
import {
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  TbChecklist,
  TbDownload,
  TbEye,
  TbFilePlus,
  TbFileSpreadsheet,
  TbTable,
} from 'react-icons/tb';
import { api } from '~/api/client.js';
import { qProjectList, qProjectTypes, qTestCaseDocs, qTestCaseModules } from '~/api/queries.js';
import { EmptyState } from '~/components/EmptyState.js';
import { FormModal } from '~/components/FormModal.js';
import { PageHeader } from '~/components/PageHeader.js';
import { ListSkeleton } from '~/components/Skeletons.js';
import { toast } from '~/components/Toast.js';
import { TestCaseGridEditor } from '~/components/testcases/TestCaseGridEditor.js';
import { useToolOptions } from '~/hooks/useTools.js';
import { useT } from '~/i18n/index.js';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `source` streams the untouched doc; `result` streams the overlay-merged xlsx. */
function downloadUrl(docPath: string, variant: 'source' | 'result'): string {
  return `/api/testcases/download?path=${encodeURIComponent(docPath)}&variant=${variant}`;
}

export function TestCasesPage() {
  const t = useT();
  const qc = useQueryClient();
  const toolOptions = useToolOptions();
  const [tool, setTool] = useState<ToolId | ''>('');
  const [type, setType] = useState('');
  const [project, setProject] = useState('');
  const [openDoc, setOpenDoc] = useState<TestCaseDoc | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newModule, setNewModule] = useState<string | null>(null);

  const typesQ = useQuery(qProjectTypes(tool));
  const projectsQ = useQuery(qProjectList(tool, type));
  const docsQ = useQuery(qTestCaseDocs(tool, type, project));
  // Modules are only needed by the create form, so the scan waits for it to open.
  const modulesQ = useQuery({
    ...qTestCaseModules(tool, type, project),
    enabled: createOpen && !!tool && !!type && !!project,
  });

  const create = useMutation({
    mutationFn: (moduleName: string) =>
      api.post<TestCaseDoc>('/api/testcases/create', { tool, type, project, module: moduleName }),
    onSuccess: (doc) => {
      setCreateOpen(false);
      setNewModule(null);
      qc.invalidateQueries({ queryKey: ['testcases', tool, type, project] });
      qc.invalidateQueries({ queryKey: ['testcase-modules', tool, type, project] });
      toast.success(`${t('testcases.created')}: ${doc.name}`);
      setOpenDoc(doc);
    },
  });

  const resetSelection = () => {
    setOpenDoc(null);
    setCreateOpen(false);
    setNewModule(null);
  };
  const onTool = (v: string | null) => {
    setTool((v as ToolId) ?? '');
    setType('');
    setProject('');
    resetSelection();
  };
  const onType = (v: string | null) => {
    setType(v ?? '');
    setProject('');
    resetSelection();
  };
  const onProject = (v: string | null) => {
    setProject(v ?? '');
    resetSelection();
  };

  const ready = !!tool && !!type && !!project;
  const moduleOptions = (modulesQ.data ?? []).map((m: TestCaseModule) => ({
    value: m.name,
    label: m.docRelPath ? `${m.name} — ${t('testcases.moduleHasDoc')}` : m.name,
    disabled: !!m.docRelPath,
  }));
  const creatable = moduleOptions.filter((o) => !o.disabled);

  return (
    <Stack gap="md">
      <PageHeader
        title={t('testcases.title')}
        description={t('nav.testCases.desc')}
        actions={
          <Tooltip label={t('testcases.selectProjectFirst')} disabled={ready} withArrow>
            <Button
              size="xs"
              leftSection={<TbFilePlus size={14} />}
              disabled={!ready}
              onClick={() => setCreateOpen(true)}
            >
              {t('testcases.newDoc')}
            </Button>
          </Tooltip>
        }
      />
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
                  {doc.edited && (
                    <Badge size="xs" variant="light" color="orange">
                      {t('testcases.editedBadge')}
                    </Badge>
                  )}
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
                  <Menu position="bottom-end" withArrow>
                    <Menu.Target>
                      <Button
                        size="compact-xs"
                        variant="light"
                        color="gray"
                        leftSection={<TbDownload size={12} />}
                      >
                        {t('testcases.download')}
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        component="a"
                        href={downloadUrl(doc.path, 'source')}
                        leftSection={<TbFileSpreadsheet size={14} />}
                      >
                        <Text size="xs">{t('testcases.downloadTemplate')}</Text>
                        <Text size="xs" c="dimmed">
                          {doc.name}
                        </Text>
                      </Menu.Item>
                      <Menu.Item
                        component="a"
                        href={downloadUrl(doc.path, 'result')}
                        leftSection={<TbTable size={14} />}
                      >
                        <Text size="xs">{t('testcases.downloadResult')}</Text>
                        <Text size="xs" c="dimmed">
                          {doc.edited
                            ? doc.name.replace(/\.(xlsx|csv)$/i, '.result.xlsx')
                            : t('testcases.downloadResultEmpty')}
                        </Text>
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
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

      <FormModal
        opened={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setNewModule(null);
        }}
        title={t('testcases.newDocTitle')}
        submitLabel={t('testcases.newDoc')}
        onSubmit={() => newModule && create.mutate(newModule)}
        submitDisabled={!newModule}
        loading={create.isPending}
        error={create.error ? create.error.message : null}
      >
        <Text size="xs" c="dimmed">
          {t('testcases.newDocHint')}
        </Text>
        <Select
          label={t('testcases.module')}
          size="xs"
          searchable
          data={moduleOptions}
          value={newModule}
          onChange={setNewModule}
          placeholder={
            modulesQ.isLoading
              ? t('common.loading')
              : creatable.length === 0
                ? t('testcases.noModulesLeft')
                : t('testcases.module')
          }
          disabled={modulesQ.isLoading || creatable.length === 0}
        />
        {newModule && (
          <Text size="xs" c="dimmed" ff="monospace">
            docs/{newModule}/{newModule}_test-case.xlsx
          </Text>
        )}
      </FormModal>
    </Stack>
  );
}
