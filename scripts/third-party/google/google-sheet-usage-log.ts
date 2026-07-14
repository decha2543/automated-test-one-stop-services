import { google } from 'googleapis';
import { authorize, credentialsReady } from './google-auth';

/**
 * Google Sheet usage logging — a best-effort SIDE EFFECT that must NEVER fail a
 * test run. Every not-configured / auth / API problem degrades to a warning and
 * a clean skip (exit 0); it never calls process.exit(1). Config (all optional):
 *   - credentials.json  uploaded via the Hub (Projects -> scripts/.env card)
 *   - SPREADSHEET_ID    scripts/.env — REQUIRED to enable logging
 *   - SHEET_NAME        scripts/.env — optional tab name, defaults to "logs"
 * Run with `--check` for a preflight readiness report (logs nothing, exit 0).
 */

/** Readiness of the logging integration, WITHOUT attempting authentication. */
function readiness() {
  const hasCredentials = credentialsReady();
  const hasSpreadsheetId = Boolean(process.env.SPREADSHEET_ID);
  return {
    hasCredentials,
    hasSpreadsheetId,
    ready: hasCredentials && hasSpreadsheetId,
    sheetName: process.env.SHEET_NAME || 'logs',
  };
}

async function logUsage(): Promise<void> {
  // Preflight guards FIRST, before any auth — skip cleanly (never crash) when
  // the feature is not fully configured. "Not configured" is not an error.
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.warn('[usage-log] SPREADSHEET_ID not set — skipping usage log (not an error).');
    return;
  }
  if (!credentialsReady()) {
    console.warn(
      '[usage-log] Google credentials.json not found — skipping. Upload it via the Hub to enable logging (not an error).',
    );
    return;
  }

  const sheetName = process.env.SHEET_NAME || 'logs';

  try {
    // googleapis and @google-cloud/local-auth resolve different (structurally
    // identical) google-auth-library versions, so their OAuth2Client types clash
    // nominally (private `redirectUri`). Bridge to googleapis' own client type at
    // this boundary — safe at runtime (same class), and avoids `any`.
    const auth = (await authorize()) as unknown as InstanceType<typeof google.auth.OAuth2>;
    const sheets = google.sheets({ version: 'v4', auth });

    const executedBy = process.env.CURRENT_USER || 'Unknown';
    const command = process.env.COMMAND || 'Unknown';
    const channel = 'local';
    const date = process.env.CURRENT_DATE || '';
    // CURRENT_TIME arrives as HH-MM-SS; display as HH:MM:SS.
    const time = (process.env.CURRENT_TIME || '').replace(/-/g, ':');
    const timestamp = `${date} ${time}`.trim();

    const values = [[executedBy, command, channel, timestamp]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });

    console.log('Usage log appended successfully to Google Sheets.');
  } catch (error) {
    const err = error as {
      code?: number;
      status?: number;
      response?: { status?: number };
      message?: string;
    };
    const is401 = err.code === 401 || err.status === 401 || err.response?.status === 401;
    if (is401) {
      // Token revoked/expired. Re-auth is interactive (browser) and can't run in
      // an automated test run — an admin runs it once separately. Skip, don't loop.
      console.warn(
        '[usage-log] Google token invalid/revoked — skipping. Re-run Google auth to refresh.',
      );
      return;
    }
    // Network / API / quota: logging is best-effort, so warn and skip. NEVER
    // exit(1) here, or a logging hiccup would fail the whole test run.
    console.warn('[usage-log] Skipped (append failed):', err.message ?? error);
  }
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const s = readiness();
    console.log(
      `usage-logging: ${s.ready ? 'READY' : 'NOT CONFIGURED'} | credentials.json ${s.hasCredentials ? 'present' : 'MISSING'} | SPREADSHEET_ID ${s.hasSpreadsheetId ? 'set' : 'MISSING'} | sheet "${s.sheetName}"`,
    );
    process.exit(0);
  }
  logUsage();
}
