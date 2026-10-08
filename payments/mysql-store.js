'use strict';

const crypto = require('node:crypto');
const { connect, migrate } = require('../database/mysql');
const { units } = require('./tron');

const numericColumns = new Set(['address_index', 'created_at', 'updated_at', 'expires_at', 'timestamp', 'scanned_at', 'full_scan_at', 'block_number', 'log_index', 'fee_limit']);
function row(record) {
  if (!record) return undefined;
  for (const key of numericColumns) if (record[key] != null) {
    const value = Number(record[key]);
    if (!Number.isSafeInteger(value)) throw new Error('Database integer exceeds the supported range.');
    record[key] = value;
  }
  return record;
}
function milliseconds(value) {
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid stored timestamp.');
  return result;
}
function upsert(table, columns, key) {
  return `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON DUPLICATE KEY UPDATE `
    + columns.filter(column => column !== key).map(column => `${column}=VALUES(${column})`).join(',');
}

class MysqlPaymentStore {
  static async open(env = process.env) {
    const connection = await connect(env);
    const store = new MysqlPaymentStore(connection);
    try {
      await migrate(connection);
      const [[{ acquired }]] = await connection.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':taskmall:writer'), 0) AS acquired");
      if (Number(acquired) !== 1) throw new Error('TaskMall requires one database writer. Another instance is running.');
      store.acquired = true;
      return store;
    } catch (error) { await connection.end(); throw error; }
  }

  constructor(connection) {
    this.connection = connection;
    this.dialect = 'mysql';
    this.healthy = true;
    this.inTransaction = false;
    connection.on('error', () => { this.healthy = false; });
    this.sql = { prepare: query => ({
      get: async (...parameters) => row((await this.execute(query, parameters))[0]),
      all: async (...parameters) => (await this.execute(query, parameters)).map(row),
      run: async (...parameters) => { const result = await this.execute(query, parameters); return { changes: result.affectedRows }; }
    }) };
  }

  createSession(token, userId, expiresAt) {
    return this.execute('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',
      [crypto.createHash('sha256').update(token).digest('hex'), userId, expiresAt, Date.now()]);
  }
  async session(token, ttl) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await this.sql.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=? AND expires_at>?').get(hash, Date.now());
    if (!record) return null;
    const expiresAt = Date.now() + ttl;
    if (record.expires_at < expiresAt - 300_000) await this.execute('UPDATE sessions SET expires_at=? WHERE token_hash=?', [expiresAt, hash]);
    return { userId: record.user_id, expiresAt };
  }
  revokeSession(token) {
    return this.execute('DELETE FROM sessions WHERE token_hash=?', [crypto.createHash('sha256').update(token).digest('hex')]);
  }
  pruneSessions() { return this.execute('DELETE FROM sessions WHERE expires_at<=?', [Date.now()]); }

  async execute(query, parameters = []) {
    if (!this.healthy) throw new Error('MySQL storage is unavailable.');
    const [result] = await this.connection.execute(query, parameters);
    return result;
  }

  async transaction(operation) {
    if (this.inTransaction) throw new Error('Nested financial transactions are not supported.');
    this.inTransaction = true;
    let begun = false;
    try {
      const [[{ owner, current }]] = await this.connection.query("SELECT IS_USED_LOCK(CONCAT(DATABASE(), ':taskmall:writer')) AS owner, CONNECTION_ID() AS current");
      if (String(owner) !== String(current)) { this.healthy = false; throw new Error('MySQL writer lock was lost.'); }
      await this.connection.beginTransaction();
      begun = true;
      const result = await operation();
      await this.connection.commit();
      return result;
    } catch (error) {
      if (begun) try { await this.connection.rollback(); } catch { this.healthy = false; }
      throw error;
    } finally { this.inTransaction = false; }
  }

  async state() {
    const record = await this.sql.prepare('SELECT payload FROM state WHERE id=1').get();
    return record ? JSON.parse(record.payload) : null;
  }

  async saveInside(state, reason) {
    if (!this.inTransaction) throw new Error('A financial state write requires an active transaction.');
    const previous = await this.state();
    const previousUsers = new Map((previous?.users || []).map(user => [user.id, user]));
    const ids = new Set(state.users.map(user => user.id));
    if (ids.size !== state.users.length) throw new Error('Duplicate account IDs.');
    for (const id of previousUsers.keys()) if (!ids.has(id)) throw new Error('Removing accounts from the financial database is not supported.');
    const batch = crypto.randomUUID();
    const now = new Date().toISOString();
    let offset = 0n;
    for (const user of state.users) {
      const prior = previousUsers.get(user.id);
      for (const field of ['lockedBalance', 'withdrawBalance', 'reservedBalance']) {
        const delta = units(user[field] ?? 0) - units(prior?.[field] ?? 0);
        if (delta) {
          await this.execute('INSERT INTO journal VALUES (?,?,?,?,?)', [batch, `${user.id}:${field}`, delta.toString(), reason, now]);
          offset -= delta;
        }
      }
      if (!prior || JSON.stringify(prior) !== JSON.stringify(user)) await this.projectUser(user);
    }
    if (offset) await this.execute('INSERT INTO journal VALUES (?,?,?,?,?)', [batch, 'platform:counterparty', offset.toString(), reason, now]);
    await this.execute('INSERT INTO state VALUES (1,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)', [JSON.stringify(state)]);
  }

  async projectUser(user) {
    const existing = await this.sql.prepare('SELECT id FROM users WHERE id=? OR email=? OR invite_code=?').all(user.id, user.email, user.inviteCode);
    if (existing.some(record => record.id !== user.id)) throw new Error('Account identity conflicts with stored data.');
    await this.execute(upsert('users', ['id','email','name','password_salt','password_hash','invite_code','referred_by','created_at','updated_at'], 'id'),
      [user.id, user.email, user.name, user.passwordSalt, user.passwordHash, user.inviteCode, user.referredBy || null, milliseconds(user.createdAt), Date.now()]);
    const balances = ['lockedBalance','withdrawBalance','reservedBalance','earnedTotal','withdrawnTotal','withdrawFeeTotal'].map(field => units(user[field] ?? 0).toString());
    await this.execute(upsert('wallets', ['user_id','locked_units','withdraw_units','reserved_units','earned_units','withdrawn_units','fee_units'], 'user_id'), [user.id, ...balances]);
    await this.execute(upsert('memberships', ['user_id','vip_id','started_at','expires_at'], 'user_id'),
      [user.id, user.vipId, milliseconds(user.vipStartedAt), milliseconds(user.vipExpiresAt)]);
    for (const activity of user.activities || []) {
      const [[saved]] = await this.connection.execute('SELECT user_id FROM activities WHERE id=?', [activity.id]);
      if (saved && saved.user_id !== user.id) throw new Error('Activity ownership conflict.');
      await this.execute(upsert('activities', ['id','user_id','type','amount_units','at','payload'], 'id'),
        [activity.id, user.id, activity.type, activity.amount == null ? null : units(activity.amount).toString(), milliseconds(activity.at), JSON.stringify(activity)]);
      if (activity.type === 'task') {
        await this.execute(`INSERT INTO task_completions VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE activity_id=activity_id`,
          [activity.id, user.id, activity.taskId, activity.at.slice(0, 10), units(activity.amount).toString()]);
        const [[completion]] = await this.connection.execute('SELECT activity_id FROM task_completions WHERE user_id=? AND task_id=? AND completion_day=?',
          [user.id, activity.taskId, activity.at.slice(0, 10)]);
        if (completion.activity_id !== activity.id) throw new Error('Duplicate daily task completion.');
      }
    }
  }

  async catalog(plans, tasks) {
    return this.transaction(async () => {
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ plans, tasks })).digest('hex');
      const saved = await this.sql.prepare("SELECT value FROM settings WHERE name='catalog'").get();
      if (saved?.value === fingerprint) return;
      for (const plan of plans) await this.execute(upsert('vip_plans', ['id','level','name','price_units','reward_units','daily_tasks','duration_days','payload'], 'id'),
        [plan.id, plan.level, plan.name, units(plan.price).toString(), units(plan.maxReward).toString(), plan.dailyTasks, plan.durationDays, JSON.stringify(plan)]);
      for (const task of tasks) {
        const plan = plans.find(plan => plan.level === task.requiredVip);
        await this.execute(upsert('tasks', ['id','vip_id','reward_units','image','payload'], 'id'),
          [task.id, plan.id, units(task.reward).toString(), task.image, JSON.stringify(task)]);
      }
      await this.execute("INSERT INTO settings VALUES ('catalog',?) ON DUPLICATE KEY UPDATE value=VALUES(value)", [fingerprint]);
    });
  }

  save(state, reason = 'platform-operation') { return this.transaction(() => this.saveInside(state, reason)); }
  registerWallet(wallet) {
    return this.transaction(async () => {
      const saved = await this.sql.prepare("SELECT value FROM settings WHERE name='wallet'").get();
      if (saved && saved.value !== wallet.fingerprint) throw new Error('Deposit wallet cannot be changed without a reviewed migration.');
      if (!saved) await this.execute("INSERT INTO settings VALUES ('wallet',?)", [wallet.fingerprint]);
    });
  }
  allocate(userId, derive, timestamp = Date.now()) {
    return this.transaction(async () => {
      const existing = await this.address(userId);
      if (existing) return existing;
      const [[{ n }]] = await this.connection.query('SELECT COALESCE(MAX(address_index),-1)+1 AS n FROM deposit_addresses');
      const next = Number(n);
      if (!Number.isSafeInteger(next) || next >= 0x80000000) throw new Error('Deposit address index exhausted.');
      await this.execute('INSERT INTO deposit_addresses(user_id,address,address_index,created_at) VALUES (?,?,?,?)', [userId, derive(next), next, timestamp]);
      return this.address(userId);
    });
  }
  address(userId) { return this.sql.prepare('SELECT * FROM deposit_addresses WHERE user_id=?').get(userId); }
  addresses() { return this.sql.prepare('SELECT * FROM deposit_addresses ORDER BY address_index').all(); }
  scanned(address, timestamp, fullScan = false) {
    return this.execute('UPDATE deposit_addresses SET scanned_at=GREATEST(scanned_at,?),full_scan_at=CASE WHEN ? THEN ? ELSE full_scan_at END WHERE address=?',
      [timestamp, fullScan ? 1 : 0, Date.now(), address]);
  }
  credit(event, state, apply) {
    return this.transaction(async () => {
      if (await this.sql.prepare('SELECT 1 FROM deposits WHERE txid=? AND log_index=?').get(event.txid, event.logIndex)) return false;
      const record = await this.sql.prepare('SELECT * FROM deposit_addresses WHERE address=?').get(event.to);
      if (!record || event.timestamp < record.created_at - 60_000) return false;
      await apply(state, record.user_id, event);
      await this.execute('INSERT INTO deposits VALUES (?,?,?,?,?,?,?)', [event.txid, event.logIndex, record.user_id, event.to, event.units, event.blockNumber, event.timestamp]);
      await this.saveInside(state, 'confirmed-trc20-deposit');
      return true;
    });
  }
  deposits(userId) {
    return this.sql.prepare('SELECT txid,log_index,amount_units,block_number,timestamp FROM deposits WHERE user_id=? ORDER BY timestamp DESC LIMIT 100').all(userId);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.healthy = false;
    if (this.acquired) {
      try { await this.connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':taskmall:writer'))"); } catch {}
    }
    await this.connection.end();
    this.acquired = false;
  }
}

module.exports = { MysqlPaymentStore };
