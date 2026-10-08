'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { HDNodeWallet, Wallet } = require('ethers');
const { BRANCH_PATH } = require('../payments/tron');
const { backupDigest, pendingEncryptedBackup, replaceEncryptedBackup } = require('../payments/backup-rotation');
const { maskedBackupPassword } = require('../payments/private-terminal');

// Public fixtures only; no real vault or funded wallet is accessed by these tests.
const fixture = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', '', BRANCH_PATH).deriveChild(0);
const oldPassword = 'PublicFixtureOldPassword2026!';
const newPassword = 'PublicFixtureNewPassword2026!';
let original;
let replacement;
test.before(async () => {
  original = await fixture.encrypt(oldPassword);
  replacement = await fixture.encrypt(newPassword);
});

async function directory(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-backup-rotation-'));
  t.after(async () => {
    assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(folder).startsWith('taskmall-backup-rotation-'));
    await fs.rm(folder, { recursive: true, force: true });
  });
  return folder;
}

test('replacement preserves a byte-identical rollback archive and changes encryption, not the wallet', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'recovery.keystore.json');
  await fs.writeFile(source, original);
  const result = await replaceEncryptedBackup(source, replacement, backupDigest(original));
  assert.deepEqual(Object.keys(result), ['archive']);
  assert.equal(await fs.readFile(source, 'utf8'), replacement);
  assert.equal(await fs.readFile(result.archive, 'utf8'), original);
  const restored = await Wallet.fromEncryptedJson(await fs.readFile(source, 'utf8'), newPassword);
  const previous = await Wallet.fromEncryptedJson(await fs.readFile(result.archive, 'utf8'), oldPassword);
  assert.equal(restored.address, previous.address);
  assert.equal(restored.mnemonic.phrase, previous.mnemonic.phrase);
  await assert.rejects(Wallet.fromEncryptedJson(await fs.readFile(source, 'utf8'), oldPassword));
  assert.deepEqual((await fs.readdir(folder)).sort(), [path.basename(source), path.basename(result.archive)].sort());
});

test('a changed active backup aborts before any archive or replacement', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'recovery.keystore.json');
  await fs.writeFile(source, replacement);
  await assert.rejects(replaceEncryptedBackup(source, original, backupDigest(original)), /BACKUP_CHANGED_DURING_ROTATION/);
  assert.equal(await fs.readFile(source, 'utf8'), replacement);
  assert.deepEqual(await fs.readdir(folder), [path.basename(source)]);
});

test('conflicting archives are not overwritten and matching archives can be reused', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'recovery.keystore.json');
  const archive = source + '.retired-' + backupDigest(original).slice(0, 16) + '.keystore.json';
  await fs.writeFile(source, original);
  await fs.writeFile(archive, replacement);
  await assert.rejects(replaceEncryptedBackup(source, replacement, backupDigest(original)), /BACKUP_ARCHIVE_CONFLICT/);
  assert.equal(await fs.readFile(source, 'utf8'), original);
  assert.equal(await fs.readFile(archive, 'utf8'), replacement);
  await fs.writeFile(archive, original);
  await replaceEncryptedBackup(source, replacement, backupDigest(original));
  assert.equal(await fs.readFile(archive, 'utf8'), original);
});

test('a concurrent rotation lock and invalid replacement both leave existing files untouched', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'recovery.keystore.json');
  const lock = source + '.rotation.lock';
  await fs.writeFile(source, original);
  await fs.writeFile(lock, 'Public fixture lock owned by another process.');
  await assert.rejects(replaceEncryptedBackup(source, replacement, backupDigest(original)), /BACKUP_ROTATION_BUSY/);
  await assert.rejects(replaceEncryptedBackup(source, JSON.stringify({ seed: 'not accepted' }), backupDigest(original)), /ENCRYPTED_BACKUP_REQUIRED/);
  assert.equal(await fs.readFile(source, 'utf8'), original);
  assert.equal(await fs.readFile(lock, 'utf8'), 'Public fixture lock owned by another process.');
  assert.equal((await fs.readdir(folder)).length, 2);
});

test('secure-backup CLI rejects tool execution and financial flags before accessing wallet files', async t => {
  const folder = await directory(t);
  for (const options of [[], ['--verify-return'], ['--run'], ['--send'], ['--setup'], ['--password'], ['--verify-return', '--run']]) {
    const result = spawnSync(process.execPath, ['scripts/secure-backup.cjs', ...options], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true,
      env: { ...process.env, TRON_LOCAL_VAULT_FILE: path.join(folder, 'not-read.vault'), TRON_WALLET_PUBLIC_FILE: path.join(folder, 'not-read.json') }
    });
    assert.notEqual(result.status, 0);
    const validOptions = options.length === 0 || (options.length === 1 && options[0] === '--verify-return');
    assert.match(result.stderr, validOptions ? /PRIVATE_TERMINAL_REQUIRED/ : /INVALID_SECURE_BACKUP_OPTIONS/);
    assert.equal(result.stdout, '');
  }
  await assert.rejects(maskedBackupPassword('new'), /PRIVATE_TERMINAL_REQUIRED/);
  assert.deepEqual(await fs.readdir(folder), []);
});

test('resumption requires one existing encrypted candidate and never guesses among multiple files', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'recovery.keystore.json');
  await fs.writeFile(source, original);
  await assert.rejects(pendingEncryptedBackup(source), /PENDING_BACKUP_NOT_UNIQUE/);
  const candidate = source + '.pending-1234567890abcdef.keystore.json';
  await fs.writeFile(candidate, replacement);
  assert.equal(await pendingEncryptedBackup(source), candidate);
  assert.equal(await fs.readFile(source, 'utf8'), original);
  const other = source + '.pending-abcdef1234567890.keystore.json';
  await fs.writeFile(other, replacement);
  await assert.rejects(pendingEncryptedBackup(source), /PENDING_BACKUP_NOT_UNIQUE/);
  await fs.unlink(other);
  await fs.writeFile(candidate, 'Not an encrypted fixture.');
  await assert.rejects(pendingEncryptedBackup(source), /ENCRYPTED_BACKUP_REQUIRED/);
  assert.equal(await fs.readFile(source, 'utf8'), original);
});
