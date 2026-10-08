'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateWallet } = require('../payments/tron');
const { defaultVaultFile } = require('../payments/vault');
const { maskedBackupPassword } = require('../payments/private-terminal');
const { privateBackupHelper } = require('../payments/offline-backup');
const { readEncryptedBackup, prepareIphoneExport, verifyIphoneReturn, findIphoneReturn } = require('../payments/iphone-backup');
const { verifyPortableRecovery } = require('../payments/collection-activation');

async function checkPassword(encrypted, wallet, context) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = await maskedBackupPassword(attempt ? 'retry' : context);
    try {
      const recovered = await verifyPortableRecovery(encrypted, password, wallet, { detailedErrors: true });
      return { password, recovered };
    } catch (error) {
      if (error.message !== 'BACKUP_PASSWORD_NOT_ACCEPTED' || attempt === 2) throw error;
      console.log('Password did not unlock this backup. Check your original backup password and keyboard language in the private dialog.');
    }
  }
}

async function main({ sourceFile, sessionPassword, passwordContext = 'original', autoReturnedCopy = false } = {}) {
  const resume = process.argv.length === 3 && process.argv[2] === '--verify-return';
  if (process.argv.length !== 2 && !resume) throw new Error('INVALID_IPHONE_BACKUP_OPTIONS');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_TERMINAL_REQUIRED');
  if (process.platform !== 'win32') throw new Error('WINDOWS_BACKUP_HELPER_REQUIRED');
  const walletFile = process.env.TRON_WALLET_PUBLIC_FILE || path.join(__dirname, '..', 'config', 'tron-wallet-public.json');
  const treasury = process.env.TRON_TREASURY_ADDRESS || require('../config/tron-payment-setup.json').treasuryAddress;
  const wallet = validateWallet(JSON.parse(await fs.readFile(walletFile, 'utf8')), treasury);
  const vault = process.env.TRON_LOCAL_VAULT_FILE || defaultVaultFile(walletFile);
  const source = sourceFile || process.env.TRON_PORTABLE_BACKUP_FILE || vault + '.portable.keystore.json';
  const encrypted = await readEncryptedBackup(source);
  console.log('Preparation only: no signature, collection plan, broadcast or automatic sending.');
  let password = sessionPassword;
  if (password === undefined) {
    console.log(passwordContext === 'returned' ? 'Enter the SAME NEW backup password you chose earlier in the private masked dialog.'
      : 'Enter your ORIGINAL encrypted backup password in the private masked dialog, not your TaskMall account password.');
    ({ password } = await checkPassword(encrypted, wallet, passwordContext));
  } else {
    await verifyPortableRecovery(encrypted, password, wallet, { detailedErrors: true });
  }
  const transfer = await prepareIphoneExport(source, path.join(path.dirname(vault), 'iphone-transfer'));
  if (resume) console.log('Select the already returned encrypted copy in:', transfer.incoming);
  else {
    console.log('Encrypted file to transfer:', transfer.file);
    console.log('Save a copy BACK from the iPhone to:', transfer.incoming);
  }
  console.log('Only the encrypted file is exported. Neither a seed nor password is sent to the phone helper.');
  if (resume) console.log('Resume verification only: select the file already saved BACK from your iPhone. No repeat phone transfer is required.');
  let returnedFile;
  if (resume && autoReturnedCopy) returnedFile = await findIphoneReturn(transfer);
  if (!returnedFile) {
    const result = await privateBackupHelper('iphone-copy.ps1', {
      TASKMALL_IPHONE_OUTGOING: transfer.outgoing, TASKMALL_IPHONE_INCOMING: transfer.incoming,
      TASKMALL_IPHONE_MODE: resume ? 'verify-return' : 'transfer'
    });
    if (result.status !== 'selected') {
      const reasons = ['IPHONE_TRANSFER_CANCELLED', 'IPHONE_RETURN_SELECTION_CANCELLED', 'IPHONE_BACKUP_DIALOG_FAILED'];
      throw new Error(reasons.includes(result.reason) ? result.reason : 'IPHONE_RETURN_NOT_VERIFIED');
    }
    returnedFile = result.file;
  }
  const returned = await verifyIphoneReturn(transfer, returnedFile);
  const recovered = resume || sessionPassword !== undefined ? await verifyPortableRecovery(returned, password, wallet, { detailedErrors: true })
    : (await checkPassword(returned, wallet, 'returned')).recovered;
  console.log('Recovery matches. Confirm actual local phone storage in the separate iPhone confirmation dialog.');
  const confirmation = await privateBackupHelper('iphone-confirm.ps1', {});
  if (confirmation.status !== 'confirmed') throw new Error('IPHONE_STORAGE_NOT_CONFIRMED');
  if (await verifyIphoneReturn(transfer, returnedFile) !== returned) throw new Error('IPHONE_RETURN_NOT_VERIFIED');
  console.log('IPHONE_RETURNED_BACKUP_VERIFIED: exact file bytes and recovery match the existing deposit wallet.');
  console.log('Phone storage location is operator-confirmed, not automatically detected. This is not a cold hardware wallet.');
  console.log('Recovered public TRX fuel address:', recovered.fuelAddress);
  console.log('Automatic collection is NOT running. No sending or recovery-authorization settings were changed.');
  return recovered;
}

