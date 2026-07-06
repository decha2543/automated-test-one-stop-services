import type { DoctorCheck, DoctorReport, ProvisionResult } from '@hub/shared';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoctorPanel } from '../DoctorPanel';

/**
 * Unit tests for DoctorPanel rendering (one-stop-service-upgrade, task 2.10;
 * provision button + no-mirror guidance follow-up).
 *
 * Covers acceptance criteria:
 *   R3.1  loading / not-ready -> "Checking environment..." indicator, no groups
 *   R3.4  ok=false check renders a fail icon (TbCircleX / TbAlertTriangle)
 *   R3.5  failing check WITH a hint renders the hint text
 *   R3.7  ok check WITH a version renders the version text
 *   R3.10 clicking the header toggles expand/collapse (when not auto-expanded)
 *   Provision: failing tool check renders a Provision button that triggers the
 *   mutation; pending shows a spinner; failure surfaces the in-band message; the
 *   "How to fix" block shows no-mirror-first guidance (env-key names only).
 */

// Control the provision mutation without any network access. Tests mutate
// `provisionReturn` before rendering to exercise idle / pending / failed states.
const provisionMutate = vi.fn();
let provisionReturn: {
  mutate: typeof provisionMutate;
  isPending: boolean;
  variables: string | undefined;
  data: ProvisionResult | undefined;
};

vi.mock('~/hooks/useTools.js', () => ({
  useProvisionTool: () => provisionReturn,
}));

// react-icons render anonymous <svg> elements with no accessible name, which
// makes "which icon rendered" impossible to assert directly. Mock the Tabler
// icon set the component imports so each icon is tagged with a data-testid.
vi.mock('react-icons/tb', () => {
  const makeIcon = (name: string) => () => <svg data-testid={name} aria-hidden="true" />;
  return {
    TbAlertTriangle: makeIcon('TbAlertTriangle'),
    TbChevronRight: makeIcon('TbChevronRight'),
    TbCircleCheck: makeIcon('TbCircleCheck'),
    TbCircleX: makeIcon('TbCircleX'),
    TbRefresh: makeIcon('TbRefresh'),
  };
});

// jsdom does not implement matchMedia. Provide a stub that reports
// prefers-reduced-motion: reduce so that, combined with a theme that respects
// reduced motion, Mantine's <Collapse> uses transitionDuration=0 and becomes a
// synchronous conditional mount/unmount (jsdom never fires `transitionend`).
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

beforeEach(() => {
  provisionMutate.mockReset();
  provisionReturn = {
    mutate: provisionMutate,
    isPending: false,
    variables: undefined,
    data: undefined,
  };
});

function renderPanel(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={{ respectReducedMotion: true }}>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
}

function check(partial: Partial<DoctorCheck> & Pick<DoctorCheck, 'name'>): DoctorCheck {
  return {
    ok: true,
    category: 'required-install',
    ...partial,
  };
}

function report(checks: DoctorCheck[]): DoctorReport {
  return {
    checks,
    overallOk: checks.every((c) => c.ok),
    credentialsOk: true,
  };
}

/** Report with failing checks -> auto-expanded, header click disabled. */
const reportWithIssues = report([
  check({ name: 'hub/server', ok: true, version: 'v20.0.0-installed' }),
  check({ name: 'tools/playwright', ok: false, hint: 'Run: pnpm install' }),
  check({
    name: 'playwright-browsers',
    ok: false,
    hint: 'Run: npx playwright install',
    category: 'optional-install',
  }),
  check({ name: 'docker-daemon', ok: true, version: 'running', category: 'optional-process' }),
]);

/** All required/optional-install checks pass -> collapsed by default. */
const reportAllOk = report([
  check({ name: 'hub/server', ok: true, version: 'srv-1.0.0' }),
  check({ name: 'hub/client', ok: true, version: 'cli-1.0.0' }),
  check({ name: 'docker', ok: true, version: 'running', category: 'optional-process' }),
]);

/** Locate the status icon belonging to a specific check card by its name. */
function iconForCheck(name: string): HTMLElement {
  const nameEl = screen.getByText(name);
  // CheckCard renders <Group>[icon, <Text>{name}</Text>]</Group>; the icon is
  // the only sibling of the name within that group.
  const group = nameEl.parentElement;
  if (!group) throw new Error(`no parent group for check "${name}"`);
  return within(group).getByTestId(/^Tb/);
}

