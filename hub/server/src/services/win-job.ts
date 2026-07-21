/**
 * Windows Job Object helper — reliably reap a run's ENTIRE process tree,
 * including workers that Git Bash / MSYS reparent away from the tracked
 * `bash -c` pid (task → node → browser). `taskkill /T` walks the live
 * parent-child tree and therefore misses those orphaned descendants; a Job
 * Object does not — every process spawned under the job is terminated by
 * `TerminateJobObject` (and by `KILL_ON_JOB_CLOSE` when the last handle
 * closes), regardless of reparenting.
 *
 * Implemented via koffi (prebuilt FFI, no native build step). The whole module
 * is BEST-EFFORT and fails soft: on any platform other than Windows, or if
 * koffi / the Win32 calls are unavailable, `createKillJob()` returns `null` and
 * the caller falls back to `taskkill` + the runner's finalize-on-timeout guard.
 */

import { createRequire } from 'node:module';

const JobObjectExtendedLimitInformation = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;

/** A per-run job object. `assign` enrolls the spawned process (its future
 *  descendants inherit the job); `terminate` kills the whole job; `release`
 *  just closes our handle (KILL_ON_JOB_CLOSE reaps any stragglers). */
export interface KillJob {
  assign(pid: number): boolean;
  terminate(): void;
  release(): void;
}

interface Win32 {
  createJob(): unknown;
  setKillOnClose(job: unknown): boolean;
  openProcess(pid: number): unknown;
  assign(job: unknown, proc: unknown): boolean;
  terminate(job: unknown): boolean;
  close(handle: unknown): boolean;
}

/**
 * Lazily bind the kernel32 Job Object APIs once. Returns `null` off-Windows or
 * if koffi / the bindings cannot be set up (kept non-fatal on purpose).
 */
let win32Cache: Win32 | null | undefined;
function getWin32(): Win32 | null {
  if (win32Cache !== undefined) return win32Cache;
  if (process.platform !== 'win32') {
    win32Cache = null;
    return null;
  }
  try {
    // Loaded dynamically so a missing/broken FFI never crashes module import.
    // koffi is CJS; require it through createRequire to stay ESM-safe.
    const require = createRequire(import.meta.url);
    const koffi = require('koffi') as typeof import('koffi');

    koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
      PerProcessUserTimeLimit: 'int64',
      PerJobUserTimeLimit: 'int64',
      LimitFlags: 'uint32',
      MinimumWorkingSetSize: 'size_t',
      MaximumWorkingSetSize: 'size_t',
      ActiveProcessLimit: 'uint32',
      Affinity: 'size_t',
      PriorityClass: 'uint32',
      SchedulingClass: 'uint32',
    });
    koffi.struct('IO_COUNTERS', {
      ReadOperationCount: 'uint64',
      WriteOperationCount: 'uint64',
      OtherOperationCount: 'uint64',
      ReadTransferCount: 'uint64',
      WriteTransferCount: 'uint64',
      OtherTransferCount: 'uint64',
    });
    koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
      BasicLimitInformation: 'JOBOBJECT_BASIC_LIMIT_INFORMATION',
      IoInfo: 'IO_COUNTERS',
      ProcessMemoryLimit: 'size_t',
      JobMemoryLimit: 'size_t',
      PeakProcessMemoryUsed: 'size_t',
      PeakJobMemoryUsed: 'size_t',
    });

    const k32 = koffi.load('kernel32.dll');
    const CreateJobObjectW = k32.func('void* CreateJobObjectW(void*, void*)');
    const SetInformationJobObject = k32.func(
      'bool SetInformationJobObject(void*, int, JOBOBJECT_EXTENDED_LIMIT_INFORMATION*, uint32)',
    );
    const OpenProcess = k32.func('void* OpenProcess(uint32, bool, uint32)');
    const AssignProcessToJobObject = k32.func('bool AssignProcessToJobObject(void*, void*)');
    const TerminateJobObject = k32.func('bool TerminateJobObject(void*, uint32)');
    const CloseHandle = k32.func('bool CloseHandle(void*)');
    const infoSize = koffi.sizeof('JOBOBJECT_EXTENDED_LIMIT_INFORMATION');

    win32Cache = {
      createJob: () => CreateJobObjectW(null, null),
      setKillOnClose: (job) =>
        SetInformationJobObject(
          job,
          JobObjectExtendedLimitInformation,
          { BasicLimitInformation: { LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE }, IoInfo: {} },
          infoSize,
        ) === true,
      openProcess: (pid) => OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid),
      assign: (job, proc) => AssignProcessToJobObject(job, proc) === true,
      terminate: (job) => TerminateJobObject(job, 1) === true,
      close: (handle) => CloseHandle(handle) === true,
    };
  } catch {
    win32Cache = null;
  }
  return win32Cache;
}

/**
 * Create a kill-on-close Job Object for one run. Returns `null` (caller falls
 * back to taskkill) off-Windows or if the job cannot be created/configured.
 */
export function createKillJob(): KillJob | null {
  const w = getWin32();
  if (!w) return null;

  const job = w.createJob();
  if (!job || !w.setKillOnClose(job)) {
    if (job) w.close(job);
    return null;
  }

  let closed = false;
  return {
    assign(pid: number): boolean {
      const proc = w.openProcess(pid);
      if (!proc) return false;
      const ok = w.assign(job, proc);
      w.close(proc); // the job holds its own reference; our process handle is done
      return ok;
    },
    terminate(): void {
      if (closed) return;
      closed = true;
      try {
        w.terminate(job);
      } finally {
        w.close(job);
      }
    },
    release(): void {
      if (closed) return;
      closed = true;
      w.close(job); // KILL_ON_JOB_CLOSE reaps any lingering strays
    },
  };
}
