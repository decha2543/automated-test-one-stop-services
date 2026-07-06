import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ScheduleForm } from '../ScheduleForm.js';
import { fromConfigSilent } from '../schedule-silent.js';

/**
 * Unit test for Task 5.8 — ScheduleForm default silent state.
 *
 * Validates Requirement 8.1: when the create form opens for a NEW schedule the
 * "Silent mode" checkbox defaults to OFF (silent = false).
 *
 * This pairs with the pure-helper property test (Property 14) and the
 * server-side scheduler/runner tests in
 * hub/server/src/services/scheduler-runner-cancel.test.ts.
 *
 * The project-query hooks are mocked so the component renders without any
 * network access; only the create-form default state is exercised here.
 */

vi.mock('~/hooks/useProjectQueries.js', () => {
  const empty = { data: [], isLoading: false } as const;
  return {
    useProjectTypes: () => empty,
    useProjectList: () => empty,
    useProjectSections: () => empty,
    useProjectTags: () => empty,
    useAllProjects: () => empty,
  };
});

// jsdom lacks matchMedia (Mantine Modal/transitions) and ResizeObserver
// (Mantine ScrollArea). Provide minimal stubs so the modal renders.
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
  if (!('ResizeObserver' in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function renderForm(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={{ respectReducedMotion: true }}>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
}

describe('ScheduleForm default silent state (R8.1)', () => {
  it('renders the create form with the Silent mode checkbox unchecked by default', () => {
    renderForm(<ScheduleForm mode="create" opened onClose={() => {}} onSuccess={() => {}} />);

    const silent = screen.getByRole('checkbox', { name: /silent mode/i });
    // R8.1: a brand-new schedule defaults silent = false (checkbox OFF).
    expect(silent).not.toBeChecked();
  });

  it('keeps the pure default mapping consistent with the checkbox (R8.1)', () => {
    // The component seeds `silent` from `defaults.silent = false`; the same
    // value round-trips through the shared helper the form uses on edit.
    expect(fromConfigSilent({ silent: undefined })).toBe(false);
    expect(fromConfigSilent({ silent: false })).toBe(false);
  });
});
