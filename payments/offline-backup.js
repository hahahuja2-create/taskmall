'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);

async function privateBackupHelper(script, metadata) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_TERMINAL_REQUIRED');
  if (process.platform !== 'win32') throw new Error('WINDOWS_BACKUP_HELPER_REQUIRED');
  if (!['backup-copy.ps1', 'iphone-copy.ps1', 'iphone-confirm.ps1'].includes(script)) throw new Error('INVALID_BACKUP_HELPER');
  const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'SystemDrive', 'LOCALAPPDATA', 'USERPROFILE', 'APPDATA']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  try {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'RemoteSigned',
      '-File', path.join(__dirname, '..', 'scripts', script)], {
      windowsHide: true, timeout: script.startsWith('iphone-') ? 1_800_000 : 300_000, maxBuffer: 8192, env: { ...environment, ...metadata }
    });
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(error.killed ? 'BACKUP_HELPER_TIMED_OUT' : 'BACKUP_HELPER_UNAVAILABLE');
  }
}

async function verifiedOfflineCopy(source, destination) {
  try {
    if (typeof destination !== 'string' || !path.isAbsolute(destination)
      || path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) throw new Error('Invalid offline copy.');
    const [originalInfo, copyInfo] = await Promise.all([fs.stat(source), fs.stat(destination)]);
    if (!originalInfo.isFile() || !copyInfo.isFile() || originalInfo.size < 1 || originalInfo.size > 1_000_000
      || copyInfo.size !== originalInfo.size || (originalInfo.dev === copyInfo.dev && originalInfo.ino === copyInfo.ino)) throw new Error('Invalid offline copy.');
    const [original, copy] = await Promise.all([fs.readFile(source), fs.readFile(destination)]);
    const digest = data => crypto.createHash('sha256').update(data).digest();
    if (!crypto.timingSafeEqual(digest(original), digest(copy))) throw new Error('Backup copy mismatch.');
    return copy.toString('utf8');
  } catch { throw new Error('OFFLINE_BACKUP_COPY_NOT_VERIFIED'); }
}

async function copyBackupToUsb(source) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_TERMINAL_REQUIRED');
  if (process.platform !== 'win32') throw new Error('WINDOWS_USB_BACKUP_REQUIRED');
  try {
    // Only the encrypted file path reaches this helper; it never receives a password or plaintext key.
    const result = await privateBackupHelper('backup-copy.ps1', { TASKMALL_ENCRYPTED_BACKUP_SOURCE: path.resolve(source) });
    if (result.status !== 'copied' || typeof result.file !== 'string') throw new Error('Invalid helper response.');
    return { file: result.file, encrypted: await verifiedOfflineCopy(source, result.file) };
  } catch { throw new Error('OFFLINE_BACKUP_COPY_NOT_VERIFIED'); }
}

module.exports = { verifiedOfflineCopy, copyBackupToUsb, privateBackupHelper };
