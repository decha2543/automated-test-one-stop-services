import { type ChildProcess, execFile } from 'node:child_process';

/**
 * Registry of currently-spawned `playwright show-trace` viewer processes.
 * Lives in its own module so the graceful-shutdown handler in `index.ts`
 * can reach in and terminate everything without depending on
 * `routes/reports.ts`.
 */
export interface TraceProcess {
  pid: number;
  process: ChildProcess;
}

const processes = new Map<string, TraceProcess>();

export function getTraceProcess(tracePath: string): TraceProcess | undefined {
  return processes.get(tracePath);
}

export function registerTraceProcess(tracePath: string, entry: TraceProcess): void {
  processes.set(tracePath, entry);
}

export function unregisterTraceProcess(tracePath: string): void {
  processes.delete(tracePath);
}

/** Best-effort kill of a single trace viewer. Resolves regardless of result. */
export async function killTraceProcess(entry: TraceProcess): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/pid', String(entry.pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve(),
      );
    });
    return;
  }
  try {
    process.kill(entry.pid);
  } catch {
    /* already gone */
  }
}

/** Tear down every registered trace viewer. Used by graceful shutdown. */
export async function killAllTraceProcesses(): Promise<void> {
  const all = Array.from(processes.entries());
  processes.clear();
  await Promise.all(all.map(([, entry]) => killTraceProcess(entry)));
}