describe('DoctorPanel rendering', () => {
  it('shows the checking-environment indicator and no groups while loading (R3.1)', () => {
    renderPanel(<DoctorPanel doctor={undefined} isLoading />);

    expect(screen.getByText(/Checking environment/i)).toBeInTheDocument();
    // No category headers / no check cards are rendered.
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
    expect(screen.queryByText('Optional — Install')).not.toBeInTheDocument();
    expect(screen.queryByText('Environment Status')).not.toBeInTheDocument();
  });

  it('shows the checking-environment indicator when the report is not ready (R3.1)', () => {
    renderPanel(<DoctorPanel doctor={undefined} isLoading={false} />);

    expect(screen.getByText(/Checking environment/i)).toBeInTheDocument();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });

  it('renders a fail icon for ok=false checks and a check icon for ok=true checks (R3.4)', () => {
    renderPanel(<DoctorPanel doctor={reportWithIssues} isLoading={false} />);

    // required-install failure -> TbCircleX
    expect(iconForCheck('tools/playwright')).toHaveAttribute('data-testid', 'TbCircleX');
    // optional-install failure -> TbAlertTriangle
    expect(iconForCheck('playwright-browsers')).toHaveAttribute('data-testid', 'TbAlertTriangle');
    // passing check -> TbCircleCheck (not a fail icon)
    expect(iconForCheck('hub/server')).toHaveAttribute('data-testid', 'TbCircleCheck');
  });

  it('renders the hint text for a failing check that has a hint (R3.5)', () => {
    renderPanel(<DoctorPanel doctor={reportWithIssues} isLoading={false} />);

    expect(screen.getByText('Run: pnpm install')).toBeInTheDocument();
    expect(screen.getByText('Run: npx playwright install')).toBeInTheDocument();
  });

  it('renders the version text for an ok check that has a version (R3.7)', () => {
    renderPanel(<DoctorPanel doctor={reportWithIssues} isLoading={false} />);

    expect(screen.getByText('v20.0.0-installed')).toBeInTheDocument();
    // The failing check has no version, so nothing version-like is shown for it.
    const failGroup = screen.getByText('tools/playwright').parentElement as HTMLElement;
    const failCard = failGroup.parentElement as HTMLElement;
    expect(within(failCard).queryByText('v20.0.0-installed')).not.toBeInTheDocument();
  });

  it('toggles expand/collapse when the header is clicked (R3.10)', async () => {
    const user = userEvent.setup();
    renderPanel(<DoctorPanel doctor={reportAllOk} isLoading={false} />);

    // Collapsed by default: card contents (versions, group headers) are hidden,
    // but the always-visible header summary badge is present.
    expect(screen.getByText('2/2 OK')).toBeInTheDocument();
    expect(screen.queryByText('srv-1.0.0')).not.toBeInTheDocument();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();

    // Click header -> expand.
    await user.click(screen.getByText('Environment Status'));
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('srv-1.0.0')).toBeInTheDocument();
    expect(screen.getByText('cli-1.0.0')).toBeInTheDocument();

    // Click header again -> collapse.
    await user.click(screen.getByText('Environment Status'));
    expect(screen.queryByText('srv-1.0.0')).not.toBeInTheDocument();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });
});

/** A report whose only failing check is the provisionable playwright-browsers. */
const reportBrowsersMissing = report([
  check({ name: 'node', ok: true, version: 'v25.0.0' }),
  check({
    name: 'playwright-browsers',
    ok: false,
    hint: 'Run: pnpm exec playwright install',
    category: 'required-install',
  }),
]);

describe('DoctorPanel provisioning + guidance', () => {
  it('renders a Provision button on the failing tool check and triggers the mutation', async () => {
    const user = userEvent.setup();
    renderPanel(<DoctorPanel doctor={reportBrowsersMissing} isLoading={false} />);

    const provisionBtn = screen.getByRole('button', { name: /provision/i });
    expect(provisionBtn).toBeInTheDocument();

    await user.click(provisionBtn);
    expect(provisionMutate).toHaveBeenCalledWith('playwright');
  });

  it('does not render a Provision button for passing or non-tool checks', () => {
    // node (passing, required) and a generic failing check have no provision target.
    const generic = report([
      check({ name: 'node', ok: true, version: 'v25.0.0' }),
      check({ name: 'git', ok: false, hint: 'Install git', category: 'required-install' }),
    ]);
    renderPanel(<DoctorPanel doctor={generic} isLoading={false} />);

    expect(screen.queryByRole('button', { name: /provision/i })).not.toBeInTheDocument();
  });

  it('shows a spinner on the active card while provisioning', () => {
    provisionReturn = {
      mutate: provisionMutate,
      isPending: true,
      variables: 'playwright',
      data: undefined,
    };
    renderPanel(<DoctorPanel doctor={reportBrowsersMissing} isLoading={false} />);

    const provisionBtn = screen.getByRole('button', { name: /provision/i });
    expect(provisionBtn).toHaveAttribute('data-loading', 'true');
  });

  it('surfaces the in-band provisioning failure message', () => {
    provisionReturn = {
      mutate: provisionMutate,
      isPending: false,
      variables: 'playwright',
      data: {
        ok: false,
        postInstallError: { code: 'POST_INSTALL_FAILED', message: 'browser download failed' },
      },
    };
    renderPanel(<DoctorPanel doctor={reportBrowsersMissing} isLoading={false} />);

    expect(screen.getByText('browser download failed')).toBeInTheDocument();
  });

  it('reveals no-mirror-first guidance referencing env-key names only', async () => {
    const user = userEvent.setup();
    renderPanel(<DoctorPanel doctor={reportBrowsersMissing} isLoading={false} />);

    // Guidance is collapsed until "How to fix" is clicked.
    expect(document.body.textContent).not.toContain('PLAYWRIGHT_BROWSERS_PATH');

    await user.click(screen.getByRole('button', { name: /how to fix/i }));

    const body = document.body.textContent ?? '';
    // Ordered for a no-mirror reality: retry -> manual archive -> proxy -> optional mirror.
    expect(body).toContain('PLAYWRIGHT_BROWSERS_PATH');
    expect(body).toContain('HTTPS_PROXY');
    expect(body).toContain('NODE_EXTRA_CA_CERTS');
    // The mirror is presented as conditional ("if your org ever provides one"),
    // never as an existing resource, and only as the LAST step.
    expect(body).toContain('PLAYWRIGHT_DOWNLOAD_HOST');
    expect(body).toMatch(/if your organisation ever provides/i);
    // No CDN URL is hardcoded into the guidance.
    expect(body).not.toMatch(/https?:\/\//);
  });
});
