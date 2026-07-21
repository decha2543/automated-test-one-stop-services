import type { ToolId } from '@hub/shared';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import {
  TbCheck,
  TbDownload,
  TbKey,
  TbPencil,
  TbPlayerPlay,
  TbPlus,
  TbTrash,
} from 'react-icons/tb';
import { api } from '~/api/client';
import { confirmDialog } from '~/components/confirmDialog.js';
import { EmptyState } from '~/components/EmptyState.js';
import { FormModal } from '~/components/FormModal.js';
import { PageHeader } from '~/components/PageHeader.js';
import { ListSkeleton } from '~/components/Skeletons.js';
import { toast } from '~/components/Toast';
import { useProjectList, useProjectTypes } from '~/hooks/useProjectQueries';
import { useToolOptions } from '~/hooks/useTools.js';
import { useT } from '~/i18n/index.js';

interface EnvProfile {
  id: string;
  name: string;
  environment: string;
  tool: string;
  type: string;
  project: string;
  entries: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

const ENV_OPTIONS = [
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
  { value: 'custom', label: 'Custom' },
];

function envColor(env: string) {
  switch (env) {
    case 'dev':
      return 'blue';
    case 'staging':
      return 'yellow';
    case 'prod':
      return 'red';
    default:
      return 'gray';
  }
}

export function EnvProfilesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<EnvProfile | null>(null);
  const [captureOpen, { open: openCapture, close: closeCapture }] = useDisclosure(false);

  // Cascading selectors
  const [tool, setTool] = useState('playwright');
  const [type, setType] = useState('');
  const [project, setProject] = useState('');

  const types = useProjectTypes(tool as ToolId);
  const projects = useProjectList(tool as ToolId, type);
  const toolOptions = useToolOptions();

  const profiles = useQuery<EnvProfile[]>({
    queryKey: ['env-profiles', tool, type, project],
    queryFn: () =>
      api.get(`/api/env-profiles/by-project?tool=${tool}&type=${type}&project=${project}`),
    enabled: !!tool && !!type && !!project,
  });

  const activeProfile = useQuery<{ activeId: string | null }>({
    queryKey: ['env-profiles-active', tool, type, project],
    queryFn: () => api.get(`/api/env-profiles/active?tool=${tool}&type=${type}&project=${project}`),
    enabled: !!tool && !!type && !!project,
  });

