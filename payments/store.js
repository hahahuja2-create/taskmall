'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { units } = require('./tron');

class PaymentStore {
  constructor(directory) {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(directory, { recursive: true });
    try {
      this.sql = new DatabaseSync(path.join(directory, 'payments.sqlite'));
      this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS writer_lease (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL);`);
      this.transaction(() => {
        const lease = this.sql.prepare('SELECT pid FROM writer_lease WHERE id=1').get();
        if (lease) {
          let alive = true;
          try { process.kill(lease.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
          if (alive) throw new Error('Payment database is locked by a running process.');
        }
        this.sql.prepare('INSERT INTO writer_lease VALUES (1,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid').run(process.pid);
      });
      this.acquired = true;
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deposit_addresses (user_id TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE,
          address_index INTEGER NOT NULL UNIQUE, created_at INTEGER NOT NULL, scanned_at INTEGER NOT NULL DEFAULT 0,
          full_scan_at INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS deposits (txid TEXT NOT NULL, log_index INTEGER NOT NULL, user_id TEXT NOT NULL,
          address TEXT NOT NULL, amount_units TEXT NOT NULL, block_number INTEGER NOT NULL, timestamp INTEGER NOT NULL,
          PRIMARY KEY(txid, log_index));
        CREATE TABLE IF NOT EXISTS journal (batch TEXT NOT NULL, account TEXT NOT NULL, delta_units TEXT NOT NULL,
          reason TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS journal_account ON journal(account);
        CREATE INDEX IF NOT EXISTS deposits_user ON deposits(user_id, timestamp);`);
      const columns = this.sql.prepare('PRAGMA table_info(deposit_addresses)').all();
      if (!columns.some(column => column.name === 'full_scan_at')) this.sql.exec('ALTER TABLE deposit_addresses ADD COLUMN full_scan_at INTEGER NOT NULL DEFAULT 0');
    } catch (error) { this.close(); throw error; }
  }

  transaction(operation) {
    this.sql.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }

  state() {
    const record = this.sql.prepare('SELECT payload FROM state WHERE id=1').get();
    return record ? JSON.parse(record.payload) : null;
  }

  saveInside(state, reason) {
    const previous = this.state();
    const previousUsers = new Map((previous?.users || []).map(user => [user.id, user]));
    const batch = crypto.randomUUID();
    let offset = 0n;
    const insert = this.sql.prepare('INSERT INTO journal VALUES (?,?,?,?,?)');
    const now = new Date().toISOString();
    for (const user of state.users) {
      for (const field of ['lockedBalance', 'withdrawBalance', 'reservedBalance']) {
        const value = units(user[field] === undefined ? 0 : user[field]);
        const prior = units(previousUsers.get(user.id)?.[field] === undefined ? 0 : previousUsers.get(user.id)[field]);
        const delta = value - prior;
        if (delta) { insert.run(batch, `${user.id}:${field}`, delta.toString(), reason, now); offset -= delta; }
      }
      previousUsers.delete(user.id);
    }
    if (previousUsers.size) throw new Error('Removing accounts from the financial database is not supported.');
    if (offset) insert.run(batch, 'platform:counterparty', offset.toString(), reason, now);
    this.sql.prepare('INSERT INTO state VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(state));
  }

  save(state, reason = 'platform-operation') {
    return this.transaction(() => this.saveInside(state, reason));
  }

  registerWallet(wallet) {
    this.transaction(() => {
      const saved = this.sql.prepare("SELECT value FROM settings WHERE name='wallet'").get();
      if (saved && saved.value !== wallet.fingerprint) throw new Error('Deposit wallet cannot be changed without a reviewed migration.');
      this.sql.prepare("INSERT OR IGNORE INTO settings VALUES ('wallet',?)").run(wallet.fingerprint);
    });
  }

  allocate(userId, derive, timestamp = Date.now()) {
    return this.transaction(() => {
      const existing = this.address(userId);
      if (existing) return existing;
      const next = Number(this.sql.prepare('SELECT COALESCE(MAX(address_index),-1)+1 AS n FROM deposit_addresses').get().n);
      const address = derive(next);
      this.sql.prepare('INSERT INTO deposit_addresses(user_id,address,address_index,created_at) VALUES (?,?,?,?)').run(userId, address, next, timestamp);
      return this.address(userId);
    });
  }

  address(userId) { return this.sql.prepare('SELECT * FROM deposit_addresses WHERE user_id=?').get(userId); }
  addresses() { return this.sql.prepare('SELECT * FROM deposit_addresses ORDER BY address_index').all(); }
  scanned(address, timestamp, fullScan = false) {
    this.sql.prepare('UPDATE deposit_addresses SET scanned_at=MAX(scanned_at,?),full_scan_at=CASE WHEN ? THEN ? ELSE full_scan_at END WHERE address=?')
      .run(timestamp, fullScan ? 1 : 0, Date.now(), address);
  }

  credit(event, state, apply) {
    return this.transaction(() => {
      if (this.sql.prepare('SELECT 1 FROM deposits WHERE txid=? AND log_index=?').get(event.txid, event.logIndex)) return false;
      const record = this.sql.prepare('SELECT * FROM deposit_addresses WHERE address=?').get(event.to);
      if (!record || event.timestamp < record.created_at - 60_000) return false;
      apply(state, record.user_id, event);
      this.sql.prepare('INSERT INTO deposits VALUES (?,?,?,?,?,?,?)').run(event.txid, event.logIndex, record.user_id,
        event.to, event.units, event.blockNumber, event.timestamp);
      this.saveInside(state, 'confirmed-trc20-deposit');
      return true;
    });
  }

  deposits(userId) {
    return this.sql.prepare('SELECT txid,log_index,amount_units,block_number,timestamp FROM deposits WHERE user_id=? ORDER BY timestamp DESC LIMIT 100').all(userId);
  }

  close() {
    if (this.acquired) this.sql.prepare('DELETE FROM writer_lease WHERE id=1 AND pid=?').run(process.pid);
    this.sql?.close();
    this.sql = undefined;
    this.acquired = false;
  }
}

module.exports = { PaymentStore };
