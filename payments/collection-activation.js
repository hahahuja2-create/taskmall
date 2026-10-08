'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { HDNodeWallet, Wallet, isError } = require('ethers');
const { BRANCH_PATH, tronAddress, deriveAddress } = require('./tron');
const { boundedSun, trxBalance } = require('./transactions');
const { dailyLimit } = require('./collector');
const { hiddenPassword } = require('./private-terminal');
const { copyBackupToUsb } = require('./offline-backup');

function validateCollectionLimits(feeLimit, feeDailyLimit, gasDailyLimit, serverFeeLimit, gasEnabled = true) {
  boundedSun(feeLimit, 'collection Energy limit');
  boundedSun(serverFeeLimit, 'backend collection limit');
  const fees = dailyLimit(feeDailyLimit, 'daily collection Energy limit');
  const gas = gasEnabled ? dailyLimit(gasDailyLimit, 'daily TRX funding limit') : 0n;
  if (feeLimit > serverFeeLimit) throw new Error('COLLECTION_LIMIT_EXCEEDS_BACKEND_CAP');
  if (fees < BigInt(feeLimit) || (gasEnabled && gas < BigInt(feeLimit) + 3_000_000n)) throw new Error('COLLECTION_DAILY_LIMIT_TOO_SMALL');
  return { feeLimit, feeDailyLimit: fees.toString(), gasDailyLimit: gas.toString(), gasEnabled };
}

async function verifyPortableRecovery(encrypted, passphrase, wallet, { detailedErrors = false } = {}) {
  try {
    if (Buffer.byteLength(encrypted) > 1_000_000) throw new Error('Oversized backup.');
    const recovered = await Wallet.fromEncryptedJson(encrypted, passphrase);
    if (!recovered.mnemonic || recovered.path !== BRANCH_PATH + '/0'
      || tronAddress(recovered.address.slice(2)) !== deriveAddress(wallet.xpub, 0)) throw new Error('BACKUP_WALLET_MISMATCH');
    const branch = HDNodeWallet.fromPhrase(recovered.mnemonic.phrase, recovered.mnemonic.password, BRANCH_PATH);
    if (branch.neuter().extendedKey !== wallet.xpub) throw new Error('BACKUP_WALLET_MISMATCH');
    return { backupDigest: crypto.createHash('sha256').update(encrypted).digest('hex'),
      fuelAddress: tronAddress(HDNodeWallet.fromPhrase(recovered.mnemonic.phrase, recovered.mnemonic.password, "m/44'/195'/1'/0/0").address.slice(2)) };
  } catch (error) {
    if (detailedErrors === true) {
      if (isError(error, 'INVALID_ARGUMENT') && error.argument === 'password') throw new Error('BACKUP_PASSWORD_NOT_ACCEPTED');
      if (error.message === 'BACKUP_WALLET_MISMATCH') throw new Error('BACKUP_WALLET_MISMATCH');
    }
    throw new Error('PORTABLE_RECOVERY_NOT_VERIFIED');
  }
}

