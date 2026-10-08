'use strict';

const path = require('node:path');
const { TronGrid } = require('../payments/tron');
const { loadPublicWallet } = require('../payments/wallet-config');
const { readWorkerStatus, workerStatusFile } = require('../payments/collection-activation');

async function main() {
  const result = { apiKeyConfigured: Boolean(process.env.TRONGRID_API_KEY), networkReachable: false,
    publicWalletVerified: false, depositsReady: false,
    transactionalStorageConfigured: Boolean(process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.TASKMALL_SQLITE === '1'),
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
    await loadPublicWallet({ walletFile: file, walletJson: process.env.TRON_WALLET_PUBLIC_JSON, treasury });
    result.publicWalletVerified = true;
  } catch { result.walletAction = 'Configure the verified signed public wallet using TRON_WALLET_PUBLIC_JSON or TRON_WALLET_PUBLIC_FILE. Do not deploy recovery data.'; }
  if (result.apiKeyConfigured) {
    try { await new TronGrid(process.env.TRONGRID_API_KEY).solidHeight(); result.networkReachable = true; }
    catch { result.networkAction = 'Check the backend API key, connectivity and TronGrid quota.'; }
  }
  result.depositsReady = result.publicWalletVerified && result.networkReachable
    && result.transactionalStorageConfigured && process.env.TRON_DEPOSITS_ENABLED === '1';
  result.note = 'Configuration and RPC checks only; check the running application for storage and operator readiness.';
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => { console.error('Payment status check failed. No credentials were printed.'); process.exitCode = 1; });
