'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { HDNodeWallet } = require('ethers');
const { BRANCH_PATH, validateWallet } = require('../payments/tron');
const { defaultVaultFile, readVault } = require('../payments/vault');
const { maskedBackupPassword } = require('../payments/private-terminal');
const { readEncryptedBackup } = require('../payments/iphone-backup');
const { verifyPortableRecovery } = require('../payments/collection-activation');
const { backupDigest, pendingEncryptedBackup, replaceEncryptedBackup } = require('../payments/backup-rotation');
const { verifyIphoneBackup } = require('./iphone-backup.cjs');

async function main() {
  const resume = process.argv.length === 3 && process.argv[2] === '--verify-return';
  if (process.argv.length !== 2 && !resume) throw new Error('INVALID_SECURE_BACKUP_OPTIONS');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_TERMINAL_REQUIRED');
  if (process.platform !== 'win32') throw new Error('WINDOWS_BACKUP_HELPER_REQUIRED');
  const walletFile = process.env.TRON_WALLET_PUBLIC_FILE || path.join(__dirname, '..', 'config', 'tron-wallet-public.json');
  const treasury = process.env.TRON_TREASURY_ADDRESS || require('../config/tron-payment-setup.json').treasuryAddress;
  const publicText = await fs.readFile(walletFile, 'utf8');
  const wallet = validateWallet(JSON.parse(publicText), treasury);
  const vault = process.env.TRON_LOCAL_VAULT_FILE || defaultVaultFile(walletFile);
  const source = process.env.TRON_PORTABLE_BACKUP_FILE || vault + '.portable.keystore.json';
  const expectedDigest = backupDigest(await readEncryptedBackup(source));
  console.log('Secure backup only. No network calls, signature, transfer or collection worker.');
  let candidate;
  let encrypted;
  if (resume) {
    candidate = await pendingEncryptedBackup(source);
    encrypted = await readEncryptedBackup(candidate);
    console.log('Resume only: your pending encrypted file and phone copy are preserved. No new password or repeat transfer is needed.');
    console.log('Enter the SAME NEW backup password you chose earlier in the separate masked dialog, not in this terminal.');
    await verifyIphoneBackup({ sourceFile: candidate, passwordContext: 'returned', autoReturnedCopy: true });
  } else {
    console.log('Do NOT type a password in this terminal. Use the TWO fields in the separate TaskMall - Secure Backup window.');
    console.log('Enter a NEW private backup password twice there and click Continue. Never share it in chat.');
    const password = await maskedBackupPassword('new');
    console.log('Private password entry completed. Verifying the existing protected wallet...');
    const secret = await readVault(vault);
    const branch = HDNodeWallet.fromPhrase(secret.mnemonic, '', BRANCH_PATH);
    if (secret.treasuryAddress !== treasury || branch.neuter().extendedKey !== wallet.xpub) throw new Error('BACKUP_WALLET_MISMATCH');
    console.log('Encrypting and checking the new recovery copy. Existing wallet addresses stay unchanged.');
    encrypted = await branch.deriveChild(0).encrypt(password);
    await verifyPortableRecovery(encrypted, password, wallet);
    candidate = source + '.pending-' + crypto.randomBytes(8).toString('hex') + '.keystore.json';
    const file = await fs.open(candidate, 'wx', 0o600);
    try { await file.writeFile(encrypted, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    if (await readEncryptedBackup(candidate) !== encrypted) throw new Error('BACKUP_ROTATION_FAILED');
    console.log('A new encrypted candidate was created. Your existing active backup is unchanged until the phone-copy check passes.');
    console.log('Copy this NEW encrypted file to your iPhone, not a previous file. Keep your new password separately.');
    await verifyIphoneBackup({ sourceFile: candidate, sessionPassword: password });
  }
  if (await fs.readFile(walletFile, 'utf8') !== publicText) throw new Error('PUBLIC_WALLET_CHANGED_DURING_ROTATION');
  if (await readEncryptedBackup(candidate) !== encrypted) throw new Error('BACKUP_CHANGED_DURING_ROTATION');
  const alreadyActive = await readEncryptedBackup(source) === encrypted;
  const archive = alreadyActive ? undefined : (await replaceEncryptedBackup(source, encrypted, expectedDigest)).archive;
  console.log('BACKUP_PASSWORD_CHANGED_PHONE_COPY_VERIFIED');
  console.log('Existing deposit addresses and the protected wallet were not changed.');
  console.log(archive ? 'Previous encrypted backup retained privately for rollback: ' + archive : 'This verified backup is already active; it was not replaced again.');
  console.log('Older copies still use the shared password; re-encryption cannot revoke them. Keep all backups private.');
  console.log('No sending settings were changed. Automatic collection remains OFF.');
}

main().catch(error => {
  const safe = ['INVALID_SECURE_BACKUP_OPTIONS', 'PRIVATE_TERMINAL_REQUIRED', 'WINDOWS_BACKUP_HELPER_REQUIRED',
    'BACKUP_PASSWORD_ENTRY_CANCELLED', 'BACKUP_PASSWORD_DIALOG_TIMED_OUT', 'BACKUP_PASSWORD_DIALOG_FAILED', 'BACKUP_PASSWORD_TOO_WEAK',
    'ENCRYPTED_BACKUP_REQUIRED', 'PORTABLE_RECOVERY_NOT_VERIFIED', 'BACKUP_WALLET_MISMATCH', 'BACKUP_ROTATION_BUSY',
    'BACKUP_ROTATION_FAILED', 'BACKUP_CHANGED_DURING_ROTATION', 'BACKUP_ARCHIVE_CONFLICT', 'PUBLIC_WALLET_CHANGED_DURING_ROTATION',
    'IPHONE_EXPORT_FAILED', 'IPHONE_EXPORT_CONFLICT', 'IPHONE_RETURN_NOT_VERIFIED', 'IPHONE_TRANSFER_CANCELLED',
    'IPHONE_RETURN_SELECTION_CANCELLED', 'IPHONE_BACKUP_DIALOG_FAILED', 'BACKUP_HELPER_TIMED_OUT', 'BACKUP_HELPER_UNAVAILABLE',
    'BACKUP_PASSWORD_NOT_ACCEPTED', 'IPHONE_STORAGE_NOT_CONFIRMED', 'PENDING_BACKUP_NOT_UNIQUE', 'CANCELLED'];
  console.error('Secure backup not completed:', safe.includes(error.message) ? error.message : 'Check the private window and existing protected wallet.');
  console.error('No recovery data was printed. No payment worker was started. Keep existing backups; a phone-copy check is required before replacement.');
  process.exitCode = 1;
});
