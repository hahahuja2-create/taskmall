'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { TronGrid, validateWallet } = require('../payments/tron');
const { readWorkerStatus, workerStatusFile } = require('../payments/collection-activation');

async function main() {
  const result = { apiKeyConfigured: Boolean(process.env.TRONGRID_API_KEY), networkReachable: false,
    publicWalletVerified: false, depositsReady: false,
    manualWithdrawalAdmissionEnabled: process.env.TRON_MANUAL_WITHDRAWALS_ENABLED === '1',
    collectionSendingConfigured: process.env.TRON_COLLECTION_SEND === '1',
    recoveryRehearsalAcknowledged: process.env.TRON_RECOVERY_VERIFIED === '1' };
  const worker = await readWorkerStatus(workerStatusFile(process.env.TASKMALL_DATA_DIR || path.join(__dirname, '..', 'data')));
  result.collectionWorkerRunning = worker.running;
  result.portableRecoveryVerifiedThisRun = worker.running && worker.recoveryVerified;
  result.collectionSendingEnabled = worker.running;
  try {
    const treasury = process.env.TRON_TREASURY_ADDRESS || require('../config/tron-payment-setup.json').treasuryAddress;
    const file = process.env.TRON_WALLET_PUBLIC_FILE || path.join(__dirname, '..', 'config', 'tron-wallet-public.json');
    validateWallet(JSON.parse(await fs.readFile(file, 'utf8')), treasury);
    result.publicWalletVerified = true;
  } catch { result.walletAction = 'Start the application on the operator Windows computer to provision the protected wallet automatically.'; }
  if (result.apiKeyConfigured) {
    try { await new TronGrid(process.env.TRONGRID_API_KEY).solidHeight(); result.networkReachable = true; }
    catch { result.networkAction = 'Check the backend API key, connectivity and TronGrid quota.'; }
  }
  result.depositsReady = result.publicWalletVerified && result.networkReachable
    && process.env.TASKMALL_SQLITE === '1' && process.env.TRON_DEPOSITS_ENABLED === '1';
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => { console.error('Payment status check failed. No credentials were printed.'); process.exitCode = 1; });
