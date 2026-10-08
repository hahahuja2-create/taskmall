'use strict';

const { failure } = require('./outgoing');
const { boundedSun, validateTransfer, buildTokenTransfer, tokenBalance, trxBalance, broadcast } = require('./transactions');

class TronLinkPayouts {
  constructor(options) { Object.assign(this, options); }

  requireSending() {
    if (!this.isHealthy() || !this.isSendingEnabled() || !this.getClient()) throw failure('PAYOUT_SENDING_DISABLED', 503);
  }

  validate(transaction, row, feeLimit, signed = true) {
    try {
      if (transaction?.raw_data?.timestamp < row.created_at - 60_000) throw new Error('Invalid timestamp.');
      return validateTransfer(transaction, { from: this.treasury, to: row.destination, value: row.net_units, feeLimit }, signed);
    } catch { throw failure('INVALID_PAYOUT_TRANSACTION', 400); }
  }

  async prepare(id, feeLimit) {
    this.requireSending();
    try { boundedSun(feeLimit, 'payout fee limit'); } catch { throw failure('INVALID_NETWORK_FEE_LIMIT', 400); }
    const { row, existing } = await this.exclusive(() => {
      const row = this.getLedger().withdrawal(id);
      if (!row) throw failure('WITHDRAWAL_NOT_FOUND', 404);
      if (row.status !== 'approved') throw failure('WITHDRAWAL_NOT_APPROVED');
      return { row, existing: this.getLedger().withdrawalIntent(id) };
    });
    if (existing) {
      if (existing.fee_limit !== feeLimit) throw failure('PAYOUT_FEE_LIMIT_ALREADY_FIXED');
      return this.prepared(existing);
    }
    const client = this.getClient();
    if (await tokenBalance(client, this.treasury) < BigInt(row.net_units)) throw failure('TREASURY_USDT_INSUFFICIENT');
    // A conservative TRX fallback reserve, not an estimate of the actual network fee.
    if (await trxBalance(client, this.treasury) < BigInt(feeLimit) + 1_000_000n) throw failure('TREASURY_TRX_RESERVE_REQUIRED');
    const transaction = await buildTokenTransfer(client, { address: this.treasury, treasury: row.destination, amount_units: row.net_units }, feeLimit);
    this.requireSending();
    return this.exclusive(() => this.prepared(this.getLedger().prepareWithdrawal(id, transaction, feeLimit,
      (tx, saved) => this.validate(tx, saved, feeLimit, false))));
  }

  prepared(intent) {
    const transaction = JSON.parse(intent.payload);
    if (transaction.raw_data.expiration <= Date.now()) throw failure('PAYOUT_INTENT_EXPIRED_REVIEW_REQUIRED');
    return { transaction, feeLimitSun: intent.fee_limit };
  }

  async record(id, transaction) {
    // Always preserve a valid signature for an existing intent, even if admission was closed meanwhile.
    if (!this.isHealthy()) throw failure('STORAGE_UNAVAILABLE', 503);
    return this.exclusive(() => {
      const next = structuredClone(this.getState());
      const row = this.getLedger().recordSignedWithdrawal(next, id, transaction,
        (tx, saved, feeLimit) => this.validate(tx, saved, feeLimit));
      this.commitState(next);
      return { withdrawal: row };
    });
  }

  async send(id) {
    this.requireSending();
    const snapshot = await this.exclusive(() => {
      const ledger = this.getLedger();
      const row = ledger.withdrawal(id);
      if (!row) throw failure('WITHDRAWAL_NOT_FOUND', 404);
      if (row.status === 'confirmed') return { confirmed: true, txid: row.txid };
      const transaction = ledger.signedWithdrawal(id);
      const intent = ledger.withdrawalIntent(id);
      if (row.status !== 'submitted' || !transaction || !intent) throw failure('PAYOUT_SIGNATURE_NOT_RECORDED');
      this.validate(transaction, row, intent.fee_limit);
      if (transaction.txID !== row.txid || transaction.txID !== intent.txid) throw failure('PAYOUT_INTENT_MISMATCH');
      ledger.audit('operator', 'withdrawal-broadcast-requested', id);
      return { transaction, txid: row.txid };
    });
    if (snapshot.confirmed) return { txid: snapshot.txid, confirmed: true };
    try { await broadcast(this.getClient(), snapshot.transaction); }
    catch (error) {
      const issue = error.message === 'SIGNED_TRANSACTION_EXPIRED' ? error.message : 'BROADCAST_NOT_ACKNOWLEDGED';
      await this.exclusive(() => {
        if (this.getLedger().withdrawal(id)?.status === 'submitted') this.getLedger().issue('withdrawal', id, issue);
      });
      return { txid: snapshot.txid, broadcastAcknowledged: false, issue };
    }
    return { txid: snapshot.txid, broadcastAcknowledged: true, confirmed: false };
  }
}

module.exports = { TronLinkPayouts };
