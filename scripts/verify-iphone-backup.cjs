'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { HDNodeWallet } = require('ethers');
const { BRANCH_PATH, deriveAddress } = require('../payments/tron');
const { encryptedDocument, readEncryptedBackup, prepareIphoneExport, verifyIphoneReturn, findIphoneReturn } = require('../payments/iphone-backup');
const { privateBackupHelper } = require('../payments/offline-backup');
const { maskedBackupPassword } = require('../payments/private-terminal');
const { verifyPortableRecovery } = require('../payments/collection-activation');

// Public fixture only. These addresses must never receive real funds.
const phrase = 'test test test test test test test test test test test junk';
const password = 'PublicFixturePassword2026';
const branch = HDNodeWallet.fromPhrase(phrase, '', BRANCH_PATH);
const wallet = { xpub: branch.neuter().extendedKey };
let encrypted;
test.before(async () => { encrypted = await branch.deriveChild(0).encrypt(password); });

async function directory(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-iphone-'));
  t.after(async () => {
    assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(folder).startsWith('taskmall-iphone-'));
    await fs.rm(folder, { recursive: true, force: true });
  });
  return folder;
}

test('export accepts only the generated encrypted recovery format, not seeds or plaintext extras', async t => {
  const folder = await directory(t);
  assert.equal(encryptedDocument(encrypted), encrypted);
  assert.throws(() => encryptedDocument(JSON.stringify({ mnemonic: phrase })), /ENCRYPTED_BACKUP_REQUIRED/);
  assert.throws(() => encryptedDocument(JSON.stringify({ ...JSON.parse(encrypted), privateKey: 'plaintext' })), /ENCRYPTED_BACKUP_REQUIRED/);
  const altered = JSON.parse(encrypted);
  altered['x-ethers'].phrase = phrase;
  assert.throws(() => encryptedDocument(JSON.stringify(altered)), /ENCRYPTED_BACKUP_REQUIRED/);
  assert.throws(() => encryptedDocument('x'.repeat(1_000_001)), /ENCRYPTED_BACKUP_REQUIRED/);
  await assert.rejects(readEncryptedBackup(folder), /ENCRYPTED_BACKUP_REQUIRED/);
  await assert.rejects(readEncryptedBackup(path.join(folder, 'absent.json')), /ENCRYPTED_BACKUP_REQUIRED/);
});

test('private export copies only encrypted bytes, preserves source, and never replaces a conflicting file', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'source.keystore.json');
  await fs.writeFile(source, encrypted);
  const transfer = await prepareIphoneExport(source, path.join(folder, 'transfer'));
  assert.equal(await fs.readFile(transfer.file, 'utf8'), encrypted);
  assert.equal(await fs.readFile(source, 'utf8'), encrypted);
  assert.deepEqual(await fs.readdir(transfer.incoming), []);
  assert.deepEqual(await prepareIphoneExport(source, path.join(folder, 'transfer')), transfer);
  await fs.writeFile(transfer.file, 'Do not overwrite this fixture.');
  await assert.rejects(prepareIphoneExport(source, path.join(folder, 'transfer')), /IPHONE_EXPORT_CONFLICT/);
  assert.equal(await fs.readFile(transfer.file, 'utf8'), 'Do not overwrite this fixture.');
  assert.equal(await fs.readFile(source, 'utf8'), encrypted);
});

test('a returned file must be independent and byte-identical; recovery matches the existing wallet', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'source.keystore.json');
  await fs.writeFile(source, encrypted);
  const transfer = await prepareIphoneExport(source, path.join(folder, 'transfer'));
  const returned = path.join(transfer.incoming, path.basename(transfer.file));
  await fs.copyFile(transfer.file, returned);
  const checked = await verifyIphoneReturn(transfer, returned);
  const recovered = await verifyPortableRecovery(checked, password, wallet);
  assert.match(recovered.backupDigest, /^[a-f0-9]{64}$/);
  assert.ok(recovered.fuelAddress.startsWith('T'));
  assert.notEqual(recovered.fuelAddress, deriveAddress(wallet.xpub, 0));
  assert.deepEqual(Object.keys(recovered).sort(), ['backupDigest', 'fuelAddress']);
  await assert.rejects(verifyIphoneReturn(transfer, source), /IPHONE_RETURN_NOT_VERIFIED/);
  await assert.rejects(verifyIphoneReturn(transfer, transfer.file), /IPHONE_RETURN_NOT_VERIFIED/);
  await assert.rejects(verifyIphoneReturn(transfer, 'relative.json'), /IPHONE_RETURN_NOT_VERIFIED/);
  const hardLink = path.join(transfer.incoming, 'link.keystore.json');
  await fs.link(transfer.file, hardLink);
  await assert.rejects(verifyIphoneReturn(transfer, hardLink), /IPHONE_RETURN_NOT_VERIFIED/);
  await fs.writeFile(returned, encrypted.replace('aes-128-ctr', 'aes-128-cbc'));
  await assert.rejects(verifyIphoneReturn(transfer, returned), /IPHONE_RETURN_NOT_VERIFIED/);
  await fs.copyFile(transfer.file, returned);
  await assert.rejects(verifyPortableRecovery(await verifyIphoneReturn(transfer, returned), 'wrong password', wallet), /RECOVERY_NOT_VERIFIED/);
});

