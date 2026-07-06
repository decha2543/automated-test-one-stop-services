import type { DoctorCategory, DoctorCheck, DoctorReport } from '@hub/shared';
import {
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useState } from 'react';
import {
  TbAlertTriangle,
  TbChevronRight,
  TbCircleCheck,
  TbCircleX,
  TbRefresh,
} from 'react-icons/tb';
import { useProvisionTool } from '~/hooks/useTools.js';
import {
  groupByCategory,
  provisionGuidance,
  provisionTargetFor,
  shouldAutoExpand,
  shouldShowGroup,
  summaryBadge,
} from './doctor-panel-helpers';

interface DoctorPanelProps {
  doctor: DoctorReport | undefined;
  isLoading: boolean;
}

/**
 * Per-tool provisioning UI state, threaded from {@link DoctorPanel} down to each
 * {@link CheckCard}. Derived from the single `useProvisionTool` mutation so only
 * the card whose tool is being provisioned shows a spinner.
 */
interface ProvisionState {
  /** Trigger a (re-)provision for the given tool id. */
  onProvision: (toolId: string) => void;
  /** Tool id currently being provisioned (spinner target), if any. */
  pendingId: string | undefined;
  /** Tool id whose last provision attempt failed in-band, if any. */
  failedId: string | undefined;
  /** Message from the last failed provision attempt, if any. */
  failedMessage: string | undefined;
}

interface CategoryConfig {
  key: DoctorCategory;
  title: string;
  okBorder: string;
  failBorder: string;
  okBg: string;
  failBg: string;
  failIcon: 'x' | 'warn';
}

const CATEGORIES: CategoryConfig[] = [
  {
    key: 'required-install',
    title: 'Required',
    okBorder: 'var(--mantine-color-green-7)',
    failBorder: 'var(--mantine-color-red-7)',
    okBg: 'var(--mantine-color-green-light)',
    failBg: 'var(--mantine-color-red-light)',
    failIcon: 'x',
  },
  {
    key: 'optional-install',
    title: 'Optional — Install',
    okBorder: 'var(--mantine-color-green-7)',
    failBorder: 'var(--mantine-color-yellow-7)',
    okBg: 'var(--mantine-color-green-light)',
    failBg: 'var(--mantine-color-yellow-light)',
    failIcon: 'warn',
  },
  {
    key: 'optional-process',
    title: 'Optional — Services',
    okBorder: 'var(--mantine-color-green-7)',
    failBorder: 'var(--mantine-color-gray-5)',
    okBg: 'var(--mantine-color-green-light)',
    failBg: 'var(--mantine-color-dark-6)',
    failIcon: 'x',
  },
];

/**
 * Environment status panel.
 *
 * When all required and optional-install checks pass, the panel collapses to
 * a single green badge to keep the dashboard clean. The user can expand to
 * inspect details. When any check fails the panel auto-expands so the user
 * cannot miss the problem.
 */
export function DoctorPanel({ doctor, isLoading }: DoctorPanelProps) {
  const hasIssues = !!doctor && shouldAutoExpand(doctor);
  const [expanded, setExpanded] = useState(false);
  const isExpanded = hasIssues || expanded;

  const provision = useProvisionTool();
  // Derive per-tool provisioning UI state from the single in-flight mutation:
  // `pendingId` drives the spinner on the active card; `failedMessage` surfaces
  // the in-band `postInstallError` from the last failed Provision attempt.
  const provisionState: ProvisionState = {
    onProvision: (toolId) => provision.mutate(toolId),
    pendingId: provision.isPending ? provision.variables : undefined,
    failedId: provision.data && !provision.data.ok ? provision.variables : undefined,
    failedMessage: provision.data?.postInstallError?.message,
  };

  if (isLoading || !doctor) {
    return (
      <Paper p="md" withBorder>
        <Group gap="xs">
          {isLoading && <Loader size="xs" />}
          <Text c="dimmed" size="sm">
            Checking environment...
          </Text>
        </Group>
      </Paper>
    );
  }

  const badge = summaryBadge(doctor.checks);
  const groups = groupByCategory(doctor.checks);

  return (
    <Paper p="md" withBorder>
      <Group
        justify="space-between"
        wrap="nowrap"
        style={{ cursor: hasIssues ? 'default' : 'pointer' }}
        onClick={() => {
          if (!hasIssues) setExpanded((v) => !v);
        }}
      >
        <Group gap="sm" wrap="nowrap">
          {!hasIssues && (
            <TbChevronRight
              size={14}
              style={{
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 200ms',
              }}
            />
          )}
          <Text fw={600} size="sm">
            Environment Status
          </Text>
          {badge.ok ? (
            <Badge
              color="green"
              variant="light"
              size="sm"
              leftSection={<TbCircleCheck size={12} />}
            >
              {badge.text}
            </Badge>
          ) : (
            <Badge color="red" variant="filled" size="sm" leftSection={<TbCircleX size={12} />}>
              {badge.text}
            </Badge>
          )}
        </Group>
      </Group>

      <Collapse expanded={isExpanded}>
        <Stack gap="md" mt="md">
          {CATEGORIES.map((cat) => {
            const checks = groups[cat.key];
            if (!shouldShowGroup(checks)) return null;
            return (
              <CategorySection key={cat.key} cat={cat} checks={checks} provision={provisionState} />
            );
          })}
        </Stack>
      </Collapse>
    </Paper>
  );
}

