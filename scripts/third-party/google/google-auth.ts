import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authenticate } from '@google-cloud/local-auth';
import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
];

const CREDENTIALS_DIR = path.resolve(__dirname, 'credentials');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'credentials.json');
const TOKEN_PATH = path.join(CREDENTIALS_DIR, 'token.json');

export async function authorize(): Promise<OAuth2Client> {
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
      const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
      const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
      oAuth2Client.setCredentials(tokens);

      // Attempt to retrieve a valid access token (refreshes if needed and possible)
      await oAuth2Client.getAccessToken();

      return oAuth2Client;
    } catch (_err) {
      console.warn('Token expired or invalid, re-authenticating...');
    }
  }

  function cleanupPort(port: number) {
    try {
      console.log(`🧹 Cleaning up port ${port} before auth...`);
      if (os.platform() === 'win32') {
        const output = execSync(`netstat -ano | findstr :${port}`).toString();
        const lines = output.split('\n');
        const pids = new Set<string>();
        for (const line of lines) {
          if (line.includes(`:${port}`) && line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== '0') {
              pids.add(pid);
            }
          }
        }
        for (const pid of pids) {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        }
      } else {
        execSync(`lsof -t -i:${port} | xargs kill -9`, { stdio: 'ignore' });
      }
    } catch (_) {
      // Ignore, port is likely free
    }
  }

  // Check if credentials exist before calling authenticate
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `[ERROR] Google API credentials not found at: ${CREDENTIALS_PATH}\nPlease add credentials.json from Google Cloud Console to enable usage logging and authentication. The script cannot proceed without it.`,
    );
  }

  // Cleanup port 3000 to avoid EADDRINUSE crash
  cleanupPort(3000);

  // Fallback to authenticate flow
  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  if (client.credentials) {
    if (!fs.existsSync(CREDENTIALS_DIR)) {
      fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    }
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(client.credentials, null, 2), 'utf8');
  }

  return client as unknown as OAuth2Client;
}

if (require.main === module) {
  authorize()
    .then(() => console.log('Google Auth Successful! Token is ready.'))
    .catch(console.error);
}
