#!/usr/bin/env node
// ============================================================================
//  hub-service.mjs — cross-platform Hub process manager.
//
//  ONE place that owns "run the built Hub as a background service", used by the
//  Windows/Linux start+stop scripts, the setup bootstrap, and the in-app Update
//  button. It replaces the per-OS process-manager shell logic that used to be
//  duplicated in five places.
//
//  How it runs the Hub: a daemonless, detached `node dist/index.js` whose pid +
//  log live under hub/.run/. `unref()` lets this launcher exit while the Hub
//  keeps running — there is no background daemon of our own, so nothing can be
//  blocked by locked-down/corporate policy (a privileged local daemon reached
//  over a named pipe would be — the EPERM failure mode this design avoids). For
//  auto-restart-on-crash + start-at-boot,
//  `enable-boot` registers an OS-native user supervisor (see below); when one is
//  installed it owns the process and start/stop/restart delegate to it instead
//  of spawning a daemonless copy.
//
//  Usage:  node hub/bin/hub-service.mjs <start|stop|restart|status|enable-boot|disable-boot>
//
//  enable-boot registers the Hub to start automatically at login/boot, user-scope
//  (no admin): a logon Scheduled Task (Windows), a systemd --user unit with
//  lingering (Linux, starts at boot with no interactive login), or a launchd
//  user agent (macOS). When such a supervisor is installed it becomes the single
//  owner of start/stop/restart, so we delegate to it instead of spawning a second
//  daemonless copy.
//
//  Tunables (env, all optional):
//    HUB_HOST             bind host   (default 127.0.0.1)
//    HUB_PORT             bind port   (default 5174)
//
//  Build is NOT this script's job — the caller builds first (pnpm -C hub run
//  build). `start` refuses to run daemonless if `server/dist/index.js` is absent.
// ============================================================================

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUB_DIR = path.resolve(HERE, '..');
const SERVER_DIR = path.join(HUB_DIR, 'server');
const DIST_INDEX = path.join(SERVER_DIR, 'dist', 'index.js');
const RUN_DIR = path.join(HUB_DIR, '.run');
const PID_FILE = path.join(RUN_DIR, 'hub.pid');
const LOG_FILE = path.join(RUN_DIR, 'hub.log');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const IS_MAC = process.platform === 'darwin';
const HOST = process.env.HUB_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.HUB_PORT || '5174', 10);

// ── Boot auto-start identifiers (one mechanism per OS) ────────────────────────
const TASK_NAME = 'AutoQA Hub'; // Windows: user-scope logon Scheduled Task
const WIN_AUTOSTART_CMD = path.join(HERE, 'hub-autostart.cmd'); // its action wrapper
const SYSTEMD_UNIT = 'autoqa-hub.service'; // Linux: systemd --user unit
const SYSTEMD_UNIT_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'systemd',
  'user',
  SYSTEMD_UNIT,
);
const LAUNCHD_LABEL = 'dev.autoqa.hub'; // macOS: launchd user agent
const LAUNCHD_PLIST_PATH = path.join(
  os.homedir(),
  'Library',
  'LaunchAgents',
  `${LAUNCHD_LABEL}.plist`,
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Daemonless background process ─────────────────────────────────────────────

/** Environment for the daemonless server child. */
function daemonlessEnv() {
  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
    HUB_HOST: HOST,
    HUB_PORT: String(PORT),
  };
}

function readPid() {
  try {
    const pid = Number.parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists but not signalable == alive
  }
}

function clearPid() {
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Start the built server as a detached background process, writing pid + log
 * under hub/.run/. `unref()` lets this launcher exit while the Hub keeps
 * running. ponytail: daemonless mode has NO auto-restart-on-crash; the upgrade
 * path is `enable-boot`, which registers an OS-native user supervisor
 * (systemd --user / launchd with KeepAlive) that restarts it. Acceptable for a
 * localhost dev tool.
 */
async function daemonlessStart() {
  if (!fs.existsSync(DIST_INDEX)) {
    console.error(`  ERROR: Hub is not built (${DIST_INDEX} missing).`);
    console.error('  Build it first:  pnpm -C hub run build');
    return 1;
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
  // Retry the spawn a few times: right after a restart, Windows hard-kills the
  // old Hub (there is no real SIGTERM) and its listening socket can linger a
  // moment, so a fresh bind may transiently hit EADDRINUSE. We wait for the port
  // to clear between attempts.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const logFd = fs.openSync(LOG_FILE, 'a');
    const child = spawn(process.execPath, [DIST_INDEX], {
      cwd: SERVER_DIR,
      env: daemonlessEnv(),
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
    child.unref();
    try {
      fs.closeSync(logFd); // parent's copy; the child keeps its own dup
    } catch {
      /* ignore */
    }
    if (!child.pid) {
      console.error('  ERROR: failed to spawn the daemonless Hub process.');
      return 1;
    }
    fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
    // Confirm it stayed up (catches an immediate crash, e.g. port already in use).
    await sleep(800);
    if (isAlive(child.pid)) {
      console.log(`  Hub started in daemonless background mode (pid ${child.pid}).`);
      console.log(`  Logs: ${LOG_FILE}`);
      return 0;
    }
    clearPid();
    if (attempt < 3) {
      console.warn(`  Startup attempt ${attempt} exited early; waiting for the port and retrying...`);
      await waitForPortClosed(HOST, PORT, 5_000);
      await sleep(500);
    }
  }
  console.error(`  ERROR: the Hub did not stay up after 3 attempts — see ${LOG_FILE}`);
  return 1;
}

// ── Port helpers ──────────────────────────────────────────────────────────────

/** Resolve true if something is accepting connections on host:port. */
function portOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** Wait until the port stops accepting connections (old instance gone). */
async function waitForPortClosed(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portOpen(host, port, 500))) return true;
    await sleep(300);
  }
  return false;
}