function CategorySection({
  cat,
  checks,
  provision,
}: {
  cat: CategoryConfig;
  checks: DoctorCheck[];
  provision: ProvisionState;
}) {
  return (
    <div>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6}>
        {cat.title}
      </Text>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xs">
        {checks.map((check) => (
          <CheckCard key={check.name} check={check} cat={cat} provision={provision} />
        ))}
      </SimpleGrid>
    </div>
  );
}

function CheckCard({
  check,
  cat,
  provision,
}: {
  check: DoctorCheck;
  cat: CategoryConfig;
  provision: ProvisionState;
}) {
  const [showFix, setShowFix] = useState(false);
  const FailIcon = cat.failIcon === 'warn' ? TbAlertTriangle : TbCircleX;
  const failColor =
    cat.failIcon === 'warn' ? 'var(--mantine-color-yellow-6)' : 'var(--mantine-color-red-6)';
  const hintColor = cat.failIcon === 'warn' ? 'yellow.8' : 'red';

  // A failing tool check (e.g. playwright-browsers, k6) can be re-provisioned by
  // re-running the tool's `setup` task. Generic checks have no provision target.
  const provisionTarget = check.ok ? undefined : provisionTargetFor(check.name);
  const isProvisioning = provisionTarget !== undefined && provision.pendingId === provisionTarget;
  const provisionFailed = provisionTarget !== undefined && provision.failedId === provisionTarget;

  return (
    <Card
      p="xs"
      withBorder
      style={{
        borderColor: check.ok ? cat.okBorder : cat.failBorder,
        background: check.ok ? cat.okBg : cat.failBg,
      }}
    >
      <Group gap={6} wrap="nowrap">
        {check.ok ? (
          <TbCircleCheck color="var(--mantine-color-green-6)" size={16} />
        ) : (
          <FailIcon color={failColor} size={16} />
        )}
        <Text size="sm" ff="monospace" truncate>
          {check.name}
        </Text>
      </Group>
      {check.ok && check.version && (
        <Text size="xs" c="dimmed" mt={4} truncate title={check.version}>
          {check.version}
        </Text>
      )}
      {!check.ok && check.hint && (
        <Text size="xs" c={hintColor} mt={4} truncate title={check.hint}>
          {check.hint}
        </Text>
      )}
      {provisionTarget && (
        <Stack gap={4} mt={6}>
          <Group gap={6} wrap="nowrap">
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<TbRefresh size={12} />}
              loading={isProvisioning}
              onClick={() => provision.onProvision(provisionTarget)}
            >
              Provision
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={() => setShowFix((v) => !v)}
            >
              How to fix
            </Button>
          </Group>
          {provisionFailed && provision.failedMessage && (
            <Text size="xs" c="red" title={provision.failedMessage} lineClamp={2}>
              {provision.failedMessage}
            </Text>
          )}
          <Collapse expanded={showFix}>
            <Stack gap={4} mt={4}>
              {provisionGuidance(provisionTarget).map((step) => (
                <Text key={step.title} size="xs" c="dimmed">
                  <Text span size="xs" fw={700}>
                    {step.title}:
                  </Text>{' '}
                  {step.detail}
                </Text>
              ))}
            </Stack>
          </Collapse>
        </Stack>
      )}
    </Card>
  );
}
