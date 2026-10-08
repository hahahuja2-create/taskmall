'use strict';

const path = require('node:path');
const { TronGrid, addressHex } = require('../payments/tron');
const { loadPublicWallet } = require('../payments/wallet-config');
const { trxBalance, tokenBalance } = require('../payments/transactions');
const { railwayOperatorClient } = require('../payments/railway-operator');

async function main() {
  const treasury = process.env.TRON_TREASURY_ADDRESS || require('../config/tron-payment-setup.json').treasuryAddress;
  const wallet = await loadPublicWallet({ treasury, walletFile: process.env.TRON_WALLET_PUBLIC_FILE
    || path.join(__dirname, '..', 'config', 'tron-wallet-public.json'), walletJson: process.env.TRON_WALLET_PUBLIC_JSON });
  const operator = railwayOperatorClient();
  const client = new TronGrid(process.env.TRONGRID_API_KEY);
  const collections = await operator('collections');
  const withdrawals = await operator('withdrawals');
  if (collections.treasury !== treasury || wallet.treasuryAddress !== treasury) throw new Error('TREASURY_CONFIGURATION_MISMATCH');
  const fuel = process.env.TRON_FUEL_ADDRESS;
  if (fuel) addressHex(fuel);
  const fuelBalance = fuel ? Number(await trxBalance(client, fuel)) / 1e6 : null;
  const result = { readOnly: true, railwayOperatorReachable: true, publicWalletVerified: true,
    collectionQueue: collections.collections.length, withdrawalQueue: withdrawals.withdrawals.length,
    backendCollectionFeeCapTrx: collections.feeLimitSun / 1e6, configuredFuelAddress: fuel || null,
    confirmedFuelTrx: fuelBalance, confirmedTreasuryTrx: Number(await trxBalance(client, treasury)) / 1e6,
    confirmedTreasuryUSDT: Number(await tokenBalance(client, treasury)) / 1e6,
    vaultDecrypted: false, transactionSigned: false, transactionBroadcast: false,
    automaticPayoutImplemented: false, collectionActivationRequired: true };
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error('Automation preflight failed:', /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'CONFIGURATION_OR_NETWORK_UNAVAILABLE');
  process.exitCode = 1;
});
