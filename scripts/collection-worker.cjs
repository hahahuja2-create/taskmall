'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const { HDNodeWallet } = require('ethers');
const { BRANCH_PATH, tronAddress, validateWallet, TronGrid } = require('../payments/tron');
const { defaultVaultFile, readVault } = require('../payments/vault');
const { loadOperatorToken, operatorClient } = require('../payments/operator');
const { CollectionWorker, SignerJournal } = require('../payments/collector');
const { trxBalance } = require('../payments/transactions');
const { prepareCollectionActivation, workerStatusFile, writeWorkerStatus } = require('../payments/collection-activation');

async function main() {
  const options = new Set(['--run', '--fuel-address', '--setup', '--preflight', '--copy-backup', '--local-backup']);
  if (process.argv.slice(2).some(argument => !options.has(argument))) throw new Error('INVALID_WORKER_OPTIONS');
  const running = process.argv.includes('--run');
  const fuelAddress = process.argv.includes('--fuel-address');
  const guided = process.argv.includes('--setup');
  const preflight = process.argv.includes('--preflight');
  const copyBackup = process.argv.includes('--copy-backup');
  const localBackup = process.argv.includes('--local-backup');
  if (((running || guided) && (fuelAddress || preflight)) || (fuelAddress && preflight) || (copyBackup && !guided)
    || (localBackup && (!guided || running || copyBackup))) throw new Error('INVALID_WORKER_OPTIONS');
  if ((running || guided) && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('PRIVATE_TERMINAL_REQUIRED');
  const data = process.env.TASKMALL_DATA_DIR || path.join(__dirname, '..', 'data');
  const token = await loadOperatorToken(process.env.TASKMALL_OPERATOR_TOKEN_FILE || path.join(data, 'operator.token'));
  const operator = operatorClient(process.env.TASKMALL_OPERATOR_ORIGIN || 'http://127.0.0.1:' + (process.env.PORT || 4173), token);
  const treasury = process.env.TRON_TREASURY_ADDRESS || require('../config/tron-payment-setup.json').treasuryAddress;
  const walletFile = process.env.TRON_WALLET_PUBLIC_FILE || path.join(__dirname, '..', 'config', 'tron-wallet-public.json');
  const wallet = validateWallet(JSON.parse(await fs.readFile(walletFile, 'utf8')), treasury);
  if (!running && !guided && !fuelAddress && !preflight) {
    const result = await operator('collections');
    console.log(JSON.stringify({ sendingEnabled: false, treasury, pendingCollections: result.collections.length,
      message: 'Read-only mode. No vault decryption, signing or broadcast was performed.' }, null, 2));
    return;
  }
  if (running && !guided && (process.env.TRON_COLLECTION_SEND !== '1' || process.env.TRON_RECOVERY_VERIFIED !== '1')) throw new Error('COLLECTION_NOT_AUTHORIZED');
  const vaultFile = process.env.TRON_LOCAL_VAULT_FILE || defaultVaultFile(walletFile);
  const secret = await readVault(vaultFile);
  if (secret.treasuryAddress !== treasury) throw new Error('Protected wallet treasury mismatch.');
  const branch = HDNodeWallet.fromPhrase(secret.mnemonic, '', BRANCH_PATH);
  if (branch.neuter().extendedKey !== wallet.xpub) throw new Error('Protected wallet does not match the public wallet.');
  const gasKey = HDNodeWallet.fromPhrase(secret.mnemonic, '', "m/44'/195'/1'/0/0");
  const gasWallet = { address: tronAddress(gasKey.address.slice(2)), privateKey: gasKey.privateKey.slice(2) };
  if (fuelAddress) { console.log('Dedicated TRX fuel address:', gasWallet.address); console.log('Use this address for TRX fuel only, not customer USDT deposits.'); return; }
  const client = new TronGrid(process.env.TRONGRID_API_KEY);
  if (preflight) {
    let portableBackupPresent = false;
    try { await fs.access(process.env.TRON_PORTABLE_BACKUP_FILE || vaultFile + '.portable.keystore.json'); portableBackupPresent = true; } catch {}
    const remote = await operator('collections');
    console.log(JSON.stringify({ treasury, fuelAddress: gasWallet.address, fuelBalanceTrx: Number(await trxBalance(client, gasWallet.address)) / 1e6,
      portableBackupPresent, backendFeeLimitTrx: Number(remote.feeLimitSun) / 1e6,
      collectionEnergyLimitTrx: Number(process.env.TRON_COLLECTION_FEE_LIMIT_SUN) / 1e6,
      dailyEnergyLimitTrx: Number(process.env.TRON_COLLECTION_DAILY_FEE_LIMIT_SUN || 0) / 1e6,
      dailyFundingLimitTrx: Number(process.env.TRON_GAS_DAILY_LIMIT_SUN || 0) / 1e6,
      message: 'Read-only preflight. No signature, collection plan, funding or broadcast was performed.' }, null, 2));
    return;
  }
  const limits = await prepareCollectionActivation({ wallet, treasury, vaultFile, gasWallet, client, operator, guided, copyBackup, localBackup });
  if (!running) {
    console.log(localBackup ? 'LOCAL_PREPARATION_ONLY: encrypted local backup verified; offline copy and fuel checks remain launch gates.'
      : 'PREPARATION_COMPLETE: recovery and fuel checks passed.');
    console.log('No signature, collection plan or broadcast was performed. Automatic collection is NOT running.');
    if (!localBackup) console.log('Start it yourself with npm run collections:enable after reviewing its limits.');
    return;
  }
  if (!limits.recoveryVerified) throw new Error('PORTABLE_RECOVERY_NOT_VERIFIED');
  console.log('Automatic USDT collection destination:', treasury);
  console.log('Maximum Energy fee per collection (TRX):', limits.feeLimit / 1e6);
  console.log('Maximum daily Energy reservations (TRX):', Number(limits.feeDailyLimit) / 1e6);
  console.log('Automatic TRX funding:', limits.gasEnabled);
  console.log('Maximum daily TRX funding with its reserve (TRX):', Number(limits.gasDailyLimit) / 1e6);
  console.log('These are conservative reservations, not fee estimates. Bandwidth is separate. Ctrl+C stops new transfers.');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { if (await prompt.question('Type the full treasury address to authorize automatic transfers with these limits: ') !== treasury) throw new Error('CANCELLED'); }
  finally { prompt.close(); }
  const journal = new SignerJournal(vaultFile + '.signer');
  const statusFile = workerStatusFile(data);
  let heartbeatQueue = Promise.resolve();
  const heartbeat = state => {
    const next = heartbeatQueue.then(() => writeWorkerStatus(statusFile, { state, treasury, recoveryVerified: limits.recoveryVerified,
      feeLimitSun: limits.feeLimit, feeDailyLimitSun: limits.feeDailyLimit, gasDailyLimitSun: limits.gasDailyLimit }));
    heartbeatQueue = next.catch(() => {});
    return next;
  };
  let stopped = false;
  let wake;
  let heartbeatTimer;
  const stop = () => { stopped = true; wake?.(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const worker = new CollectionWorker({ operator, client, wallet, treasury, branch, gasWallet, journal, ...limits, shouldStop: () => stopped });
    await heartbeat('running');
    heartbeatTimer = setInterval(() => { heartbeat('running').catch(() => { console.error('Status storage unavailable; collection paused.'); stop(); }); }, 30_000);
    heartbeatTimer.unref();
    console.log('Collection worker authorized and running.');
    while (!stopped) {
      try { for (const result of await worker.cycle()) console.log(result.id, result.status); }
      catch { console.error('Collection cycle paused. Check connectivity and operator configuration.'); }
      if (!stopped) await new Promise(resolve => { const timer = setTimeout(resolve, 30_000); wake = () => { clearTimeout(timer); resolve(); }; });
    }
  } finally { clearInterval(heartbeatTimer); journal.close(); await heartbeat('stopped'); }
}
main().catch(error => {
  const safe = ['GAS_WALLET_REQUIRES_TRX', 'PORTABLE_RECOVERY_NOT_VERIFIED', 'PORTABLE_BACKUP_REQUIRED', 'PRIVATE_TERMINAL_REQUIRED',
    'COLLECTION_NOT_AUTHORIZED', 'COLLECTION_LIMIT_EXCEEDS_BACKEND_CAP', 'COLLECTION_DAILY_LIMIT_TOO_SMALL',
    'OFFLINE_BACKUP_COPY_NOT_VERIFIED', 'WINDOWS_USB_BACKUP_REQUIRED', 'INVALID_WORKER_OPTIONS',
    'BACKUP_PASSWORD_TOO_SHORT', 'BACKUP_PASSWORDS_DO_NOT_MATCH', 'CANCELLED'];
  console.error('Collection worker not started:', safe.includes(error.message) ? error.message : 'Check private terminal, recovery, treasury and fee/gas limits.');
  if (error.message === 'BACKUP_PASSWORD_TOO_SHORT') console.error('Use a new private backup password with at least 16 characters.');
  if (error.message === 'BACKUP_PASSWORDS_DO_NOT_MATCH') console.error('The two backup password entries must match. Reopen the setup window to retry.');
  console.error('No recovery data was printed.');
  process.exitCode = 1;
});
