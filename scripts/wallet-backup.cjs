'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { HDNodeWallet, Wallet } = require('ethers');
const { defaultVaultFile, readVault } = require('../payments/vault');
const { hiddenPassword } = require('../payments/private-terminal');

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this backup tool only in your private local terminal, never through chat, logs or automation.');
  const passphrase = await hiddenPassword('New offline backup password (minimum 16 characters, input hidden): ');
  const confirmed = await hiddenPassword('Confirm backup password (input hidden): ');
  if (passphrase.length < 16) throw new Error('BACKUP_PASSWORD_TOO_SHORT');
  if (passphrase !== confirmed) throw new Error('BACKUP_PASSWORDS_DO_NOT_MATCH');
  const walletFile = process.env.TRON_WALLET_PUBLIC_FILE || path.join(__dirname, '..', 'config', 'tron-wallet-public.json');
  const vaultFile = process.env.TRON_LOCAL_VAULT_FILE || defaultVaultFile(walletFile);
  const secret = await readVault(vaultFile);
  const firstWallet = HDNodeWallet.fromPhrase(secret.mnemonic, '', `${secret.branchPath}/0`);
  const encrypted = await firstWallet.encrypt(passphrase);
  const restored = await Wallet.fromEncryptedJson(encrypted, passphrase);
  if (!restored.mnemonic || restored.mnemonic.phrase !== secret.mnemonic || restored.address !== firstWallet.address) throw new Error('Encrypted backup verification failed.');
  const file = process.env.TRON_PORTABLE_BACKUP_FILE || `${vaultFile}.portable.keystore.json`;
  await fs.writeFile(file, encrypted, { flag: 'wx', mode: 0o600 });
  console.log(`Encrypted portable backup saved: ${path.resolve(file)}`);
  console.log('Keep it offline and its password separately. Never send the file or password in chat.');
}
if (require.main === module) main().catch(() => { console.error('Backup was not completed. Use a private local terminal and matching strong passwords; existing backups are not overwritten.'); process.exitCode = 1; });
module.exports = { createPortableBackup: main };
