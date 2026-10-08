'use strict';

const fs = require('node:fs/promises');
const { validateWallet, deriveAddress, decodeTransfers, TronGrid } = require('./tron');

class DepositWatcher {
  constructor({ store, walletFile, treasury, apiKey, exclusive, credit, client, interval = 30_000 }) {
    Object.assign(this, { store, walletFile, treasury, exclusive, credit, interval });
    this.client = client || new TronGrid(apiKey);
    this.hasApiKey = Boolean(apiKey || client);
    this.wallet = null;
    this.lastSuccess = 0;
    this.status = 'configuration-unavailable';
    this.stopped = false;
  }

  ready() { return Boolean(this.wallet && this.hasApiKey && Math.abs(Date.now() - this.lastSuccess) < 180_000); }

  allocate(userId) {
    if (!this.ready()) throw Object.assign(new Error('DEPOSITS_UNAVAILABLE'), { status: 503 });
    return this.store.allocate(userId, index => deriveAddress(this.wallet.xpub, index), this.client.lastSolidTimestamp || Date.now());
  }

  async poll() {
    if (this.stopped || !this.hasApiKey) { this.status = 'api-key-required'; return; }
    try {
      const raw = await fs.readFile(this.walletFile, 'utf8');
      const wallet = validateWallet(JSON.parse(raw), this.treasury);
      await this.exclusive(() => this.store.registerWallet(wallet));
      this.wallet = wallet;
      const height = await this.client.solidHeight();
      const addresses = await this.exclusive(() => this.store.addresses());
      const receipts = new Map();
      for (const record of addresses) {
        const fullScan = Date.now() - record.full_scan_at > 6 * 60 * 60_000;
        const since = fullScan ? record.created_at - 60_000 : Math.max(record.created_at - 60_000, record.scanned_at - 600_000);
        let cursor = null;
        const seenCursors = new Set();
        let checkpoint = since;
        do {
          const page = await this.client.history(record.address, since, cursor);
          for (const row of page.rows) {
            if (!receipts.has(row.transaction_id)) receipts.set(row.transaction_id, await this.client.receipt(row.transaction_id));
            const info = receipts.get(row.transaction_id);
            const events = decodeTransfers(info, row.transaction_id, height);
            for (const event of events) await this.exclusive(() => this.credit(event));
            checkpoint = Math.max(checkpoint, info.blockTimeStamp);
          }
          cursor = page.next;
          if (cursor && seenCursors.has(cursor)) throw new Error('Repeated history cursor.');
          if (cursor) seenCursors.add(cursor);
          if (seenCursors.size > 1000) throw new Error('TRON history page budget exceeded.');
        } while (cursor && !this.stopped);
        if (!this.stopped) await this.exclusive(() => this.store.scanned(record.address, checkpoint, fullScan));
      }
      this.lastSuccess = Date.now();
      this.status = 'ready';
    } catch (error) {
      this.status = error.code === 'ENOENT' ? 'configuration-unavailable' : 'network-or-wallet-error';
      this.lastSuccess = 0;
      // Provider bodies and credentials are deliberately excluded from logs.
      if (error.code !== 'ENOENT') console.error('Deposit monitor paused:', error.message.startsWith('TRON_NETWORK_') ? error.message : 'validation or storage failure');
    }
  }

  start() {
    const loop = async () => {
      await this.poll();
      if (!this.stopped) { this.timer = setTimeout(loop, this.interval); this.timer.unref(); }
    };
    this.running = loop();
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }
}

module.exports = { DepositWatcher };
