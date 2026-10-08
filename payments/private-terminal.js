'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);

function hiddenPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use your own private interactive terminal.');
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const timer = setTimeout(() => finish(new Error('Password entry timed out.')), 120_000);
    function finish(error) {
      clearTimeout(timer);
      process.stdin.off('data', input);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    }
    function input(chunk) {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') return finish(new Error('Cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 128) value += char;
      }
    }
    process.stdin.on('data', input);
  });
}

async function maskedBackupPassword(context = 'original') {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_TERMINAL_REQUIRED');
  if (process.platform !== 'win32') throw new Error('WINDOWS_BACKUP_HELPER_REQUIRED');
  if (!['original', 'returned', 'retry', 'new'].includes(context)) throw new Error('BACKUP_PASSWORD_DIALOG_FAILED');
  const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'SystemDrive', 'LOCALAPPDATA', 'USERPROFILE', 'APPDATA']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  let result;
  try {
    // The local child returns the password through a private pipe, never arguments, files or logs.
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'RemoteSigned',
      '-File', path.join(__dirname, '..', 'scripts', 'backup-password.ps1')], {
      windowsHide: true, timeout: 1_800_000, maxBuffer: 8192,
      env: { ...environment, TASKMALL_BACKUP_PASSWORD_CONTEXT: context }
    });
    result = JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(error.killed ? 'BACKUP_PASSWORD_DIALOG_TIMED_OUT' : 'BACKUP_PASSWORD_DIALOG_FAILED');
  }
  if (result?.status === 'cancelled') throw new Error('BACKUP_PASSWORD_ENTRY_CANCELLED');
  if (result?.status !== 'entered' || typeof result.password !== 'string' || !result.password.length
    || result.password.length > 128) throw new Error('BACKUP_PASSWORD_DIALOG_FAILED');
  if (context === 'new' && (result.password.length < 20 || !/\p{L}/u.test(result.password))) throw new Error('BACKUP_PASSWORD_TOO_WEAK');
  return result.password;
}

module.exports = { hiddenPassword, maskedBackupPassword };
