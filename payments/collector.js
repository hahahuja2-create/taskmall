'use strict';

const { PaymentStore } = require('./store');
const { addressHex, deriveAddress, MAX_UNITS } = require('./tron');
const { validateTransfer, signTransfer, buildTokenTransfer, buildTrxTransfer, tokenBalance, trxBalance, broadcast, boundedSun } = require('./transactions');

function dailyLimit(value, name) {
  if (!/^\d+$/.test(String(value)) || BigInt(value) < 1_000_000n || BigInt(value) > 10_000_000_000n) throw new Error(`Set an explicit ${name} between 1 and 10000 TRX.`);
  return BigInt(value);
}

class SignerJournal {
  constructor(directory, { now = () => new Date() } = {}) {
    this.now = now;
    this.store = new PaymentStore(directory);
    this.sql = this.store.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS spend_limits (kind TEXT NOT NULL, job_id TEXT NOT NULL,
      day TEXT NOT NULL, amount_sun TEXT NOT NULL, PRIMARY KEY(kind,job_id));
      CREATE TABLE IF NOT EXISTS spend_limits_daily (kind TEXT NOT NULL, job_id TEXT NOT NULL,
        day TEXT NOT NULL, amount_sun TEXT NOT NULL, PRIMARY KEY(kind,job_id,day));
      INSERT OR IGNORE INTO spend_limits_daily SELECT kind,job_id,day,amount_sun FROM spend_limits;
      CREATE TABLE IF NOT EXISTS funding (job_id TEXT PRIMARY KEY, payload TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0);`);
  }
  reserve(kind, job, value, limit) {
    return this.store.transaction(() => {
      const existing = this.sql.prepare('SELECT amount_sun FROM spend_limits_daily WHERE kind=? AND job_id=? LIMIT 1').get(kind, job);
      if (existing && existing.amount_sun !== String(value)) throw new Error('A reserved spending limit cannot be changed.');
      const day = this.now().toISOString().slice(0, 10);
      if (this.sql.prepare('SELECT 1 FROM spend_limits_daily WHERE kind=? AND job_id=? AND day=?').get(kind, job, day)) return;
      const used = this.sql.prepare('SELECT amount_sun FROM spend_limits_daily WHERE kind=? AND day=?').all(kind, day)
        .reduce((sum, row) => sum + BigInt(row.amount_sun), 0n);
      if (used + value > limit) throw new Error('DAILY_SPENDING_LIMIT_REACHED');
      this.sql.prepare('INSERT INTO spend_limits_daily VALUES (?,?,?,?)').run(kind, job, day, String(value));
    });
  }
  funding(id) { return this.sql.prepare('SELECT * FROM funding WHERE job_id=?').get(id); }
  reservedCost(kind, id) { return BigInt(this.sql.prepare('SELECT amount_sun FROM spend_limits_daily WHERE kind=? AND job_id=? LIMIT 1').get(kind, id)?.amount_sun || 0); }
  saveFunding(id, transaction) {
    this.sql.prepare('INSERT INTO funding(job_id,payload) VALUES (?,?)').run(id, JSON.stringify(transaction));
  }
  confirmFunding(id) { this.sql.prepare('UPDATE funding SET confirmed=1 WHERE job_id=?').run(id); }
  close() { this.store.close(); }
}

class CollectionWorker {
  constructor({ operator, client, wallet, treasury, branch, gasWallet, journal, feeLimit, feeDailyLimit, gasDailyLimit, gasEnabled = false, shouldStop = () => false }) {
    Object.assign(this, { operator, client, wallet, treasury, branch, gasWallet, journal, gasEnabled });
    addressHex(treasury);
    this.feeLimit = boundedSun(feeLimit, 'collection fee limit');
    this.shouldStop = shouldStop;
    this.feeDailyLimit = dailyLimit(feeDailyLimit, 'daily collection fee limit');
    this.gasDailyLimit = gasEnabled ? dailyLimit(gasDailyLimit, 'daily gas funding limit') : 0n;
    if (branch.neuter().extendedKey !== wallet.xpub || wallet.treasuryAddress !== treasury) throw new Error('Local signer does not match the public deposit wallet.');
  }

  async send(transaction) {
    if (this.shouldStop()) throw new Error('COLLECTION_WORKER_STOPPED');
    return broadcast(this.client, transaction);
  }

  async ensureGas(job) {
    const existing = this.journal.funding(job.id);
    if (existing && !existing.confirmed) {
      const signed = JSON.parse(existing.payload);
      validateTransfer(signed, { from: this.gasWallet.address, to: job.address,
        value: this.journal.reservedCost('gas', job.id) - 2_000_000n, kind: 'trx' });
      const transaction = await this.client.request('/walletsolidity/gettransactionbyid', { value: signed.txID });
      if (transaction.txID === signed.txID) {
        if (transaction.ret?.[0]?.contractRet !== 'SUCCESS') throw new Error('GAS_TRANSACTION_FAILED_REVIEW_REQUIRED');
        this.journal.confirmFunding(job.id);
      } else {
        if (!this.gasEnabled) throw new Error('TRX_FEE_RESERVE_REQUIRED');
        if (signed.raw_data.expiration <= Date.now()) throw new Error('SIGNED_TRANSACTION_EXPIRED');
        this.journal.reserve('gas', job.id, this.journal.reservedCost('gas', job.id), this.gasDailyLimit);
        await this.send(signed);
        return false;
      }
    }
    const target = BigInt(this.feeLimit) + 1_000_000n;
    const balance = await trxBalance(this.client, job.address);
    if (balance >= target) return true;
    if (existing?.confirmed || this.journal.funding(job.id)?.confirmed) throw new Error('INSUFFICIENT_GAS_AFTER_FUNDING');
    if (!this.gasEnabled) throw new Error('TRX_FEE_RESERVE_REQUIRED');
    const from = this.gasWallet.address;
    const topUp = target - balance;
    if (await trxBalance(this.client, from) < topUp + 2_000_000n) throw new Error('GAS_WALLET_REQUIRES_TRX');
    this.journal.reserve('gas', job.id, topUp + 2_000_000n, this.gasDailyLimit);
    const unsigned = await buildTrxTransfer(this.client, from, job.address, topUp);
    const signed = await signTransfer(unsigned, this.gasWallet.privateKey, { from, to: job.address, value: topUp, kind: 'trx' });
    // Persist before broadcast; retries reuse these exact bytes, never a second funding transfer.
    this.journal.saveFunding(job.id, signed);
    this.journal.reserve('gas', job.id, topUp + 2_000_000n, this.gasDailyLimit);
    await this.send(signed);
    return false;
  }

  async process(job) {
    if (job.treasury !== this.treasury || job.address !== deriveAddress(this.wallet.xpub, job.address_index)) throw new Error('UNTRUSTED_COLLECTION_SOURCE_OR_DESTINATION');
    if (!/^[a-f0-9-]{36}$/.test(job.id) || BigInt(job.amount_units) <= 0n || BigInt(job.amount_units) > MAX_UNITS) throw new Error('UNSUPPORTED_COLLECTION_JOB');
    const expectation = { from: job.address, to: this.treasury, value: job.amount_units, feeLimit: this.feeLimit };
    if (job.status === 'signed') {
      const signed = JSON.parse(job.payload);
      validateTransfer(signed, expectation);
      if (signed.txID !== job.txid) throw new Error('STORED_COLLECTION_TRANSACTION_MISMATCH');
      if (signed.raw_data.expiration <= Date.now()) throw new Error('SIGNED_TRANSACTION_EXPIRED');
      this.journal.reserve('collection-fee', job.id, BigInt(this.feeLimit), this.feeDailyLimit);
      await this.send(signed);
      return 'awaiting-confirmation';
    }
    if (job.status !== 'planned') throw new Error('UNEXPECTED_COLLECTION_STATE');
    if (await tokenBalance(this.client, job.address) < BigInt(job.amount_units)) throw new Error('USDT_BALANCE_NOT_YET_AVAILABLE');
    // Reserve the maximum possible token fee before funding or signing anything.
    this.journal.reserve('collection-fee', job.id, BigInt(this.feeLimit), this.feeDailyLimit);
    if (!(await this.ensureGas(job))) return 'awaiting-gas-confirmation';
    const child = this.branch.deriveChild(job.address_index);
    const unsigned = await buildTokenTransfer(this.client, job, this.feeLimit);
    const signed = await signTransfer(unsigned, child.privateKey.slice(2), expectation);
    const stored = await this.operator('collections/' + job.id + '/record', { transaction: signed });
    if (stored.collection?.txid !== signed.txID) throw new Error('COLLECTION_NOT_PERSISTED');
    this.journal.reserve('collection-fee', job.id, BigInt(this.feeLimit), this.feeDailyLimit);
    await this.send(signed);
    return 'awaiting-confirmation';
  }

  async cycle() {
    const queue = await this.operator('collections/plan', {});
    if (queue.treasury !== this.treasury) throw new Error('TREASURY_CONFIGURATION_MISMATCH');
    boundedSun(queue.feeLimitSun, 'backend collection fee limit');
    if (this.feeLimit > queue.feeLimitSun) throw new Error('COLLECTION_LIMIT_EXCEEDS_BACKEND_CAP');
    const results = [];
    for (const job of queue.collections) {
      if (this.shouldStop()) break;
      try { results.push({ id: job.id, address: job.address, status: await this.process(job) }); }
      catch (error) {
        const allowed = ['SIGNED_TRANSACTION_EXPIRED', 'TRX_FEE_RESERVE_REQUIRED', 'GAS_WALLET_REQUIRES_TRX',
          'DAILY_SPENDING_LIMIT_REACHED', 'USDT_BALANCE_NOT_YET_AVAILABLE', 'INSUFFICIENT_GAS_AFTER_FUNDING'];
        results.push({ id: job.id, address: job.address, status: allowed.includes(error.message) ? error.message : 'PAUSED_FOR_REVIEW' });
      }
    }
    return results;
  }
}

module.exports = { SignerJournal, CollectionWorker, dailyLimit };