/** Best-effort: free the port via `kill-port` when a stray process holds it. */
async function freePortIfStuck() {
  if (!(await portOpen(HOST, PORT, 500))) return;
  // String + shell:true (not array) to avoid Node's DEP0190; PORT is numeric.
  spawnSync(`kill-port ${PORT}`, {
    stdio: 'ignore',
    timeout: 15_000,
    windowsHide: true,
    shell: true,
  });
}

// ── Boot supervisor (systemd / launchd) awareness ─────────────────────────────

/**
 * Which OS-native supervisor manages the Hub at boot, if any. When present it is
 * the single owner of the process, so start/stop/restart delegate to it and we
 * never also spawn a daemonless copy (that would double-bind the port). Windows'
 * logon task is NOT a supervisor (just a trigger), so it returns null there.
 */
function bootSupervisor() {
  if (IS_LINUX && fs.existsSync(SYSTEMD_UNIT_PATH)) return 'systemd';
  if (IS_MAC && fs.existsSync(LAUNCHD_PLIST_PATH)) return 'launchd';
  return null;
}

function systemctlUser(args, { capture = false } = {}) {
  return spawnSync('systemctl', ['--user', ...args], {
    stdio: capture ? 'pipe' : 'inherit',
    timeout: 30_000,
    encoding: 'utf8',
  });
}

function launchctl(args, { capture = false } = {}) {
  return spawnSync('launchctl', args, {
    stdio: capture ? 'pipe' : 'inherit',
    timeout: 30_000,
    encoding: 'utf8',
  });
}

/** Kill only a daemonless instance (pid file), leaving OS supervisors alone. */
async function stopDaemonless() {
  const pid = readPid();
  if (pid !== null && isAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 20 && isAlive(pid); i++) await sleep(100); // up to 2s grace
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
    console.log(`  Stopped daemonless Hub (pid ${pid}).`);
  }
  clearPid();
}

/**
 * Register the Hub to start at boot/login — user-scope, no admin, no daemon required.
 * Idempotent. Best-effort: never fails the caller (setup) over auto-start.
 */
async function enableBoot() {
  if (IS_WIN) return enableBootWindows();
  if (IS_LINUX) return enableBootSystemd();
  if (IS_MAC) return enableBootLaunchd();
  console.warn(`  enable-boot: unsupported platform ${process.platform}; skipping.`);
  return 0;
}

/** The user's Startup folder .vbs (fallback when schtasks is policy-blocked). */
function startupVbsPath() {
  const startup = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
  );
  return path.join(startup, 'AutoQA Hub.vbs');
}

/**
 * Windows auto-start, two-tier and permission-friendly:
 *   1) a user-scope logon Scheduled Task (clean, no window); if that is blocked
 *      by policy ("Access is denied" — common on locked-down corporate machines),
 *   2) fall back to a .vbs in the user's own Startup folder that launches the
 *      wrapper HIDDEN. The Startup folder lives under %APPDATA%, so it needs no
 *      task-scheduler permission and no admin.
 */
function enableBootWindows() {
  if (!fs.existsSync(WIN_AUTOSTART_CMD)) {
    console.error(`  ERROR: ${WIN_AUTOSTART_CMD} missing — cannot register auto-start.`);
    return 0;
  }
  // /rl limited = installing user's scope (no admin). /f overwrites (idempotent).
  // The /tr program path is inner-quoted so schtasks stores it correctly even
  // when the path contains spaces (e.g. C:\Users\John Doe\...).
  const action = `"\\"${WIN_AUTOSTART_CMD}\\""`;
  const r = spawnSync(
    `schtasks /create /tn "${TASK_NAME}" /tr ${action} /sc onlogon /rl limited /f`,
    { shell: true, stdio: 'pipe', timeout: 30_000, windowsHide: true, encoding: 'utf8' },
  );
  if (r.status === 0) {
    console.log(`  Registered logon auto-start task "${TASK_NAME}" (user scope, no admin).`);
    removeStartupVbs(); // task wins — drop any stale Startup-folder fallback
    return 0;
  }
  const reason = `${r.stdout || ''}${r.stderr || ''}`.trim() || 'access denied';
  console.warn(`  [warn] Scheduled Task blocked (${reason}); using the Startup folder instead.`);
  return enableBootStartupFolder();
}

