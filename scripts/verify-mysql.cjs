'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { options, connect, migrate } = require('../database/mysql');
const { MysqlPaymentStore } = require('../payments/mysql-store');
const { OutgoingLedger } = require('../payments/outgoing');
const { vipPlans, tasks } = require('../platform-catalog');

test('database URLs are validated and public connections cannot silently disable TLS', () => {
  assert.throws(() => options({}), /required/);
  assert.throws(() => options({ MYSQL_URL: 'postgres://localhost/railway' }), /Invalid/);
  assert.throws(() => options({ MYSQL_URL: 'mysql://localhost/bad-name' }), /Invalid/);
  const publicConfig = options({ MYSQL_URL: 'mysql://user:pass@example.invalid:3306/railway' });
  assert.equal(publicConfig.ssl.rejectUnauthorized, true);
  assert.equal(publicConfig.ssl.verifyIdentity, true);
  assert.equal(publicConfig.multipleStatements, false);
  assert.equal(publicConfig.bigNumberStrings, true);
  assert.equal(options({ MYSQL_URL: 'mysql://user:pass@mysql.railway.internal/railway' }).ssl, undefined);
});

test('async accounting commits after completion, rolls back failures and rejects competing transactions', async () => {
  const events = [];
  const connection = { on() {}, query: async () => [[{ owner: 7, current: 7 }]],
    beginTransaction: async () => { events.push('begin'); }, commit: async () => { events.push('commit'); },
    rollback: async () => { events.push('rollback'); } };
  const store = new MysqlPaymentStore(connection);
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const pending = store.transaction(async () => { await barrier; events.push('operation'); });
  await assert.rejects(() => store.transaction(() => {}), /Nested/);
  assert.equal(events.includes('commit'), false);
  release();
  await pending;
  assert.deepEqual(events, ['begin', 'operation', 'commit']);
  await assert.rejects(() => store.transaction(async () => { throw new Error('fixture failure'); }), /fixture failure/);
  assert.deepEqual(events.slice(-2), ['begin', 'rollback']);
  connection.query = async () => [[{ owner: null, current: 7 }]];
  await assert.rejects(() => store.transaction(() => {}), /lock was lost/);
  assert.equal(store.healthy, false);
});

function user() {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), email: 'mysql-fixture@test.invalid', name: 'Fixture account',
    passwordSalt: 'a'.repeat(32), passwordHash: 'b'.repeat(128), inviteCode: 'TMTEST001',
    vipId: 'free', createdAt: now, vipStartedAt: now, vipExpiresAt: new Date(Date.parse(now) + 10 * 86_400_000).toISOString(),
    lockedBalance: 0, withdrawBalance: 100, reservedBalance: 0, earnedTotal: 0, withdrawnTotal: 0,
    withdrawFeeTotal: 0, activities: [] };
}

async function start(t, env, directory) {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'pipe',
    env: { ...process.env, ...env, NODE_ENV: 'test', TASKMALL_MYSQL_TEST: '1', PORT: '0', HOST: '127.0.0.1', PUBLIC_ORIGIN: '',
      TASKMALL_DATA_DIR: directory, TASKMALL_SQLITE: '', TASKMALL_TEST_WALLET: '', TRON_DEPOSITS_ENABLED: '',
      TASKMALL_OPERATOR_ENABLED: '', TRON_AUTO_WALLET: '' } });
  const exit = new Promise(resolve => child.once('exit', resolve));
  let errors = '';
  child.stderr.on('data', chunk => { errors += String(chunk); });
  t.after(async () => { if (child.exitCode === null) child.kill(); await exit; });
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('MySQL fixture server startup timed out: ' + errors)); }, 90_000);
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    exit.then(() => { clearTimeout(timeout); reject(new Error('MySQL fixture server exited before listening: ' + errors)); });
  });
  return { address, stop: async () => { child.kill(); await exit; } };
}

