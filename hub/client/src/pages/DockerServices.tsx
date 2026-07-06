import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TbBrandDocker,
  TbDeviceMobile,
  TbDownload,
  TbPlayerPlay,
  TbPlayerStop,
  TbRefresh,
  TbServer,
} from 'react-icons/tb';
import { api } from '~/api/client';
import { PageHeader } from '~/components/PageHeader.js';
import { toast } from '~/components/Toast';
import { useT } from '~/i18n/index.js';

interface DockerStatus {
  dockerRunning: boolean;
  services: Record<string, string>;
}

interface AppiumStatus {
  running: boolean;
  pid: number | null;
  port: number;
  installed: boolean;
}

const SERVICE_INFO: Record<string, { label: string; port: number; description: string }> = {
  influxdb: { label: 'InfluxDB', port: 8086, description: 'Time-series metrics database' },
  grafana: { label: 'Grafana', port: 3000, description: 'Metrics dashboard' },
};

export function DockerServicesPage() {
  const t = useT();
  const queryClient = useQueryClient();

  const status = useQuery<DockerStatus>({
    queryKey: ['docker-status'],
    queryFn: () => api.get('/api/docker/status'),
    refetchInterval: 5000,
  });

  const dockerRunning = status.data?.dockerRunning ?? false;

  const startDesktop = useMutation({
    mutationFn: () => api.post('/api/docker/start-desktop'),
    onSuccess: () => {
      toast.success(t('docker.desktopStarting'));
      queryClient.invalidateQueries({ queryKey: ['docker-status'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const startService = useMutation({
    mutationFn: (name: string) => api.post('/api/docker/service/start', { service: name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctor'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-nav'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const stopService = useMutation({
    mutationFn: (name: string) => api.post('/api/docker/service/stop', { service: name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctor'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-nav'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const restartService = useMutation({
    mutationFn: (name: string) => api.post('/api/docker/service/restart', { service: name }),
    onSuccess: () => {
      toast.success(t('docker.serviceRestarting'));
      queryClient.invalidateQueries({ queryKey: ['docker-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctor'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-nav'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const startAll = useMutation({
    mutationFn: () => api.post('/api/docker/start-all'),
    onSuccess: () => {
      toast.success(t('docker.startingAll'));
      queryClient.invalidateQueries({ queryKey: ['docker-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctor'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-nav'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const stopAll = useMutation({
    mutationFn: () => api.post('/api/docker/stop-all'),
    onSuccess: () => {
      toast.success(t('docker.stoppingAll'));
      queryClient.invalidateQueries({ queryKey: ['docker-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctor'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-nav'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const appium = useQuery<AppiumStatus>({
    queryKey: ['appium-status'],
    queryFn: () => api.get('/api/appium/status'),
    refetchInterval: 5000,
  });
  const appiumStart = useMutation({
    mutationFn: () => api.post('/api/appium/start'),
    onSuccess: () => {
      toast.success('Appium starting');
      queryClient.invalidateQueries({ queryKey: ['appium-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-nav'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const appiumStop = useMutation({
    mutationFn: () => api.post('/api/appium/stop'),
    onSuccess: () => {
      toast.success('Appium stopped');
      queryClient.invalidateQueries({ queryKey: ['appium-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-nav'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const appiumInstall = useMutation({
    mutationFn: () => api.post('/api/appium/install'),
    onSuccess: () => {
      toast.success('Appium installed');
      queryClient.invalidateQueries({ queryKey: ['appium-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-nav'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function getServiceStatus(name: string): 'running' | 'stopped' {
    const svcStatus = status.data?.services?.[name];
    return svcStatus === 'running' ? 'running' : 'stopped';
  }

  return (
    <Stack gap="md">
      <PageHeader title={t('docker.title')} description={t('nav.docker.desc')} />

      {status.isLoading && (
        <Paper p="xl" withBorder ta="center">
          <Stack align="center" gap="sm">
            <Loader size="md" />
            <Text c="dimmed" size="sm">
              Checking Docker status...
            </Text>
          </Stack>
        </Paper>
      )}

      {!status.isLoading && (
        <>
          {/* Docker Desktop status */}
          <Card withBorder p="md">
            <Group justify="space-between">
              <Group gap="md">
                <TbBrandDocker size={24} />
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    Docker Desktop
                  </Text>
                  <Badge size="sm" variant="light" color={dockerRunning ? 'green' : 'red'}>
                    {dockerRunning ? 'Running' : 'Stopped'}
                  </Badge>
                </Stack>
              </Group>
              {!dockerRunning && (
                <Button
                  size="xs"
                  leftSection={<TbPlayerPlay size={14} />}
                  onClick={() => startDesktop.mutate()}
                  loading={startDesktop.isPending}
                >
                  Start Docker Desktop
                </Button>
              )}
            </Group>
          </Card>

          {/* Bulk actions */}
          <Group gap="xs">
            <Button
              size="xs"
              variant="light"
              color="green"
              leftSection={<TbPlayerPlay size={14} />}
              onClick={() => startAll.mutate()}
              loading={startAll.isPending}
              disabled={!dockerRunning}
            >
              Start All
            </Button>
            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={<TbPlayerStop size={14} />}
              onClick={() => stopAll.mutate()}
              loading={stopAll.isPending}
              disabled={!dockerRunning}
            >
              Stop All
            </Button>
          </Group>

          {/* Service cards */}
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
            {Object.entries(SERVICE_INFO).map(([name, info]) => {
              const svcStatus = getServiceStatus(name);
              const isRunning = svcStatus === 'running';

              return (
                <Card key={name} withBorder p="md">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <TbServer size={16} />
                        <Text size="sm" fw={500}>
                          {info.label}
                        </Text>
                      </Group>
                      <Badge size="sm" variant="light" color={isRunning ? 'green' : 'red'}>
                        {svcStatus}
                      </Badge>
                    </Group>

                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">
                        {info.description}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace">
                        :{info.port}
                      </Text>
                    </Stack>

                    <Group gap="xs">
                      {!isRunning && (
                        <Tooltip label={t('docker.startService')}>
                          <Button
                            size="xs"
                            variant="light"
                            color="green"
                            leftSection={<TbPlayerPlay size={12} />}
                            onClick={() => startService.mutate(name)}
                            disabled={!dockerRunning}
                            loading={startService.isPending}
                          >
                            Start
                          </Button>
                        </Tooltip>
                      )}
                      {isRunning && (
                        <Tooltip label={t('docker.stopService')}>
                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            leftSection={<TbPlayerStop size={12} />}
                            onClick={() => stopService.mutate(name)}
                            disabled={!dockerRunning}
                            loading={stopService.isPending}
                          >
                            Stop
                          </Button>
                        </Tooltip>
                      )}
                      <Tooltip label={t('docker.restartService')}>
                        <Button
                          size="xs"
                          variant="light"
                          color="blue"
                          leftSection={<TbRefresh size={12} />}
                          onClick={() => restartService.mutate(name)}
                          disabled={!dockerRunning || !isRunning}
                          loading={restartService.isPending}
                        >
                          Restart
                        </Button>
                      </Tooltip>
                    </Group>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        </>
      )}

      {/* Local services — host processes (not Docker). Appium runs on the host
          for mobile testing (host emulator + host appium); Docker can't run an
          Android emulator on Windows. */}
      <div>
        <Text size="sm" fw={700} c="dimmed" tt="uppercase" mb="xs">
          Local services
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
          <Card withBorder p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Group gap="xs">
                  <TbDeviceMobile size={16} />
                  <Text size="sm" fw={500}>
                    Appium (local)
                  </Text>
                </Group>
                <Badge size="sm" variant="light" color={appium.data?.running ? 'green' : 'red'}>
                  {appium.data?.running ? 'running' : 'stopped'}
                </Badge>
              </Group>

              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  Host Appium server for mobile testing
                </Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  :{appium.data?.port ?? 4723}
                </Text>
              </Stack>

              {appium.data && !appium.data.installed ? (
                <Tooltip label="Install Appium + uiautomator2 driver on this machine">
                  <Button
                    size="xs"
                    variant="light"
                    color="grape"
                    leftSection={<TbDownload size={12} />}
                    onClick={() => appiumInstall.mutate()}
                    loading={appiumInstall.isPending}
                  >
                    Install
                  </Button>
                </Tooltip>
              ) : (
                <Group gap="xs">
                  {!appium.data?.running && (
                    <Button
                      size="xs"
                      variant="light"
                      color="green"
                      leftSection={<TbPlayerPlay size={12} />}
                      onClick={() => appiumStart.mutate()}
                      loading={appiumStart.isPending}
                    >
                      Start
                    </Button>
                  )}
                  {appium.data?.running && (
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<TbPlayerStop size={12} />}
                      onClick={() => appiumStop.mutate()}
                      loading={appiumStop.isPending}
                    >
                      Stop
                    </Button>
                  )}
                </Group>
              )}
            </Stack>
          </Card>
        </SimpleGrid>
      </div>
    </Stack>
  );
}
