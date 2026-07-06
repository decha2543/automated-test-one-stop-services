import { google } from 'googleapis';
import { authorize } from './google-auth';

async function logUsage() {
  try {
    // Authenticate and get valid client
    const auth = await authorize();
    const sheets = google.sheets({ version: 'v4', auth });

    // Prepare log data mapping from env vars
    const executedBy = process.env.CURRENT_USER || 'Unknown';
    const command = process.env.COMMAND || 'Unknown';
    const channel = 'local';

    // Format timestamp: 2026-07-02 10:15:30
    const date = process.env.CURRENT_DATE || '';
    let time = process.env.CURRENT_TIME || '';
    // time comes in as HH-MM-SS, display as HH:MM:SS
    time = time.replace(/-/g, ':');

    const timestamp = `${date} ${time}`.trim();

    // Default to a specific sheet name, e.g. "logs"
    const sheetName = process.env.SHEET_NAME || 'logs';
    // SPREADSHEET_ID should be provided in .env
    const spreadsheetId = process.env.SPREADSHEET_ID;

    if (!spreadsheetId) {
      console.warn('No SPREADSHEET_ID provided in environment. Skipping usage log.');
      return;
    }

    const values = [[executedBy, command, channel, timestamp]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });

    console.log('Usage log appended successfully to Google Sheets.');
  } catch (error: any) {
    if (
      error.code === 401 ||
      error.status === 401 ||
      (error.response && error.response.status === 401)
    ) {
      console.warn('⚠️ Token is invalid or revoked by Google. Forcing re-authentication...');
      return logUsage();
    }
    console.error('Error appending usage log to Google Sheets:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  logUsage();
}