test('MySQL migrations, atomic accounting, uniqueness, writer lease, sessions and API restart',
  { skip: process.env.TASKMALL_MYSQL_INTEGRATION !== '1', timeout: 360_000 }, async t => {
    // Never write fixture accounts into the configured application database.
    const admin = await connect();
    const database = 'taskmall_test_' + crypto.randomBytes(10).toString('hex');
    let created = false;
    let store;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-mysql-'));
    const url = new URL(process.env.MYSQL_URL || process.env.DATABASE_URL);
    const configuredDatabase = url.pathname.slice(1);
    url.pathname = '/' + database;
    const env = { ...process.env, MYSQL_URL: url.toString(), DATABASE_URL: '' };
    t.after(async () => {
      await store?.close();
      assert.match(database, /^taskmall_test_[a-f0-9]{20}$/);
      assert.notEqual(database, configuredDatabase);
      if (created) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
      assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
      assert.ok(path.basename(directory).startsWith('taskmall-mysql-'));
      await fs.rm(directory, { recursive: true, force: true });
    });
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    created = true;
    store = await MysqlPaymentStore.open(env);
    await migrate(store.connection);
    await store.catalog(vipPlans, tasks);
    console.log('MySQL fixture: schema and catalog verified.');
    await assert.rejects(() => MysqlPaymentStore.open(env), /one database writer/);
    const account = user();
    const state = { users: [account], tasks };
    await store.save(state, 'isolated-test-opening');
    assert.equal((await store.sql.prepare('SELECT duration_days FROM vip_plans WHERE id=?').get('vip11')).duration_days, 365);
    const destination = 'TZBZHkdrwv6xrGzRR9a1WqStf3oEmtjDvw';
    const allocated = await store.allocate(account.id, () => destination);
    assert.equal((await store.allocate(account.id, () => { throw new Error('Must reuse address'); })).address, allocated.address);
    const event = { txid: '1'.repeat(64), logIndex: 0, to: allocated.address, units: '10000001', blockNumber: 999, timestamp: Date.now() };
    const apply = state => { state.users[0].lockedBalance = 10.000001; };
    assert.equal(await store.credit(event, state, apply), true);
    assert.equal(await store.credit(event, state, () => { throw new Error('Must not credit twice'); }), false);
    await assert.rejects(() => store.credit({ ...event, txid: '2'.repeat(64) }, structuredClone(state), () => { throw new Error('Fixture rollback'); }), /rollback/);
    assert.equal((await store.deposits(account.id)).length, 1);
    const ledger = new OutgoingLedger(store, destination);
    const key = crypto.randomUUID();
    const request = await ledger.request(state, account.id, { key, destination, gross: '10.000001' });
    assert.equal(request.record.net_units, '9000001');
    assert.equal((await ledger.request(state, account.id, { key, destination, gross: '10.000001' })).changed, false);
    await assert.rejects(() => ledger.request(structuredClone(state), account.id, { key, destination, gross: '11' }), /CONFLICT/);
    await assert.rejects(() => ledger.request(state, account.id, { key: crypto.randomUUID(), destination, gross: '9.999999' }), /MINIMUM/);
    await ledger.decide(state, request.record.id, 'approve');
    const txid = '3'.repeat(64);
    const submitted = await ledger.submitWithdrawal(state, request.record.id, txid);
    const transfer = { txid, from: destination, to: destination, units: submitted.net_units, timestamp: Date.now() };
    assert.equal(await ledger.settleWithdrawal(state, submitted, [transfer]), true);
    assert.equal(await ledger.settleWithdrawal(state, submitted, [transfer]), false);
    const wallet = await store.sql.prepare('SELECT * FROM wallets WHERE user_id=?').get(account.id);
    assert.equal(wallet.reserved_units, '0');
    assert.equal(wallet.withdrawn_units, '9000001');
    const [unbalanced] = await store.connection.query('SELECT batch FROM journal GROUP BY batch HAVING SUM(delta_units) <> 0');
    assert.deepEqual(unbalanced, []);
    await assert.rejects(() => store.transaction(() => store.execute('UPDATE wallets SET withdraw_units=-1 WHERE user_id=?', [account.id])));
    await assert.rejects(() => store.save({ users: [] }), /Removing/);
    const token = crypto.randomBytes(32).toString('base64url');
    await store.createSession(token, account.id, Date.now() + 10000);
    assert.equal((await store.session(token, 10000)).userId, account.id);
    await store.close();
    store = await MysqlPaymentStore.open(env);
    assert.equal((await store.state()).users[0].withdrawnTotal, 9.000001);
    assert.equal((await store.session(token, 10000)).userId, account.id);
    await store.revokeSession(token);
    assert.equal(await store.session(token, 10000), null);
    await store.close();
    store = undefined;
    console.log('MySQL fixture: accounting and session recovery verified.');
    const first = await start(t, env, directory);
    const password = 'MysqlFixturePass2026';
    const signup = await fetch(first.address + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mysql-api@test.invalid', password }) });
    assert.equal(signup.status, 201);
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    const accountCreated = await signup.json();
    const claim = await fetch(first.address + '/api/tasks/free-daily-task/complete', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(claim.status, 200);
    await first.stop();
    const second = await start(t, env, directory);
    const restored = await fetch(second.address + '/api/me', { headers: { Cookie: cookie } });
    assert.equal(restored.status, 200);
    const restoredUser = (await restored.json()).user;
    assert.equal(restoredUser.id, accountCreated.user.id);
    assert.equal(restoredUser.withdrawBalance, 0.3);
    assert.equal((await fetch(second.address + '/api/health')).status, 200);
    await second.stop();
  });