function enableBootStartupFolder() {
  const vbsPath = startupVbsPath();
  try {
    fs.mkdirSync(path.dirname(vbsPath), { recursive: true });
    // WScript.Shell.Run with window style 0 launches the wrapper HIDDEN; "" is a
    // literal quote in VBScript, so the wrapper path is quoted (handles spaces).
    const vbs = `CreateObject("WScript.Shell").Run "cmd /c ""${WIN_AUTOSTART_CMD}""", 0, False\n`;
    fs.writeFileSync(vbsPath, vbs, 'utf8');
    console.log(`  Registered Startup-folder auto-start: ${vbsPath}`);
  } catch (e) {
    console.warn(
      `  [warn] Could not write the Startup-folder entry (${e.message}). The Hub runs now but will not auto-start at login.`,
    );
  }
  return 0;
}

function removeStartupVbs() {
  try {
    fs.rmSync(startupVbsPath(), { force: true });
  } catch {
    /* ignore */
  }
}

async function enableBootSystemd() {
  const unit = [
    '[Unit]',
    'Description=AutoQA Hub',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${SERVER_DIR}`,
    `ExecStart=${process.execPath} ${DIST_INDEX}`,
    'Restart=always',
    'RestartSec=3',
    'Environment=NODE_ENV=production',
    `Environment=HUB_HOST=${HOST}`,
    `Environment=HUB_PORT=${PORT}`,
    `Environment=PATH=${process.env.PATH || ''}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
  // Hand off from any daemonless instance BEFORE the unit exists so systemd can
  // bind the port (bootSupervisor() only reports systemd once the file is here).
  await stopDaemonless();
  fs.mkdirSync(path.dirname(SYSTEMD_UNIT_PATH), { recursive: true });
  fs.writeFileSync(SYSTEMD_UNIT_PATH, unit, 'utf8');
  systemctlUser(['daemon-reload'], { capture: true });
  const r = systemctlUser(['enable', '--now', SYSTEMD_UNIT]);
  // Start at boot even without an interactive login (best-effort; may be denied
  // by policy on some hosts — the unit still starts on login without it).
  spawnSync('loginctl', ['enable-linger', os.userInfo().username], {
    stdio: 'ignore',
    timeout: 15_000,
  });
  if (!r.error && r.status === 0) {
    console.log(`  Enabled systemd --user unit ${SYSTEMD_UNIT} (Restart=always, starts at boot).`);
  } else {
    console.warn('  [warn] systemctl --user enable failed; the Hub runs now but may not auto-start at boot.');
  }
  return 0;
}

async function enableBootLaunchd() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${DIST_INDEX}</string>
  </array>
  <key>WorkingDirectory</key><string>${SERVER_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HUB_HOST</key><string>${HOST}</string>
    <key>HUB_PORT</key><string>${PORT}</string>
    <key>PATH</key><string>${process.env.PATH || ''}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
`;
  await stopDaemonless();
  fs.mkdirSync(path.dirname(LAUNCHD_PLIST_PATH), { recursive: true });
  fs.writeFileSync(LAUNCHD_PLIST_PATH, plist, 'utf8');
  launchctl(['unload', LAUNCHD_PLIST_PATH], { capture: true }); // ignore if not loaded
  const r = launchctl(['load', '-w', LAUNCHD_PLIST_PATH]);
  if (!r.error && r.status === 0) {
    console.log(`  Loaded launchd agent ${LAUNCHD_LABEL} (RunAtLoad, KeepAlive).`);
  } else {
    console.warn('  [warn] launchctl load failed; the Hub runs now but may not auto-start at boot.');
  }
  return 0;
}

/** Remove the boot auto-start registration (inverse of enable-boot). */
async function disableBoot() {
  if (IS_WIN) {
    spawnSync(`schtasks /delete /tn "${TASK_NAME}" /f`, {
      shell: true,
      stdio: 'pipe',
      timeout: 30_000,
      windowsHide: true,
    });
    removeStartupVbs();
    console.log('  Removed Windows auto-start (logon task + Startup folder).');
  } else if (IS_LINUX) {
    systemctlUser(['disable', '--now', SYSTEMD_UNIT], { capture: true });
    try {
      fs.rmSync(SYSTEMD_UNIT_PATH, { force: true });
    } catch {
      /* ignore */
    }
    systemctlUser(['daemon-reload'], { capture: true });
    console.log(`  Disabled systemd --user unit ${SYSTEMD_UNIT}.`);
  } else if (IS_MAC) {
    launchctl(['unload', LAUNCHD_PLIST_PATH], { capture: true });
    try {
      fs.rmSync(LAUNCHD_PLIST_PATH, { force: true });
    } catch {
      /* ignore */
    }
    console.log(`  Removed launchd agent ${LAUNCHD_LABEL}.`);
  }
  return 0;
}

// ── Commands ──────────────────────────────────────────────────────────────────

/** Stop whatever is running (boot supervisor if any, else the daemonless instance). */
async function stop() {
  const sup = bootSupervisor();
  if (sup === 'systemd') {
    systemctlUser(['stop', SYSTEMD_UNIT]);
    return;
  }
  if (sup === 'launchd') {
    launchctl(['unload', LAUNCHD_PLIST_PATH], { capture: true });
    return;
  }
  await stopDaemonless(); // no-op when no pid file exists
  await freePortIfStuck();
}

/** Start the Hub (idempotent — clears any previous instance first). */
async function start() {
  const sup = bootSupervisor();
  if (sup === 'systemd') {
    const r = systemctlUser(['start', SYSTEMD_UNIT]);
    return r.error || r.status !== 0 ? 1 : 0;
  }
  if (sup === 'launchd') {
    launchctl(['load', '-w', LAUNCHD_PLIST_PATH], { capture: true });
    return 0;
  }
  await stop();
  return daemonlessStart();
}

/** Restart: delegate to the boot supervisor, else full stop+start (daemonless). */
async function restart() {
  const sup = bootSupervisor();
  if (sup === 'systemd') {
    const r = systemctlUser(['restart', SYSTEMD_UNIT]);
    return r.error || r.status !== 0 ? 1 : 0;
  }
  if (sup === 'launchd') {
    launchctl(['kickstart', '-k', `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`], {
      capture: true,
    });
    return 0;
  }
  await stop();
  await waitForPortClosed(HOST, PORT, 15_000);
  return start();
}

/** Report where the Hub stands (port + daemonless pid + boot auto-start). */
async function status() {
  const up = await portOpen(HOST, PORT, 1500);
  console.log(`  Hub ${HOST}:${PORT} — ${up ? 'LISTENING' : 'not responding'}`);
  const pid = readPid();
  if (pid) {
    console.log(`  Daemonless pid ${pid} — ${isAlive(pid) ? 'alive' : 'dead (stale pidfile)'}`);
  }
  console.log(`  Boot auto-start: ${bootAutostartState()}`);
  return up ? 0 : 1;
}

/** Human-readable boot auto-start registration state (for `status`). */
function bootAutostartState() {
  if (IS_WIN) {
    const r = spawnSync(`schtasks /query /tn "${TASK_NAME}"`, {
      shell: true,
      stdio: 'pipe',
      timeout: 15_000,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (r.status === 0) return 'registered (logon task)';
    if (fs.existsSync(startupVbsPath())) return 'registered (Startup folder)';
    return 'not registered (run: enable-boot)';
  }
  if (IS_LINUX) {
    return fs.existsSync(SYSTEMD_UNIT_PATH)
      ? 'enabled (systemd --user)'
      : 'not enabled (run: enable-boot)';
  }
  if (IS_MAC) {
    return fs.existsSync(LAUNCHD_PLIST_PATH) ? 'enabled (launchd)' : 'not enabled (run: enable-boot)';
  }
  return 'unsupported platform';
}

async function main() {
  const cmd = (process.argv[2] || 'start').toLowerCase();
  switch (cmd) {
    case 'start':
      return start();
    case 'stop':
      await stop();
      return 0;
    case 'restart':
      return restart();
    case 'status':
      return status();
    case 'enable-boot':
      return enableBoot();
    case 'disable-boot':
      return disableBoot();
    default:
      console.error(
        `Unknown command: ${cmd}. Use: start | stop | restart | status | enable-boot | disable-boot`,
      );
      return 2;
  }
}

// Force-exit with the result code. This is deliberate: `start`/`restart` spawn a
// DETACHED background child which, on Windows, otherwise keeps the parent's event
// loop alive and hangs the CLI (blocking setup). Before exiting we switch
// stdout/stderr to BLOCKING so buffered output is not clipped by process.exit on
// a Windows pipe (the documented workaround for that truncation).
function finishAndExit(code) {
  for (const s of [process.stdout, process.stderr]) {
    const handle = s?._handle;
    if (handle && typeof handle.setBlocking === 'function') handle.setBlocking(true);
  }
  process.exit(code);
}

main()
  .then((code) => finishAndExit(code ?? 0))
  .catch((err) => {
    console.error(err);
    finishAndExit(1);
  });
