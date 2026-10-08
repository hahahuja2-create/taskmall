'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadOperatorToken, operatorClient } = require('../payments/operator');

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Open the operator workspace from your own private interactive terminal.');
  if (process.platform !== 'win32') throw new Error('The private browser launcher currently supports the operator Windows computer.');
  const data = process.env.TASKMALL_DATA_DIR || path.join(__dirname, '..', 'data');
  const token = await loadOperatorToken(process.env.TASKMALL_OPERATOR_TOKEN_FILE || path.join(data, 'operator.token'));
  const origin = process.env.TASKMALL_OPERATOR_ORIGIN || 'http://127.0.0.1:' + (process.env.PORT || 4173);
  const request = operatorClient(origin, token);
  const { ticket } = await request('browser-session', {});
  if (!/^[a-zA-Z0-9_-]{43}$/.test(ticket)) throw new Error('Could not obtain the one-use operator session.');
  const url = new URL('/operator/unlock', origin);
  url.hash = ticket;
  // The one-use grant is never printed or put into the PowerShell command line.
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:TASKMALL_OPERATOR_BROWSER_URL'],
      { windowsHide: true, stdio: 'ignore', env: { ...process.env, TASKMALL_OPERATOR_BROWSER_URL: url.href } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('The browser could not be opened.')));
  });
  console.log('TaskMall payment workspace opened in your default browser. Session expires in 15 minutes.');
}

main().catch(() => { console.error('Operator workspace not opened. Use your private Windows terminal and check the local server.'); process.exitCode = 1; });