if (require.main === module) main().catch(error => {
  const safe = ['INVALID_IPHONE_BACKUP_OPTIONS', 'PRIVATE_TERMINAL_REQUIRED', 'WINDOWS_BACKUP_HELPER_REQUIRED', 'ENCRYPTED_BACKUP_REQUIRED',
    'PORTABLE_RECOVERY_NOT_VERIFIED', 'IPHONE_EXPORT_FAILED', 'IPHONE_EXPORT_CONFLICT', 'IPHONE_RETURN_NOT_VERIFIED',
    'IPHONE_TRANSFER_CANCELLED', 'IPHONE_RETURN_SELECTION_CANCELLED', 'IPHONE_BACKUP_DIALOG_FAILED',
    'BACKUP_HELPER_TIMED_OUT', 'BACKUP_HELPER_UNAVAILABLE', 'BACKUP_PASSWORD_NOT_ACCEPTED', 'BACKUP_WALLET_MISMATCH',
    'BACKUP_PASSWORD_ENTRY_CANCELLED', 'BACKUP_PASSWORD_DIALOG_TIMED_OUT', 'BACKUP_PASSWORD_DIALOG_FAILED', 'IPHONE_STORAGE_NOT_CONFIRMED', 'CANCELLED'];
  console.error('iPhone backup not completed:', safe.includes(error.message) ? error.message : 'Check the private window, existing backup and Apple file transfer.');
  if (['IPHONE_TRANSFER_CANCELLED', 'IPHONE_RETURN_SELECTION_CANCELLED', 'BACKUP_HELPER_TIMED_OUT'].includes(error.message)) {
    console.error('An existing phone/returned file was not deleted. Reopen TaskMall Verify iPhone Backup to continue the check privately.');
  }
  if (error.message === 'IPHONE_RETURN_NOT_VERIFIED') console.error('Select the independent copy saved BACK from the iPhone, not the To-iPhone original. The hashes must match.');
  if (error.message === 'BACKUP_PASSWORD_NOT_ACCEPTED') console.error('This password cannot unlock the backup. Check the ORIGINAL backup password and keyboard language. Do not share it or create a replacement wallet.');
  if (error.message === 'BACKUP_WALLET_MISMATCH') console.error('The decrypted backup does not match the existing deposit wallet. Keep all original files and stop; no replacement wallet was created.');
  console.error('No recovery data was printed. No transfer worker was started.');
  process.exitCode = 1;
});

module.exports = { verifyIphoneBackup: main };
