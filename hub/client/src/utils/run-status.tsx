import type { RunStatus } from '@hub/shared';
import type { ReactNode } from 'react';
import { TbCircleCheck, TbCircleX, TbClock, TbHelp } from 'react-icons/tb';

/**
 * Shared helpers for rendering run/report statuses consistently across pages.
 *
 * Avoids each page redefining its own statusColor/statusIcon helpers and keeps
 * colour/icon mapping centralised so tweaks propagate everywhere.
 */

/** Mantine colour name for a run or report status. */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'passed':
    case 'success':
      return 'green';
    case 'failed':
    case 'error':
      return 'red';
    case 'cancelled':
      return 'yellow';
    case 'running':
    case 'pending':
      return 'blue';
    default:
      return 'gray';
  }
}

/** Render a small leading icon matching the status colour. */
export function getStatusIcon(status: string, size = 14): ReactNode {
  switch (status) {
    case 'passed':
    case 'success':
      return <TbCircleCheck size={size} />;
    case 'failed':
    case 'error':
      return <TbCircleX size={size} />;
    case 'running':
    case 'pending':
      return <TbClock size={size} />;
    default:
      return <TbHelp size={size} />;
  }
}

/** Type guard for RunStatus when narrowing arbitrary strings. */
export function isRunStatus(s: string): s is RunStatus {
  return ['running', 'pending', 'passed', 'failed', 'cancelled', 'error'].includes(s);
}
