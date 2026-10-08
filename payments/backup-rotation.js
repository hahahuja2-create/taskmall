'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { encryptedDocument, readEncryptedBackup } = require('./iphone-backup');

const backupDigest = data => crypto.createHash('sha256').update(data).digest('hex');

async function pendingEncryptedBackup(source) {
  const folder = path.dirname(path.resolve(source));
  const prefix = path.basename(source) + '.pending-';
  const names = (await fs.readdir(folder)).filter(name => name.startsWith(prefix) && /\.pending-[a-f0-9]{16}\.keystore\.json$/.test(name));
  if (names.length !== 1) throw new Error('PENDING_BACKUP_NOT_UNIQUE');
  const file = path.join(folder, names[0]);
  await readEncryptedBackup(file);
  return file;
}

async function replaceEncryptedBackup(source, encrypted, expectedDigest) {
  encryptedDocument(encrypted);
  const lock = source + '.rotation.lock';
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch { throw new Error('BACKUP_ROTATION_BUSY'); }
  const temporary = source + '.rotation-' + crypto.randomBytes(8).toString('hex') + '.tmp';
  let staged = false;
  try {
    const original = await readEncryptedBackup(source);
    if (backupDigest(original) !== expectedDigest) throw new Error('BACKUP_CHANGED_DURING_ROTATION');
    const archive = source + '.retired-' + expectedDigest.slice(0, 16) + '.keystore.json';
    try {
      const previous = await fs.open(archive, 'wx', 0o600);
      try { await previous.writeFile(original, 'utf8'); await previous.sync(); }
      finally { await previous.close(); }
    }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await readEncryptedBackup(archive) !== original) throw new Error('BACKUP_ARCHIVE_CONFLICT');
    }
    if (await readEncryptedBackup(archive) !== original) throw new Error('BACKUP_ARCHIVE_CONFLICT');
    const output = await fs.open(temporary, 'wx', 0o600);
    staged = true;
    try { await output.writeFile(encrypted, 'utf8'); await output.sync(); }
    finally { await output.close(); }
    if (await readEncryptedBackup(temporary) !== encrypted) throw new Error('BACKUP_ROTATION_FAILED');
    if (await readEncryptedBackup(source) !== original) throw new Error('BACKUP_CHANGED_DURING_ROTATION');
    await fs.rename(temporary, source);
    staged = false;
    return { archive };
  } catch (error) {
    const safe = ['BACKUP_CHANGED_DURING_ROTATION', 'BACKUP_ARCHIVE_CONFLICT', 'ENCRYPTED_BACKUP_REQUIRED'];
    throw new Error(safe.includes(error.message) ? error.message : 'BACKUP_ROTATION_FAILED');
  } finally {
    if (staged) await fs.unlink(temporary).catch(() => {});
    await handle.close();
    await fs.unlink(lock);
  }
}

module.exports = { backupDigest, pendingEncryptedBackup, replaceEncryptedBackup };
