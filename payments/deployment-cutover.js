'use strict';

const crypto = require('node:crypto');
const { units, validateWallet } = require('./tron');

const emptyLedgerTables = ['deposit_addresses', 'deposits', 'withdrawals', 'collections', 'outgoing_transactions', 'payout_intents', 'payment_audit', 'journal'];
const balanceFields = ['lockedBalance', 'withdrawBalance', 'reservedBalance', 'earnedTotal', 'withdrawnTotal', 'withdrawFeeTotal'];

function validateSnapshot(snapshot) {
  if (snapshot?.version !== 1 || snapshot.source !== 'railway-sqlite' || !Array.isArray(snapshot.state?.users)
    || !Array.isArray(snapshot.state?.tasks) || snapshot.walletRegistered !== false) throw new Error('Invalid zero-funds cutover snapshot.');
  for (const name of emptyLedgerTables) if (snapshot.counts?.[name] !== 0) throw new Error('Financial ledger migration requires a separate reconciliation.');
  for (const user of snapshot.state.users) {
    if (balanceFields.some(field => units(user[field] ?? 0) !== 0n) || user.vipId !== 'free'
      || (user.activities || []).some(item => item.type !== 'welcome')) throw new Error('Existing funded or earned accounts cannot use zero-funds cutover.');
  }
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

async function importZeroFundSnapshot(store, snapshot, wallet, treasury, indexStart) {
  const digest = validateSnapshot(snapshot);
  const verified = validateWallet(wallet, treasury);
  if (!Number.isSafeInteger(indexStart) || indexStart < 0 || indexStart >= 0x80000000) throw new Error('Invalid reserved deposit address range.');
  return store.transaction(async () => {
    const marker = await store.sql.prepare("SELECT value FROM settings WHERE name='deployment_cutover_v1'").get();
    if (marker) {
      const previous = JSON.parse(marker.value);
      if (previous.digest !== digest || previous.fingerprint !== verified.fingerprint || previous.indexStart !== indexStart) throw new Error('Cutover snapshot conflicts with the previous import.');
      return { imported: false, users: snapshot.state.users.length, digest, indexStart };
    }
    const previous = await store.state();
    if (previous?.users?.length) throw new Error('Target already contains accounts; no data was replaced.');
    for (const name of ['users', 'sessions', ...emptyLedgerTables]) {
      const row = await store.sql.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get();
      if (Number(row.n)) throw new Error('Target database is not empty; no data was replaced.');
    }
    for (const name of ['wallet', 'deposit_index_start', 'deposit_allocation_retired']) {
      if (await store.sql.prepare('SELECT value FROM settings WHERE name=?').get(name)) throw new Error('Target wallet has already been configured.');
    }
    await store.saveInside(snapshot.state, 'verified-zero-funds-deployment-cutover');
    await store.execute("INSERT INTO settings VALUES ('wallet',?)", [verified.fingerprint]);
    await store.execute("INSERT INTO settings VALUES ('deposit_index_start',?)", [String(indexStart)]);
    await store.execute("INSERT INTO settings VALUES ('deployment_cutover_v1',?)", [JSON.stringify({ digest, fingerprint: verified.fingerprint, indexStart })]);
    return { imported: true, users: snapshot.state.users.length, digest, indexStart };
  });
}

module.exports = { validateSnapshot, importZeroFundSnapshot, emptyLedgerTables };