async function prepareCollectionActivation({ wallet, treasury, vaultFile, gasWallet, client, operator, guided, copyBackup = false, localBackup = false }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_TERMINAL_REQUIRED');
  const remote = await operator('collections');
  if (remote.treasury !== treasury) throw new Error('TREASURY_CONFIGURATION_MISMATCH');
  const limits = validateCollectionLimits(Number(process.env.TRON_COLLECTION_FEE_LIMIT_SUN),
    process.env.TRON_COLLECTION_DAILY_FEE_LIMIT_SUN, process.env.TRON_GAS_DAILY_LIMIT_SUN, remote.feeLimitSun,
    guided || process.env.TRON_GAS_FUNDING_ENABLED === '1');
  const file = process.env.TRON_PORTABLE_BACKUP_FILE || vaultFile + '.portable.keystore.json';
  try { await fs.access(file); }
  catch (error) {
    if (error.code !== 'ENOENT' || !guided) throw new Error('PORTABLE_BACKUP_REQUIRED');
    console.log('Create your encrypted recovery backup locally. No seed or password is sent to TaskMall.');
    await require('../scripts/wallet-backup.cjs').createPortableBackup();
  }
  console.log('Portable encrypted backup:', path.resolve(file));
  console.log('Keep an offline copy separately from its password. Never send either in chat.');
  let encrypted;
  if (localBackup) {
    console.log('Local backup preparation only. This is NOT an offline copy and does NOT authorize transfers.');
    encrypted = await fs.readFile(file, 'utf8');
  } else if (copyBackup) {
    console.log('Select a USB folder in the private window. Only the encrypted backup will be copied.');
    const offline = await copyBackupToUsb(file);
    encrypted = offline.encrypted;
    console.log('Encrypted USB copy verified:', offline.file);
    console.log('Recovery will be checked from this USB copy, not just the file on this computer.');
  } else {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (await prompt.question('After storing an offline copy, type OFFLINE to continue: ') !== 'OFFLINE') throw new Error('CANCELLED');
    } finally { prompt.close(); }
    encrypted = await fs.readFile(file, 'utf8');
  }
  const passphrase = await hiddenPassword('Offline backup password for recovery verification (input hidden): ');
  const recovery = await verifyPortableRecovery(encrypted, passphrase, wallet);
  if (recovery.fuelAddress !== gasWallet.address) throw new Error('PORTABLE_RECOVERY_NOT_VERIFIED');
  console.log(localBackup ? 'LOCAL_BACKUP_VERIFIED_OFFLINE_COPY_PENDING' : 'Recovery verified against the existing deposit wallet and TRX fuel account.');
  console.log('Dedicated TRX fuel address:', gasWallet.address);
  const balance = await trxBalance(client, gasWallet.address);
  console.log('Confirmed TRX fuel balance:', Number(balance) / 1e6);
  if (limits.gasEnabled) console.log('Minimum conservative startup TRX fuel reserve:', (limits.feeLimit + 3_000_000) / 1e6);
  if (localBackup) {
    console.log('Before funding or collection, keep a verified offline backup on separate storage with the password stored separately.');
    console.log('Use npm run collections:prepare for USB, or npm run wallet:iphone for an iPhone copy and return check.');
    return { ...limits, recoveryVerified: false, localBackupVerified: true };
  }
  if (limits.gasEnabled && balance < BigInt(limits.feeLimit) + 3_000_000n) {
    console.log('Setup is waiting for TRX fuel. No automatic signing or sending has started.');
    console.log('After recovery verification, use your own TronLink to fund the TRX-only fuel address above on TRON Mainnet.');
    console.log('Do not send USDT to the fuel address. The reserve is not a fixed network fee.');
    throw new Error('GAS_WALLET_REQUIRES_TRX');
  }
  return { ...limits, recoveryVerified: true };
}

function workerStatusFile(data) { return path.join(data, 'collection-worker-status.json'); }

async function writeWorkerStatus(file, status) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  await fs.writeFile(temporary, JSON.stringify({ ...status, pid: process.pid, lastHeartbeat: Date.now() }), { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function readWorkerStatus(file, now = Date.now()) {
  try {
    const status = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Number.isInteger(status.pid) || status.pid < 1 || status.state !== 'running'
      || !Number.isSafeInteger(status.lastHeartbeat) || status.lastHeartbeat > now + 5000 || status.lastHeartbeat < now - 120_000) return { running: false };
    process.kill(status.pid, 0);
    return { running: true, recoveryVerified: status.recoveryVerified === true, lastHeartbeat: status.lastHeartbeat };
  } catch { return { running: false }; }
}

module.exports = { validateCollectionLimits, verifyPortableRecovery, prepareCollectionActivation,
  workerStatusFile, writeWorkerStatus, readWorkerStatus };
