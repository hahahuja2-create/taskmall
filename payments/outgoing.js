'use strict';

const crypto = require('node:crypto');
const { units, amount, addressHex, decodeTransfers } = require('./tron');

const MINIMUM_WITHDRAWAL_USDT = 10;

function failure(code, status = 409) { return Object.assign(new Error(code), { status }); }
function transactionId(txid) { if (!/^[0-9a-f]{64}$/.test(txid)) throw failure('INVALID_TRANSACTION', 400); return txid; }

class OutgoingLedger {
  constructor(store, treasury) {
    this.store = store;
    this.sql = store.sql;
    this.treasury = treasury;
    addressHex(treasury);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS withdrawals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        request_key TEXT NOT NULL, destination TEXT NOT NULL, gross_units TEXT NOT NULL,
        fee_units TEXT NOT NULL, net_units TEXT NOT NULL, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, txid TEXT UNIQUE, issue TEXT,
        UNIQUE(user_id,request_key));
      CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, address TEXT NOT NULL,
        address_index INTEGER NOT NULL, treasury TEXT NOT NULL, amount_units TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, txid TEXT UNIQUE, issue TEXT);
      DROP INDEX IF EXISTS collection_inflight;
      CREATE UNIQUE INDEX collection_inflight ON collections(address) WHERE status NOT IN ('confirmed','cancelled');
      CREATE TABLE IF NOT EXISTS outgoing_transactions (txid TEXT PRIMARY KEY, kind TEXT NOT NULL,
        job_id TEXT NOT NULL UNIQUE, payload TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS payout_intents (job_id TEXT PRIMARY KEY REFERENCES withdrawals(id),
        txid TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, fee_limit INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS payment_audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL,
        action TEXT NOT NULL, job_id TEXT NOT NULL, at INTEGER NOT NULL);`);
  }

  audit(actor, action, id) {
    this.sql.prepare('INSERT INTO payment_audit(actor,action,job_id,at) VALUES (?,?,?,?)').run(actor, action, id, Date.now());
  }

  withdrawals(userId) {
    return this.sql.prepare(userId ? 'SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT 200').all(...(userId ? [userId] : []));
  }

  withdrawal(id) { return this.sql.prepare('SELECT * FROM withdrawals WHERE id=?').get(id); }

  request(state, userId, { key, destination, gross }) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw failure('INVALID_REQUEST_KEY', 400);
    try { addressHex(destination); } catch { throw failure('INVALID_WALLET', 400); }
    const value = units(gross);
    if (value <= 0n || value > 100_000_000_000n) throw failure('INVALID_AMOUNT', 400);
    return this.store.transaction(() => {
      const previous = this.sql.prepare('SELECT * FROM withdrawals WHERE user_id=? AND request_key=?').get(userId, key);
      if (previous) {
        if (previous.destination !== destination || previous.gross_units !== value.toString()) throw failure('REQUEST_KEY_CONFLICT');
        return { record: previous, changed: false };
      }
      if (value < units(MINIMUM_WITHDRAWAL_USDT)) throw failure('WITHDRAWAL_BELOW_MINIMUM', 400);
      const user = state.users.find(item => item.id === userId);
      if (!user || units(user.withdrawBalance) < value) throw failure('INSUFFICIENT_WITHDRAW_BALANCE', 400);
      const fee = (value + 5n) / 10n;
      const id = crypto.randomUUID();
      const now = Date.now();
      user.withdrawBalance = amount(units(user.withdrawBalance) - value);
      user.reservedBalance = amount(units(user.reservedBalance || 0) + value);
      user.activities.unshift({ id, type: 'withdraw', amount: amount(value), fee: amount(fee), netAmount: amount(value - fee),
        network: 'USDT TRC20', wallet: destination, status: 'requested', at: new Date(now).toISOString() });
      this.sql.prepare('INSERT INTO withdrawals VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(id, userId, key, destination,
        value.toString(), fee.toString(), (value - fee).toString(), 'requested', now, now);
      this.store.saveInside(state, 'withdrawal-reservation');
      this.audit(userId, 'withdrawal-requested', id);
      return { record: this.withdrawal(id), changed: true };
    });
  }

  decide(state, id, decision) {
    if (!['approve', 'reject'].includes(decision)) throw failure('INVALID_DECISION', 400);
    return this.store.transaction(() => {
      const record = this.withdrawal(id);
      if (!record) throw failure('WITHDRAWAL_NOT_FOUND', 404);
      const status = decision === 'approve' ? 'approved' : 'rejected';
      if (record.status === status) return { record, changed: false };
      // Once approved, a transfer may already have been signed outside this application.
      if (record.status !== 'requested') throw failure('WITHDRAWAL_ALREADY_IN_PROGRESS');
      const user = state.users.find(item => item.id === record.user_id);
      if (!user) throw failure('ACCOUNT_NOT_FOUND');
      if (decision === 'reject') {
        user.withdrawBalance = amount(units(user.withdrawBalance) + BigInt(record.gross_units));
        user.reservedBalance = amount(units(user.reservedBalance) - BigInt(record.gross_units));
      }
      const activity = user.activities.find(item => item.id === id);
      if (activity) activity.status = status;
      this.sql.prepare('UPDATE withdrawals SET status=?,updated_at=? WHERE id=?').run(status, Date.now(), id);
      this.store.saveInside(state, 'withdrawal-' + status);
      this.audit('operator', 'withdrawal-' + status, id);
      return { record: this.withdrawal(id), changed: true };
    });
  }

  withdrawalIntent(id) { return this.sql.prepare('SELECT * FROM payout_intents WHERE job_id=?').get(id); }

  prepareWithdrawal(id, transaction, feeLimit, validate) {
    return this.store.transaction(() => {
      const record = this.withdrawal(id);
      if (!record) throw failure('WITHDRAWAL_NOT_FOUND', 404);
      if (record.status !== 'approved') throw failure('WITHDRAWAL_NOT_APPROVED');
      const previous = this.withdrawalIntent(id);
      if (previous) {
        if (previous.fee_limit !== feeLimit) throw failure('PAYOUT_FEE_LIMIT_ALREADY_FIXED');
        return previous;
      }
      validate(transaction, record);
      this.sql.prepare('INSERT INTO payout_intents VALUES (?,?,?,?,?)').run(id, transaction.txID,
        JSON.stringify(transaction), feeLimit, Date.now());
      this.audit('operator', 'withdrawal-transaction-prepared', id);
      return this.withdrawalIntent(id);
    });
  }

  signedWithdrawal(id) {
    const row = this.sql.prepare("SELECT payload FROM outgoing_transactions WHERE kind='withdrawal' AND job_id=?").get(id);
    return row?.payload ? JSON.parse(row.payload) : null;
  }

  recordSignedWithdrawal(state, id, transaction, validate) {
    const intent = this.withdrawalIntent(id);
    const record = this.withdrawal(id);
    if (!intent || !record) throw failure('PAYOUT_NOT_PREPARED');
    validate(transaction, record, intent.fee_limit);
    const prepared = JSON.parse(intent.payload);
    if (transaction.txID !== intent.txid || transaction.raw_data_hex !== prepared.raw_data_hex) throw failure('PAYOUT_INTENT_MISMATCH');
    if (record.txid === transaction.txID && !this.signedWithdrawal(id)) throw failure('PAYOUT_SIGNATURE_NOT_RECORDED');
    return this.submitWithdrawal(state, id, transaction.txID, transaction);
  }

  submitWithdrawal(state, id, txid, transaction = null) {
    transactionId(txid);
    return this.store.transaction(() => {
      const record = this.withdrawal(id);
      if (!record) throw failure('WITHDRAWAL_NOT_FOUND', 404);
      if (record.txid === txid) return record;
      if (record.status !== 'approved') throw failure('WITHDRAWAL_NOT_APPROVED');
      const intent = this.withdrawalIntent(id);
      if (intent && intent.txid !== txid) throw failure('PAYOUT_INTENT_MISMATCH');
      if (this.sql.prepare('SELECT 1 FROM outgoing_transactions WHERE txid=?').get(txid)) throw failure('TRANSACTION_ALREADY_USED');
      this.sql.prepare('INSERT INTO outgoing_transactions VALUES (?,?,?,?,?)').run(txid, 'withdrawal', id,
        transaction ? JSON.stringify(transaction) : null, Date.now());
      this.sql.prepare("UPDATE withdrawals SET status='submitted',txid=?,updated_at=? WHERE id=?").run(txid, Date.now(), id);
      const user = state.users.find(item => item.id === record.user_id);
      const activity = user?.activities.find(item => item.id === id);
      if (activity) { activity.status = 'submitted'; activity.txid = txid; }
      this.store.saveInside(state, 'withdrawal-submitted');
      this.audit('operator', 'withdrawal-submitted', id);
      if (transaction) this.audit('tronlink', 'withdrawal-signed-before-broadcast', id);
      return this.withdrawal(id);
    });
  }

  settleWithdrawal(state, record, events) {
    const transfers = events.filter(item => item.txid === record.txid && item.from === this.treasury && item.to === record.destination);
    if (transfers.length !== 1 || transfers[0].units !== record.net_units || transfers[0].timestamp < record.created_at - 60_000) throw failure('PAYOUT_RECEIPT_MISMATCH');
    return this.store.transaction(() => {
      const saved = this.withdrawal(record.id);
      if (saved.status === 'confirmed') return false;
      if (saved.status !== 'submitted' || saved.txid !== record.txid) throw failure('WITHDRAWAL_STATE_CHANGED');
      const user = state.users.find(item => item.id === saved.user_id);
      if (!user) throw failure('ACCOUNT_NOT_FOUND');
      user.reservedBalance = amount(units(user.reservedBalance) - BigInt(saved.gross_units));
      user.withdrawnTotal = amount(units(user.withdrawnTotal || 0) + BigInt(saved.net_units));
      user.withdrawFeeTotal = amount(units(user.withdrawFeeTotal || 0) + BigInt(saved.fee_units));
      const activity = user.activities.find(item => item.id === record.id);
      if (activity) { activity.status = 'confirmed'; activity.txid = record.txid; }
      this.sql.prepare("UPDATE withdrawals SET status='confirmed',issue=NULL,updated_at=? WHERE id=?").run(Date.now(), record.id);
      this.store.saveInside(state, 'confirmed-trc20-payout');
      this.audit('chain-monitor', 'withdrawal-confirmed', record.id);
      return true;
    });
  }

  releaseFailed(state, kind, id, info, height) {
    const row = kind === 'withdrawal' ? this.withdrawal(id) : this.sql.prepare('SELECT * FROM collections WHERE id=?').get(id);
    if (!row) throw failure('OUTGOING_JOB_NOT_FOUND', 404);
    if (!row.txid || !['submitted', 'signed'].includes(row.status)) throw failure('OUTGOING_JOB_NOT_PENDING');
    const knownFailures = ['REVERT', 'OUT_OF_ENERGY', 'OUT_OF_TIME', 'BAD_JUMP_DESTINATION', 'OUT_OF_MEMORY', 'TRANSFER_FAILED',
      'STACK_TOO_SMALL', 'STACK_TOO_LARGE', 'ILLEGAL_OPERATION', 'JVM_STACK_OVER_FLOW'];
    // Failed smart-contract execution must be solidified; absence or expiry is not proof of failure.
    decodeTransfers(info, row.txid, height);
    if (!knownFailures.includes(info.receipt?.result)) throw failure('CHAIN_FAILURE_NOT_VERIFIED');
    return this.store.transaction(() => {
      if (kind === 'withdrawal') {
        const user = state.users.find(item => item.id === row.user_id);
        if (!user) throw failure('ACCOUNT_NOT_FOUND');
        user.withdrawBalance = amount(units(user.withdrawBalance) + BigInt(row.gross_units));
        user.reservedBalance = amount(units(user.reservedBalance) - BigInt(row.gross_units));
        const activity = user.activities.find(item => item.id === id);
        if (activity) { activity.status = 'rejected'; activity.failure = 'verified-chain-failure'; }
        this.sql.prepare("UPDATE withdrawals SET status='rejected',issue='CHAIN_TRANSACTION_FAILED',updated_at=? WHERE id=?").run(Date.now(), id);
        this.store.saveInside(state, 'verified-failed-payout-release');
      } else this.sql.prepare("UPDATE collections SET status='cancelled',issue='CHAIN_TRANSACTION_FAILED' WHERE id=?").run(id);
      this.audit('operator-chain-verified', kind + '-failed-release', id);
      return true;
    });
  }

  planCollections() {
    return this.store.transaction(() => {
      for (const address of this.store.addresses()) {
        if (address.address === this.treasury) throw failure('COLLECTION_DESTINATION_IS_SOURCE');
        if (this.sql.prepare("SELECT 1 FROM collections WHERE address=? AND status NOT IN ('confirmed','cancelled')").get(address.address)) continue;
        const credits = this.sql.prepare('SELECT amount_units FROM deposits WHERE address=?').all(address.address)
          .reduce((sum, row) => sum + BigInt(row.amount_units), 0n);
        const collected = this.sql.prepare("SELECT amount_units FROM collections WHERE address=? AND status='confirmed'").all(address.address)
          .reduce((sum, row) => sum + BigInt(row.amount_units), 0n);
        const pending = credits - collected;
        if (pending < 1_000_000n) continue;
        const id = crypto.randomUUID();
        this.sql.prepare('INSERT INTO collections VALUES (?,?,?,?,?,?,?,NULL,NULL)').run(id, address.address,
          address.address_index, this.treasury, pending.toString(), 'planned', Date.now());
        this.audit('collection-planner', 'collection-planned', id);
      }
      return this.collections();
    });
  }

  collections() {
    return this.sql.prepare(`SELECT c.*,t.payload FROM collections c LEFT JOIN outgoing_transactions t ON t.job_id=c.id
      WHERE c.status NOT IN ('confirmed','cancelled') ORDER BY c.created_at LIMIT 100`).all();
  }

  recordCollection(id, transaction, validate) {
    return this.store.transaction(() => {
      const row = this.sql.prepare('SELECT * FROM collections WHERE id=?').get(id);
      if (!row) throw failure('COLLECTION_NOT_FOUND', 404);
      validate(transaction, row);
      if (row.txid === transaction.txID) return row;
      if (row.status !== 'planned') throw failure('COLLECTION_ALREADY_SIGNED');
      if (this.sql.prepare('SELECT 1 FROM outgoing_transactions WHERE txid=?').get(transaction.txID)) throw failure('TRANSACTION_ALREADY_USED');
      this.sql.prepare('INSERT INTO outgoing_transactions VALUES (?,?,?,?,?)').run(transaction.txID, 'collection', id, JSON.stringify(transaction), Date.now());
      this.sql.prepare("UPDATE collections SET status='signed',txid=?,issue=NULL WHERE id=?").run(transaction.txID, id);
      this.audit('local-signer', 'collection-signed-before-broadcast', id);
      return this.sql.prepare('SELECT * FROM collections WHERE id=?').get(id);
    });
  }

  settleCollection(record, events) {
    const transfers = events.filter(event => event.txid === record.txid && event.from === record.address);
    if (transfers.length !== 1 || transfers[0].to !== record.treasury || transfers[0].units !== record.amount_units
      || transfers[0].timestamp < record.created_at - 60_000) throw failure('COLLECTION_RECEIPT_MISMATCH');
    return this.store.transaction(() => {
      const result = this.sql.prepare("UPDATE collections SET status='confirmed',issue=NULL WHERE id=? AND txid=? AND status='signed'").run(record.id, record.txid);
      if (result.changes) this.audit('chain-monitor', 'collection-confirmed', record.id);
      return Boolean(result.changes);
    });
  }

  issue(kind, id, code) {
    const table = kind === 'withdrawal' ? 'withdrawals' : 'collections';
    const safe = ['PAYOUT_RECEIPT_MISMATCH', 'COLLECTION_RECEIPT_MISMATCH', 'CHAIN_TRANSACTION_FAILED', 'AWAITING_CONFIRMATION', 'SIGNED_TRANSACTION_EXPIRED', 'BROADCAST_NOT_ACKNOWLEDGED'].includes(code) ? code : 'CHAIN_CHECK_UNAVAILABLE';
    this.sql.prepare(`UPDATE ${table} SET issue=? WHERE id=?`).run(safe, id);
  }

  pending() {
    return [...this.sql.prepare("SELECT *, 'withdrawal' AS kind FROM withdrawals WHERE status='submitted'").all(),
      ...this.sql.prepare("SELECT *, 'collection' AS kind FROM collections WHERE status='signed'").all()];
  }
}

class SettlementWatcher {
  constructor({ ledger, client, exclusive, getState, commitState, interval = 30_000, onFatal }) {
    Object.assign(this, { ledger, client, exclusive, getState, commitState, interval, onFatal });
    this.stopped = false;
  }

  async poll() {
    const jobs = await this.exclusive(() => this.ledger.pending());
    if (!jobs.length || this.stopped) return;
    let height;
    try { height = await this.client.solidHeight(); } catch { return; }
    for (const job of jobs) {
      if (this.stopped) break;
      let info, events;
      try {
        info = await this.client.receipt(job.txid);
        if (!info.id || info.blockNumber > height) throw failure('AWAITING_CONFIRMATION');
        events = decodeTransfers(info, job.txid, height);
        if (info.receipt?.result !== 'SUCCESS') throw failure('CHAIN_TRANSACTION_FAILED');
      } catch (error) {
        await this.exclusive(() => this.ledger.issue(job.kind, job.id, error.message));
        continue;
      }
      await this.exclusive(() => {
        const state = structuredClone(this.getState());
        try {
          if (job.kind === 'withdrawal') { if (this.ledger.settleWithdrawal(state, job, events)) this.commitState(state); }
          else this.ledger.settleCollection(job, events);
        } catch (error) {
          if (error.status) this.ledger.issue(job.kind, job.id, error.message);
          else throw error;
        }
      });
    }
  }

  start() {
    const loop = async () => {
      try { await this.poll(); } catch { this.onFatal?.(); console.error('Outgoing settlement paused: storage or validation failure.'); }
      if (!this.stopped) { this.timer = setTimeout(loop, this.interval); this.timer.unref(); }
    };
    this.running = loop();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}

module.exports = { OutgoingLedger, SettlementWatcher, failure, MINIMUM_WITHDRAWAL_USDT };
