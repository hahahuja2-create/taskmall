'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { HDNodeWallet } = require('ethers');
const { loadOperatorToken } = require('../payments/operator');
const { PaymentStore } = require('../payments/store');
const { validateSnapshot, importZeroFundSnapshot, emptyLedgerTables } = require('../payments/deployment-cutover');
const { BRANCH_PATH, deriveAddress, proofMessage, validateWallet } = require('../payments/tron');
const { MysqlPaymentStore } = require('../payments/mysql-store');
const { connect } = require('../database/mysql');
const { vipPlans, tasks } = require('../platform-catalog');

const treasury = 'TZBZHkdrwv6xrGzRR9a1WqStf3oEmtjDvw';
// Public fixture only. Never fund these derived addresses.
const branch = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', '', BRANCH_PATH);
const xpub = branch.neuter().extendedKey;
async function wallet() {
  return { version: 1, network: 'tron-mainnet', branchPath: BRANCH_PATH, xpub, treasuryAddress: treasury,
    firstAddress: deriveAddress(xpub, 0), proof: await branch.deriveChild(0).signMessage(proofMessage(xpub, treasury)) };
}
function snapshot() {
  const now = new Date().toISOString();
  return { version: 1, source: 'railway-sqlite', walletRegistered: false,
    counts: Object.fromEntries(emptyLedgerTables.map(name => [name, 0])),
    state: { tasks, users: [{ id: crypto.randomUUID(), email: 'cutover@test.invalid', name: 'Fixture',
      passwordSalt: 'a'.repeat(32), passwordHash: 'b'.repeat(128), inviteCode: 'TMCUTOVER1', referredBy: null,
      createdAt: now, vipId: 'free', vipStartedAt: now, vipExpiresAt: new Date(Date.parse(now) + 10 * 86400000).toISOString(),
      lockedBalance: 0, withdrawBalance: 0, reservedBalance: 0, earnedTotal: 0, withdrawnTotal: 0, withdrawFeeTotal: 0, activities: [] }] } };
}
async function folder(t, beforeCleanup = () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-cutover-'));
  t.after(async () => {
    await beforeCleanup();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('taskmall-cutover-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('cutover refuses funded accounts, payment records and missing ledger evidence', () => {
  const source = snapshot();
  assert.equal(validateSnapshot(source), validateSnapshot(structuredClone(source)));
  for (const field of ['lockedBalance', 'withdrawBalance', 'reservedBalance', 'earnedTotal', 'withdrawnTotal', 'withdrawFeeTotal']) {
    const invalid = structuredClone(source);
    invalid.state.users[0][field] = 0.000001;
    assert.throws(() => validateSnapshot(invalid), /funded or earned/);
  }
  for (const name of emptyLedgerTables) {
    const invalid = structuredClone(source);
    invalid.counts[name] = 1;
    assert.throws(() => validateSnapshot(invalid), /reconciliation/);
    delete invalid.counts[name];
    assert.throws(() => validateSnapshot(invalid), /reconciliation/);
  }
  const invalid = structuredClone(source);
  invalid.state.users[0].activities.push({ type: 'deposit', amount: 0 });
  assert.throws(() => validateSnapshot(invalid), /funded or earned/);
  assert.throws(() => validateSnapshot({ ...source, walletRegistered: true }), /Invalid/);
});

test('operator service credentials survive file recreation and conflicts fail closed', async t => {
  const directory = await folder(t);
  const file = path.join(directory, 'operator.token');
  const token = crypto.randomBytes(32).toString('base64url');
  await assert.rejects(loadOperatorToken(file, true, 'short'), /Invalid configured/);
  await assert.rejects(fs.access(file));
  assert.equal(await loadOperatorToken(file, true, token), token);
  await assert.rejects(loadOperatorToken(file, true, crypto.randomBytes(32).toString('base64url')), /conflicts/);
  assert.equal((await fs.readFile(file, 'utf8')).trim(), token);
  await fs.unlink(file);
  assert.equal(await loadOperatorToken(file, true, token), token);
});

test('reserved address indexes and ledger retirement cannot reuse legacy addresses', async t => {
  let store;
  const directory = await folder(t, () => store?.close());
  store = new PaymentStore(directory);
  store.sql.prepare("INSERT INTO settings VALUES ('deposit_index_start',?)").run('4');
  store.registerWallet(validateWallet(await wallet(), treasury));
  const first = store.allocate('one', index => deriveAddress(xpub, index));
  assert.equal(first.address_index, 4);
  assert.equal(store.allocate('two', index => deriveAddress(xpub, index)).address_index, 5);
  assert.equal(store.allocate('one', () => { throw new Error('Must reuse'); }).address, first.address);
  store.sql.prepare("UPDATE settings SET value=? WHERE name='deposit_index_start'").run('-1');
  assert.throws(() => store.allocate('three', () => ''), /Invalid deposit address range/);
  store.sql.prepare("INSERT INTO settings VALUES ('deposit_allocation_retired',?)").run('reviewed-cutover');
  assert.throws(() => store.allocate('one', () => ''), /retired/);
  assert.throws(() => store.registerWallet({ fingerprint: 'fixture' }), /retired/);
  assert.equal(store.addresses().length, 2);
});

test('real MySQL zero-funds import is atomic, idempotent and reserves legacy indexes',
  { skip: process.env.TASKMALL_MYSQL_INTEGRATION !== '1', timeout: 120000 }, async t => {
    const admin = await connect();
    const database = 'taskmall_test_' + crypto.randomBytes(10).toString('hex');
    const url = new URL(process.env.MYSQL_URL || process.env.DATABASE_URL);
    const configuredDatabase = url.pathname.slice(1);
    url.pathname = '/' + database;
    let store;
    let created = false;
    t.after(async () => {
      await store?.close();
      assert.match(database, /^taskmall_test_[a-f0-9]{20}$/);
      assert.notEqual(database, configuredDatabase);
      if (created) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    });
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    created = true;
    store = await MysqlPaymentStore.open({ ...process.env, MYSQL_URL: url.toString(), DATABASE_URL: '' });
    await store.catalog(vipPlans, tasks);
    const source = snapshot();
    const duplicate = structuredClone(source);
    duplicate.state.users.push({ ...source.state.users[0], id: crypto.randomUUID(), inviteCode: 'TMOTHER01' });
    await assert.rejects(importZeroFundSnapshot(store, duplicate, await wallet(), treasury, 4), /identity conflicts/);
    assert.equal(Number((await store.sql.prepare('SELECT COUNT(*) AS n FROM users').get()).n), 0);
    assert.equal(await store.state(), null);
    assert.equal((await importZeroFundSnapshot(store, source, await wallet(), treasury, 4)).imported, true);
    assert.deepEqual(await store.state(), source.state);
    assert.equal((await importZeroFundSnapshot(store, source, await wallet(), treasury, 4)).imported, false);
    const changed = structuredClone(source);
    changed.state.users[0].name = 'Changed';
    await assert.rejects(importZeroFundSnapshot(store, changed, await wallet(), treasury, 4), /conflicts/);
    await assert.rejects(importZeroFundSnapshot(store, source, await wallet(), treasury, 0), /conflicts/);
    const allocated = await store.allocate(source.state.users[0].id, index => deriveAddress(xpub, index));
    assert.equal(allocated.address_index, 4);
    assert.equal(allocated.address, deriveAddress(xpub, 4));
    assert.equal((await store.allocate(source.state.users[0].id, () => { throw new Error('Must reuse'); })).address, allocated.address);
    await store.close();
    store = await MysqlPaymentStore.open({ ...process.env, MYSQL_URL: url.toString(), DATABASE_URL: '' });
    assert.equal((await store.address(source.state.users[0].id)).address, allocated.address);
    assert.equal(Number((await store.sql.prepare('SELECT COUNT(*) AS n FROM journal').get()).n), 0);
  });