  const applyMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/env-profiles/${id}/apply`),
    onSuccess: () => {
      toast.success(t('envProfiles.applied'));
      queryClient.invalidateQueries({ queryKey: ['env-profiles-active', tool, type, project] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/env-profiles/${id}`),
    onSuccess: () => {
      toast.success(t('envProfiles.deleted'));
      queryClient.invalidateQueries({ queryKey: ['env-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['env-profiles-active'] });
    },
  });

  async function handleDelete(id: string) {
    const ok = await confirmDialog({
      title: t('envProfiles.deleteTitle'),
      message: t('envProfiles.deleteConfirm'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok) deleteMutation.mutate(id);
  }

  return (
    <Stack gap="md">
      <PageHeader
        title={t('envProfiles.title')}
        description={t('nav.envProfiles.desc')}
        actions={
          <>
            <Button
              variant="light"
              size="xs"
              onClick={openCapture}
              disabled={!project}
              leftSection={<TbKey size={14} />}
            >
              {t('envProfiles.captureCurrentEnv')}
            </Button>
            <Button leftSection={<TbPlus size={14} />} onClick={openCreate} size="xs">
              {t('envProfiles.newProfile')}
            </Button>
          </>
        }
      />

      {/* Cascading project selector */}
      <Paper p="md" withBorder>
        <Group gap="sm" wrap="wrap">
          <Select
            label="Tool"
            size="xs"
            w={160}
            value={tool}
            onChange={(v) => {
              if (!v) return;
              setTool(v);
              setType('');
              setProject('');
            }}
            data={toolOptions}
            allowDeselect={false}
          />
          <Select
            label="Type"
            size="xs"
            w={160}
            value={type || null}
            onChange={(v) => {
              setType(v ?? '');
              setProject('');
            }}
            placeholder={types.isLoading ? 'Loading...' : 'Select type...'}
            data={types.data ?? []}
            disabled={types.isLoading}
            rightSection={types.isLoading ? <Loader size={14} /> : undefined}
            searchable
          />
          <Select
            label="Project"
            size="xs"
            w={200}
            value={project || null}
            onChange={(v) => setProject(v ?? '')}
            placeholder={
              !type ? 'Select type first' : projects.isLoading ? 'Loading...' : 'Select project...'
            }
            data={projects.data ?? []}
            disabled={!type || projects.isLoading}
            rightSection={projects.isLoading ? <Loader size={14} /> : undefined}
            searchable
          />
        </Group>
      </Paper>

      {/* Loading profiles */}
      {profiles.isLoading && !!project && <ListSkeleton rows={3} />}

      {/* No project selected */}
      {!project && <EmptyState description={t('envProfiles.selectProject')} />}

      {/* Empty state */}
      {profiles.data && profiles.data.length === 0 && (
        <EmptyState
          icon={<TbKey size={48} color="var(--mantine-color-dimmed)" />}
          description={t('envProfiles.noProfiles')}
        />
      )}

      {/* Profile list */}
      {profiles.data && profiles.data.length > 0 && (
        <Stack gap="xs">
          {profiles.data.map((p) => {
            const isActive = activeProfile.data?.activeId === p.id;
            return (
              <Paper key={p.id} p="md" withBorder>
                <Group justify="space-between" wrap="wrap" gap="md">
                  <Group gap="md">
                    <Stack gap={2}>
                      <Group gap="xs">
                        <Text size="sm" fw={500}>
                          {p.name}
                        </Text>
                        <Badge size="xs" variant="light" color={envColor(p.environment)}>
                          {p.environment}
                        </Badge>
                        {isActive && (
                          <Badge
                            size="xs"
                            variant="filled"
                            color="green"
                            leftSection={<TbCheck size={10} />}
                          >
                            Active
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {Object.keys(p.entries).length} keys · Updated{' '}
                        {dayjs(p.updatedAt).fromNow()}
                      </Text>
                    </Stack>
                  </Group>
                  <Group gap="xs">
                    <Tooltip label={t('envProfiles.applyTooltip')}>
                      <Button
                        size="xs"
                        variant="light"
                        color="green"
                        leftSection={<TbPlayerPlay size={14} />}
                        onClick={() => applyMutation.mutate(p.id)}
                        loading={applyMutation.isPending && applyMutation.variables === p.id}
                      >
                        {t('envProfiles.apply')}
                      </Button>
                    </Tooltip>
                    <ActionIcon
                      variant="subtle"
                      color="blue"
                      onClick={() => setEditing(p)}
                      aria-label={t('envProfiles.editProfile')}
                    >
                      <TbPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleDelete(p.id)}
                      aria-label={t('envProfiles.deleteProfile')}
                    >
                      <TbTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* Create modal */}
      <ProfileFormModal
        opened={createOpen}
        onClose={closeCreate}
        tool={tool}
        type={type}
        project={project}
        onSuccess={() => {
          closeCreate();
          queryClient.invalidateQueries({ queryKey: ['env-profiles'] });
        }}
      />

      {/* Edit modal */}
      <ProfileFormModal
        key={editing?.id ?? 'edit'}
        opened={!!editing}
        profile={editing}
        tool={tool}
        type={type}
        project={project}
        onClose={() => setEditing(null)}
        onSuccess={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ['env-profiles'] });
        }}
      />

      {/* Capture modal */}
      <CaptureModal
        opened={captureOpen}
        onClose={closeCapture}
        tool={tool}
        type={type}
        project={project}
        onSuccess={() => {
          closeCapture();
          queryClient.invalidateQueries({ queryKey: ['env-profiles'] });
        }}
      />
    </Stack>
  );
}

function ProfileFormModal({
  opened,
  profile,
  tool,
  type,
  project,
  onClose,
  onSuccess,
}: {
  opened: boolean;
  profile?: EnvProfile | null;
  tool: string;
  type: string;
  project: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!profile;
  const t = useT();
  const [name, setName] = useState(profile?.name ?? '');
  const [environment, setEnvironment] = useState(profile?.environment ?? 'dev');
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(
    profile
      ? Object.entries(profile.entries).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }],
  );

  // Reset form state when profile prop changes (edit bug fix)
  useEffect(() => {
    setName(profile?.name ?? '');
    setEnvironment(profile?.environment ?? 'dev');
    setRows(
      profile
        ? Object.entries(profile.entries).map(([key, value]) => ({ key, value }))
        : [{ key: '', value: '' }],
    );
  }, [profile]);

  // Template query for pre-filling
  const template = useQuery<Record<string, string>>({
    queryKey: ['env-profiles-template', tool, type, project],
    queryFn: () =>
      api.get(`/api/env-profiles/template?tool=${tool}&type=${type}&project=${project}`),
    enabled: !!tool && !!type && !!project && opened && !isEdit,
  });

  function loadFromTemplate() {
    if (!template.data) return;
    const templateRows = Object.entries(template.data).map(([key, value]) => ({ key, value }));
    if (templateRows.length === 0) {
      toast.info(t('envProfiles.templateEmpty'));
      return;
    }
    setRows(templateRows);
    toast.success(`${templateRows.length} ${t('envProfiles.keysFromTemplate')}`);
  }

  function addRow() {
    setRows((prev) => [...prev, { key: '', value: '' }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: 'key' | 'value', val: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: val } : r)));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const entries: Record<string, string> = {};
      for (const row of rows) {
        if (row.key.trim()) entries[row.key.trim()] = row.value;
      }
      const body = { name, environment, tool, type, project, entries };
      return isEdit
        ? api.put(`/api/env-profiles/${profile.id}`, body)
        : api.post('/api/env-profiles', body);
    },
    onSuccess: () => {
      toast.success(isEdit ? t('envProfiles.profileUpdated') : t('envProfiles.profileCreated'));
      onSuccess();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <FormModal
      opened={opened}
      onClose={onClose}
      title={isEdit ? t('envProfiles.editProfileTitle') : t('envProfiles.newProfile')}
      size="lg"
      submitLabel={isEdit ? t('common.save') : t('common.create')}
      onSubmit={() => mutation.mutate()}
      submitDisabled={!name}
      loading={mutation.isPending}
    >
      <TextInput
        label={t('webhook.name')}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="Production API keys"
      />
      <Select
        label={t('envProfiles.environment')}
        value={environment}
        onChange={(v) => v && setEnvironment(v)}
        data={ENV_OPTIONS}
        allowDeselect={false}
      />

      <Stack gap={4}>
        <Group justify="space-between" align="center">
          <Text size="sm" fw={500}>
            {t('envProfiles.entries')}
          </Text>
          {!isEdit && (
            <Button
              size="xs"
              variant="subtle"
              leftSection={<TbDownload size={12} />}
              onClick={loadFromTemplate}
              loading={template.isLoading}
              disabled={!template.data || Object.keys(template.data).length === 0}
            >
              {t('envProfiles.loadFromTemplate')}
            </Button>
          )}
        </Group>
        {rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dynamic form rows without stable IDs
          <Group key={i} gap="xs" wrap="nowrap">
            <TextInput
              size="xs"
              placeholder="KEY"
              value={row.key}
              onChange={(e) => updateRow(i, 'key', e.currentTarget.value)}
              style={{ flex: 1 }}
              styles={{ input: { fontFamily: 'monospace' } }}
            />
            <TextInput
              size="xs"
              placeholder="value"
              value={row.value}
              onChange={(e) => updateRow(i, 'value', e.currentTarget.value)}
              style={{ flex: 2 }}
              styles={{ input: { fontFamily: 'monospace' } }}
            />
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              onClick={() => removeRow(i)}
              disabled={rows.length <= 1}
              aria-label={t('envProfiles.removeRow')}
            >
              <TbTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Button size="xs" variant="light" onClick={addRow} leftSection={<TbPlus size={12} />}>
          {t('env.addEntry')}
        </Button>
      </Stack>
    </FormModal>
  );
}

function CaptureModal({
  opened,
  onClose,
  tool,
  type,
  project,
  onSuccess,
}: {
  opened: boolean;
  onClose: () => void;
  tool: string;
  type: string;
  project: string;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState('dev');
  const t = useT();

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/api/env-profiles/capture', { tool, type, project, name, environment }),
    onSuccess: () => {
      toast.success(t('envProfiles.captured'));
      setName('');
      onSuccess();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <FormModal
      opened={opened}
      onClose={onClose}
      title={t('envProfiles.captureTitle')}
      size="sm"
      submitLabel={t('envProfiles.capture')}
      onSubmit={() => mutation.mutate()}
      submitDisabled={!name}
      loading={mutation.isPending}
    >
      <TextInput
        label={t('envProfiles.profileName')}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="Current dev snapshot"
      />
      <Select
        label={t('envProfiles.environment')}
        value={environment}
        onChange={(v) => v && setEnvironment(v)}
        data={ENV_OPTIONS}
        allowDeselect={false}
      />
    </FormModal>
  );
}