test('changed source and changed export both fail closed before returned-copy decryption', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'source.keystore.json');
  await fs.writeFile(source, encrypted);
  const transfer = await prepareIphoneExport(source, path.join(folder, 'transfer'));
  const returned = path.join(transfer.incoming, 'returned.keystore.json');
  await fs.copyFile(transfer.file, returned);
  await fs.writeFile(source, encrypted + ' ');
  await assert.rejects(verifyIphoneReturn(transfer, returned), /IPHONE_RETURN_NOT_VERIFIED/);
  await fs.writeFile(source, encrypted);
  await fs.writeFile(transfer.file, encrypted + ' ');
  await assert.rejects(verifyIphoneReturn(transfer, returned), /IPHONE_RETURN_NOT_VERIFIED/);
});

test('automatic return selection accepts only a sole independent matching copy and falls back on ambiguity', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'source.keystore.json');
  await fs.writeFile(source, encrypted);
  const transfer = await prepareIphoneExport(source, path.join(folder, 'transfer'));
  assert.equal(await findIphoneReturn(transfer), undefined);
  await fs.writeFile(path.join(transfer.incoming, 'invalid.keystore.json'), 'Public invalid fixture.');
  const alias = path.join(transfer.incoming, 'alias.keystore.json');
  await fs.link(transfer.file, alias);
  assert.equal(await findIphoneReturn(transfer), undefined);
  const returned = path.join(transfer.incoming, 'returned.keystore.json');
  await fs.copyFile(transfer.file, returned);
  assert.equal(await findIphoneReturn(transfer), returned);
  await fs.copyFile(transfer.file, path.join(transfer.incoming, 'second.keystore.json'));
  assert.equal(await findIphoneReturn(transfer), undefined);
  await fs.writeFile(source, encrypted + ' ');
  assert.equal(await findIphoneReturn(transfer), undefined);
});

test('resuming reconstructs a missing staged export without changing the original or already returned copy', async t => {
  const folder = await directory(t);
  const source = path.join(folder, 'source.keystore.json');
  await fs.writeFile(source, encrypted);
  const transfer = await prepareIphoneExport(source, path.join(folder, 'transfer'));
  const returned = path.join(transfer.incoming, path.basename(transfer.file));
  await fs.rename(transfer.file, returned);
  await assert.rejects(verifyIphoneReturn(transfer, returned), /IPHONE_RETURN_NOT_VERIFIED/);
  const restored = await prepareIphoneExport(source, path.join(folder, 'transfer'));
  assert.deepEqual(restored, transfer);
  assert.equal(await verifyIphoneReturn(restored, returned), encrypted);
  assert.equal(await fs.readFile(source, 'utf8'), encrypted);
  assert.equal(await fs.readFile(returned, 'utf8'), encrypted);
  const recovery = await verifyPortableRecovery(await verifyIphoneReturn(restored, returned), password, wallet);
  assert.match(recovery.backupDigest, /^[a-f0-9]{64}$/);
});

test('noninteractive launch and financial flags are rejected before any wallet file or helper is accessed', async t => {
  const folder = await directory(t);
  const root = path.resolve(__dirname, '..');
  for (const options of [[], ['--verify-return'], ['--run'], ['--send'], ['--setup'], ['--verify-return', '--run']]) {
    const result = spawnSync(process.execPath, ['scripts/iphone-backup.cjs', ...options], { cwd: root, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, TRON_LOCAL_VAULT_FILE: path.join(folder, 'not-read.vault'), TRON_WALLET_PUBLIC_FILE: path.join(folder, 'not-read.json') } });
    assert.notEqual(result.status, 0);
    const validOptions = options.length === 0 || (options.length === 1 && options[0] === '--verify-return');
    assert.match(result.stderr, validOptions ? /PRIVATE_TERMINAL_REQUIRED/ : /INVALID_IPHONE_BACKUP_OPTIONS/);
    assert.equal(result.stdout, '');
  }
  await assert.rejects(privateBackupHelper('iphone-copy.ps1', {}), /PRIVATE_TERMINAL_REQUIRED/);
  await assert.rejects(privateBackupHelper('iphone-confirm.ps1', {}), /PRIVATE_TERMINAL_REQUIRED/);
  await assert.rejects(maskedBackupPassword(), /PRIVATE_TERMINAL_REQUIRED/);
  assert.deepEqual(await fs.readdir(folder), []);
});

test('private backup diagnostics distinguish unlock failure and another wallet without revealing recovery data', async () => {
  await assert.rejects(verifyPortableRecovery(encrypted, 'wrong public fixture password', wallet, { detailedErrors: true }), error => {
    assert.equal(error.message, 'BACKUP_PASSWORD_NOT_ACCEPTED');
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error), []);
    return true;
  });
  const otherWallet = { xpub: HDNodeWallet.fromPhrase(phrase, 'another public fixture', BRANCH_PATH).neuter().extendedKey };
  await assert.rejects(verifyPortableRecovery(encrypted, password, otherWallet, { detailedErrors: true }), /BACKUP_WALLET_MISMATCH/);
  await assert.rejects(verifyPortableRecovery(encrypted, password, otherWallet), /PORTABLE_RECOVERY_NOT_VERIFIED/);
  await assert.rejects(verifyPortableRecovery('invalid JSON public fixture', password, wallet, { detailedErrors: true }), /PORTABLE_RECOVERY_NOT_VERIFIED/);
});

test('Windows forms render masked password fields and require explicit phone-storage acknowledgement', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'RemoteSigned',
    '-File', path.join(__dirname, 'verify-backup-password.ps1')], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'BACKUP_PASSWORD_FORM_TESTS_PASSED');
});
