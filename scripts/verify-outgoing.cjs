'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { utils } = require('tronweb');
const { HDNodeWallet, Interface } = require('ethers');
const { PaymentStore } = require('../payments/store');
const { OutgoingLedger, SettlementWatcher } = require('../payments/outgoing');
const { BRANCH_PATH, USDT_CONTRACT, TRANSFER_TOPIC, addressHex, tronAddress, deriveAddress, proofMessage, validateWallet, amount } = require('../payments/tron');
const { validateTransfer, signTransfer } = require('../payments/transactions');
const { CollectionWorker, SignerJournal } = require('../payments/collector');

const root = path.resolve(__dirname, '..');
// Public test key material only. Never fund any test address in this file.
const branch = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', '', BRANCH_PATH);
const xpub = branch.neuter().extendedKey;
const treasury = 'TZBZHkdrwv6xrGzRR9a1WqStf3oEmtjDvw';
const destination = deriveAddress(xpub, 7);
const token = new Interface(['function transfer(address,uint256) returns (bool)']);

async function config() {
  return { version: 1, network: 'tron-mainnet', branchPath: BRANCH_PATH, xpub, treasuryAddress: treasury,
    firstAddress: deriveAddress(xpub, 0), proof: await branch.deriveChild(0).signMessage(proofMessage(xpub, treasury)) };
}

function state() { return { users: [{ id: 'a', lockedBalance: 0, withdrawBalance: 100, reservedBalance: 0,
  withdrawnTotal: 0, withdrawFeeTotal: 0, activities: [] }] }; }

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-outgoing-'));
  const store = new PaymentStore(directory);
  const ledger = new OutgoingLedger(store, treasury);
  const app = state();
  store.save(app);
  const cleanups = [];
  t.after(async () => {
    for (const close of cleanups) await close();
    store.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('taskmall-outgoing-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, store, ledger, app, cleanups };
}

function receipt(txid, from, to, value) {
  return { id: txid, blockNumber: 999, blockTimeStamp: Date.now(), receipt: { result: 'SUCCESS' }, log: [{
    address: addressHex(USDT_CONTRACT).slice(2), topics: [TRANSFER_TOPIC, addressHex(from).slice(2).padStart(64, '0'),
      addressHex(to).slice(2).padStart(64, '0')], data: BigInt(value).toString(16).padStart(64, '0') }] };
}

function event(txid, from, to, value) { return { txid, logIndex: 0, from, to, units: String(value), timestamp: Date.now(), blockNumber: 999 }; }

function unsigned({ from, to, value, kind = 'usdt', feeLimit = 1_000_000 }) {
  const type = kind === 'usdt' ? 'TriggerSmartContract' : 'TransferContract';
  const data = kind === 'usdt' ? { owner_address: addressHex(from), contract_address: addressHex(USDT_CONTRACT),
    data: token.encodeFunctionData('transfer', ['0x' + addressHex(to).slice(2), BigInt(value)]).slice(2), call_value: 0 }
    : { owner_address: addressHex(from), to_address: addressHex(to), amount: Number(value) };
  const transaction = { visible: false, raw_data: { ref_block_bytes: '1234', ref_block_hash: '0011223344556677',
    timestamp: Date.now(), expiration: Date.now() + 60_000, contract: [{ type, parameter: { type_url: 'type.googleapis.com/protocol.' + type, value: data } }],
    ...(kind === 'usdt' ? { fee_limit: feeLimit } : {}) } };
  const pb = utils.transaction.txJsonToPb(transaction);
  transaction.raw_data_hex = utils.transaction.txPbToRawDataHex(pb);
  transaction.txID = utils.transaction.txPbToTxID(pb).replace(/^0x/, '');
  return transaction;
}

test('withdrawal reservation is exact, idempotent and rolls back malformed requests', async t => {
  const { ledger, store, app } = await fixture(t);
  const request = { key: crypto.randomUUID(), destination, gross: '10.000001' };
  const created = await ledger.request(app, 'a', request);
  assert.equal(created.record.fee_units, '1000000');
  assert.equal(created.record.net_units, '9000001');
  assert.equal(app.users[0].withdrawBalance, 89.999999);
  assert.equal(app.users[0].reservedBalance, 10.000001);
  assert.equal((await ledger.request(app, 'a', request)).changed, false);
  await assert.rejects(() => ledger.request(structuredClone(app), 'a', { ...request, gross: '11' }), /CONFLICT/);
  await assert.rejects(() => ledger.request(structuredClone(app), 'a', { ...request, key: crypto.randomUUID(), destination: 'not-a-tron-address' }), /INVALID_WALLET/);
  await assert.rejects(() => ledger.request(structuredClone(app), 'a', { ...request, key: crypto.randomUUID(), gross: '91' }), /INSUFFICIENT/);
  assert.equal((await ledger.withdrawals('a')).length, 1);
  const rejected = await ledger.decide(app, created.record.id, 'reject');
  assert.equal(rejected.record.status, 'rejected');
  assert.equal(app.users[0].withdrawBalance, 100);
  assert.equal(app.users[0].reservedBalance, 0);
  assert.equal((await ledger.decide(app, created.record.id, 'reject')).changed, false);
  const batches = new Map();
  for (const row of store.sql.prepare('SELECT batch,delta_units FROM journal').all()) batches.set(row.batch, (batches.get(row.batch) || 0n) + BigInt(row.delta_units));
  assert.ok([...batches.values()].every(value => value === 0n));
});

test('the 10 USDT minimum is enforced without reserving rejected amounts', async t => {
  const { ledger, store, app } = await fixture(t);
  const before = structuredClone(app);
  const journalCount = store.sql.prepare('SELECT COUNT(*) AS count FROM journal').get().count;
  for (const gross of ['5', '9.99', '9.999999']) {
    await assert.rejects(() => ledger.request(app, 'a', { key: crypto.randomUUID(), destination, gross }), /WITHDRAWAL_BELOW_MINIMUM/);
    assert.deepEqual(app, before);
    assert.deepEqual(store.state().users, before.users);
    assert.equal((await ledger.withdrawals('a')).length, 0);
    assert.equal(store.sql.prepare('SELECT COUNT(*) AS count FROM journal').get().count, journalCount);
  }
  const row = (await ledger.request(app, 'a', { key: crypto.randomUUID(), destination, gross: '10' })).record;
  assert.equal(row.gross_units, '10000000');
  assert.equal(row.net_units, '9000000');
  assert.equal(app.users[0].reservedBalance, 10);
});

test('payouts settle only the exact treasury transfer and cannot reuse a transaction', async t => {
  const { ledger, store, app } = await fixture(t);
  const row = (await ledger.request(app, 'a', { key: crypto.randomUUID(), destination, gross: '10' })).record;
  await assert.rejects(() => ledger.submitWithdrawal(app, row.id, '1'.repeat(64)), /NOT_APPROVED/);
  await ledger.decide(app, row.id, 'approve');
  await assert.rejects(() => ledger.decide(app, row.id, 'reject'), /IN_PROGRESS/);
  const submitted = await ledger.submitWithdrawal(app, row.id, '1'.repeat(64));
  assert.equal(app.users[0].withdrawnTotal, 0);
  assert.equal((await ledger.submitWithdrawal(app, row.id, submitted.txid)).status, 'submitted');
  for (const wrong of [event(submitted.txid, treasury, destination, 8_000_000),
    event(submitted.txid, destination, treasury, 9_000_000), event(submitted.txid, treasury, deriveAddress(xpub, 8), 9_000_000)]) {
    await assert.rejects(() => ledger.settleWithdrawal(structuredClone(app), submitted, [wrong]), /MISMATCH/);
  }
  const exact = event(submitted.txid, treasury, destination, 9_000_000);
  await assert.rejects(() => ledger.settleWithdrawal(structuredClone(app), submitted, [exact, { ...exact, logIndex: 1 }]), /MISMATCH/);
  assert.equal(await ledger.settleWithdrawal(app, submitted, [event(submitted.txid, treasury, destination, 9_000_000)]), true);
  assert.equal(await ledger.settleWithdrawal(app, submitted, [event(submitted.txid, treasury, destination, 9_000_000)]), false);
  assert.equal(app.users[0].reservedBalance, 0);
  assert.equal(app.users[0].withdrawnTotal, 9);
  assert.equal(app.users[0].withdrawFeeTotal, 1);
  assert.equal(store.state().users[0].activities[0].status, 'confirmed');
  const another = (await ledger.request(app, 'a', { key: crypto.randomUUID(), destination, gross: '10' })).record;
  await ledger.decide(app, another.id, 'approve');
  await assert.rejects(() => ledger.submitWithdrawal(app, another.id, submitted.txid), /ALREADY_USED/);
});

test('settlement recovers after outage and never treats a wrong or failed payment as paid', async t => {
  const { ledger, app } = await fixture(t);
  const row = (await ledger.request(app, 'a', { key: crypto.randomUUID(), destination, gross: '20' })).record;
  await ledger.decide(app, row.id, 'approve');
  const txid = '2'.repeat(64);
  await ledger.submitWithdrawal(app, row.id, txid);
  let current = app;
  let info = {};
  let offline = true;
  const watcher = new SettlementWatcher({ ledger, getState: () => current, commitState: next => { current = next; }, exclusive: async operation => operation(),
    client: { solidHeight: async () => { if (offline) throw new Error('offline'); return 1000; }, receipt: async () => info } });
  await watcher.poll();
  assert.equal((await ledger.withdrawal(row.id)).status, 'submitted');
  offline = false;
  await watcher.poll();
  assert.equal((await ledger.withdrawal(row.id)).issue, 'AWAITING_CONFIRMATION');
  info = receipt(txid, treasury, destination, 17_000_000);
  await watcher.poll();
  assert.equal((await ledger.withdrawal(row.id)).issue, 'PAYOUT_RECEIPT_MISMATCH');
  info = receipt(txid, treasury, destination, 18_000_000);
  info.receipt.result = 'REVERT';
  await watcher.poll();
  assert.equal(current.users[0].withdrawnTotal, 0);
  info.receipt.result = 'SUCCESS';
  await watcher.poll();
  assert.equal(current.users[0].withdrawnTotal, 18);
  assert.equal((await ledger.withdrawal(row.id)).status, 'confirmed');
});

test('only a solidified failed payout can release a reservation; missing and successful transfers cannot', async t => {
  const { ledger, app } = await fixture(t);
  const row = (await ledger.request(app, 'a', { key: crypto.randomUUID(), destination, gross: '10' })).record;
  await ledger.decide(app, row.id, 'approve');
  const txid = '7'.repeat(64);
  await ledger.submitWithdrawal(app, row.id, txid);
  await assert.rejects(() => ledger.releaseFailed(structuredClone(app), 'withdrawal', row.id, {}, 1000));
  const info = receipt(txid, treasury, destination, 9_000_000);
  await assert.rejects(() => ledger.releaseFailed(structuredClone(app), 'withdrawal', row.id, info, 1000), /NOT_VERIFIED/);
  info.receipt.result = 'REVERT';
  await assert.rejects(() => ledger.releaseFailed(structuredClone(app), 'withdrawal', row.id, info, 998), /solidified/);
  assert.equal(app.users[0].reservedBalance, 10);
  assert.equal(await ledger.releaseFailed(app, 'withdrawal', row.id, info, 1000), true);
  assert.equal(app.users[0].withdrawBalance, 100);
  assert.equal(app.users[0].reservedBalance, 0);
  assert.equal(app.users[0].withdrawnTotal, 0);
  await assert.rejects(() => ledger.releaseFailed(app, 'withdrawal', row.id, info, 1000), /NOT_PENDING/);
});

test('collection claims only verified deposits and does not credit them twice', async t => {
  const { ledger, store, app } = await fixture(t);
  const address = store.allocate('a', index => deriveAddress(xpub, index));
  store.credit(event('3'.repeat(64), treasury, address.address, 10_000_000), app, (target, id, transfer) => { target.users[0].lockedBalance += amount(transfer.units); });
  const job = (await ledger.planCollections())[0];
  assert.equal((await ledger.planCollections()).length, 1);
  store.credit(event('4'.repeat(64), treasury, address.address, 2_000_000), app, target => { target.users[0].lockedBalance += 2; });
  assert.equal((await ledger.planCollections())[0].amount_units, '10000000');
  const expectation = { from: job.address, to: treasury, value: job.amount_units, feeLimit: 1_000_000 };
  const signed = await signTransfer(unsigned(expectation), branch.deriveChild(0).privateKey.slice(2), expectation);
  await ledger.recordCollection(job.id, signed, transaction => validateTransfer(transaction, expectation));
  const saved = (await ledger.collections())[0];
  assert.equal(saved.status, 'signed');
  assert.ok(saved.payload.includes(signed.txID));
  await assert.rejects(() => ledger.settleCollection(saved, [event(saved.txid, saved.address, destination, 10_000_000)]), /MISMATCH/);
  await ledger.settleCollection(saved, [event(saved.txid, saved.address, treasury, 10_000_000)]);
  assert.equal((await ledger.planCollections())[0].amount_units, '2000000');
  assert.equal(store.state().users[0].lockedBalance, 12);
});

test('offline signing rejects altered bytes, destinations, owners, fees and signatures', async () => {
  const expectation = { from: deriveAddress(xpub, 0), to: treasury, value: '10000000', feeLimit: 1_000_000 };
  const signed = await signTransfer(unsigned(expectation), branch.deriveChild(0).privateKey.slice(2), expectation);
  assert.equal(validateTransfer(signed, expectation).txID, signed.txID);
  const corrupt = structuredClone(signed);
  corrupt.raw_data.contract[0].parameter.value.contract_address = addressHex(destination);
  assert.throws(() => validateTransfer(corrupt, expectation), /bytes/);
  for (const alteration of [{ to: destination }, { from: destination }, { value: '9999999' }, { feeLimit: 999999 }]) {
    assert.throws(() => validateTransfer(signed, { ...expectation, ...alteration }));
  }
  const other = unsigned({ ...expectation, from: destination });
  const wrongKey = await signTransfer(other, branch.deriveChild(7).privateKey.slice(2), { ...expectation, from: destination });
  const wrongSignature = { ...signed, signature: wrongKey.signature };
  assert.throws(() => validateTransfer(wrongSignature, expectation), /signer/);
});

test('collector persists before broadcast, retries identical bytes and caps fuel spending', async t => {
  const { ledger, store, app, directory, cleanups } = await fixture(t);
  const allocated = store.allocate('a', index => deriveAddress(xpub, index));
  store.credit(event('5'.repeat(64), treasury, allocated.address, 10_000_000), app, target => { target.users[0].lockedBalance = 10; });
  const wallet = validateWallet(await config(), treasury);
  const gasKey = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', '', "m/44'/195'/1'/0/0");
  const gasWallet = { address: tronAddress(gasKey.address.slice(2)), privateKey: gasKey.privateKey.slice(2) };
  let journal = new SignerJournal(path.join(directory, 'signer'));
  cleanups.push(() => journal.close());
  let fuelConfirmed = false;
  const broadcasts = [];
  const client = { async request(route, body) {
    if (route === '/walletsolidity/triggerconstantcontract') return { result: { result: true }, constant_result: ['a'.repeat(64)] };
    if (route === '/walletsolidity/getaccount') return { balance: body.address === addressHex(gasWallet.address) ? 100_000_000 : fuelConfirmed ? 2_000_000 : 0 };
    if (route === '/wallet/createtransaction') return unsigned({ from: gasWallet.address, to: allocated.address, value: body.amount, kind: 'trx' });
    if (route === '/walletsolidity/gettransactionbyid') return fuelConfirmed ? { txID: body.value, ret: [{ contractRet: 'SUCCESS' }] } : {};
    if (route === '/wallet/triggersmartcontract') return { result: { result: true }, transaction: unsigned({ from: allocated.address, to: treasury, value: '10000000' }) };
    if (route === '/wallet/broadcasttransaction') {
      const kind = body.raw_data.contract[0].type;
      if (kind === 'TriggerSmartContract') assert.equal((await ledger.collections())[0].txid, body.txID, 'Signed token transaction must be persisted before broadcast');
      if (kind === 'TransferContract') assert.ok(journal.funding((await ledger.collections())[0].id));
      broadcasts.push({ txid: body.txID, kind });
      return { result: true };
    }
    throw new Error('Unexpected fixture endpoint: ' + route);
  } };
  const operator = async (route, body) => {
    if (route === 'collections/plan') return { treasury, feeLimitSun: 1_000_000, collections: await ledger.planCollections() };
    const id = route.split('/')[1];
    return { collection: await ledger.recordCollection(id, body.transaction, (transaction, job) => validateTransfer(transaction,
      { from: job.address, to: treasury, value: job.amount_units, feeLimit: 1_000_000 })) };
  };
  const worker = new CollectionWorker({ operator, client, wallet, treasury, branch, gasWallet, journal,
    feeLimit: 1_000_000, feeDailyLimit: '2000000', gasEnabled: true, gasDailyLimit: '4000000' });
  assert.equal((await worker.cycle())[0].status, 'awaiting-gas-confirmation');
  worker.gasEnabled = false;
  assert.equal((await worker.cycle())[0].status, 'TRX_FEE_RESERVE_REQUIRED');
  assert.equal(broadcasts.length, 1, 'Disabled funding must not rebroadcast a pending gas transaction');
  worker.gasEnabled = true;
  journal.close();
  journal = new SignerJournal(path.join(directory, 'signer'));
  worker.journal = journal;
  assert.equal((await worker.cycle())[0].status, 'awaiting-gas-confirmation');
  assert.equal(new Set(broadcasts.map(row => row.txid)).size, 1);
  fuelConfirmed = true;
  assert.equal((await worker.cycle())[0].status, 'awaiting-confirmation');
  const signedJob = (await ledger.collections())[0];
  const recordedBeforeRetry = signedJob.txid;
  const previous = client.request;
  client.request = async (route, body) => { if (route === '/wallet/broadcasttransaction') throw new Error('fixture lost acknowledgment'); return previous.call(client, route, body); };
  assert.equal((await worker.cycle())[0].status, 'PAUSED_FOR_REVIEW');
  assert.equal((await ledger.collections())[0].txid, recordedBeforeRetry);
  client.request = previous;
  assert.equal((await worker.cycle())[0].status, 'awaiting-confirmation');
  assert.equal(new Set(broadcasts.filter(row => row.kind === 'TriggerSmartContract').map(row => row.txid)).size, 1);
  assert.throws(() => journal.reserve('gas', 'second-job', 1n, 4_000_000n), /DAILY_SPENDING/);
  assert.equal(app.users[0].lockedBalance, 10);
  let sentAfterStop = false;
  worker.shouldStop = () => true;
  client.request = async () => { sentAfterStop = true; throw new Error('No network after stop'); };
  await assert.rejects(worker.process(signedJob), /STOPPED/);
  assert.equal(sentAfterStop, false);
  const bad = { ...(await ledger.collections())[0], treasury: destination };
  await assert.rejects(worker.process(bad), /UNTRUSTED/);
});

test('real withdrawal API requires password and operator authorization; mobile and desktop render', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-outgoing-'));
  const walletFile = path.join(directory, 'wallet.json');
  const fixtureFile = path.join(directory, 'chain.json');
  const password = 'OutgoingTest2026';
  const salt = crypto.randomBytes(16).toString('hex');
  await fs.writeFile(walletFile, JSON.stringify(await config()));
  await fs.writeFile(fixtureFile, JSON.stringify({ history: {}, receipts: {} }));
  await fs.writeFile(path.join(directory, 'db.json'), JSON.stringify({ users: [{ ...state().users[0], email: 'outgoing@test.invalid', name: 'Test Account',
    passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'), vipId: 'free', createdAt: new Date().toISOString() }] }));
  const child = spawn(process.execPath, ['--require', './scripts/tron-fixture-preload.cjs', 'server.js'], { cwd: root, windowsHide: true, stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', PUBLIC_ORIGIN: '', TRON_AUTO_WALLET: '', TASKMALL_TEST_WALLET: '',
      TASKMALL_DATA_DIR: directory, TASKMALL_SQLITE: '1', TRON_DEPOSITS_ENABLED: '1', TASKMALL_OPERATOR_ENABLED: '1', TRON_MANUAL_WITHDRAWALS_ENABLED: '1',
      TRONGRID_API_KEY: 'fixture-only', TRON_WALLET_PUBLIC_FILE: walletFile, TASKMALL_TRON_FIXTURE: fixtureFile, TRON_TEST_POLL_MS: '100' } });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let browser;
  t.after(async () => {
    await browser?.close();
    if (child.exitCode === null) child.kill();
    await exited;
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('taskmall-outgoing-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errors)), 10000);
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    exited.then(() => { clearTimeout(timer); reject(new Error(errors)); });
  });
  const request = async (route, body, headers = {}) => {
    const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const login = await request('/api/auth/login', { email: 'outgoing@test.invalid', password });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const customer = { Cookie: cookie };
  for (let i = 0; i < 30 && !(await request('/api/payment-config')).body.available; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await request('/api/payment-config')).body.withdrawalsAvailable, true);
  assert.equal((await request('/api/payment-config')).body.minimumWithdrawalAmount, 10);
  const body = { amount: '10', wallet: destination, network: 'trc20', password, requestKey: crypto.randomUUID() };
  assert.equal((await request('/api/wallet/withdraw', { ...body, password: 'wrong' }, customer)).status, 403);
  const before = (await request('/api/me', undefined, customer)).body.user;
  for (const amount of ['5', '9.99', '9.999999']) {
    const rejected = await request('/api/wallet/withdraw', { ...body, amount, requestKey: crypto.randomUUID() }, customer);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'WITHDRAWAL_BELOW_MINIMUM');
    const unchanged = (await request('/api/me', undefined, customer)).body.user;
    assert.equal(unchanged.withdrawBalance, before.withdrawBalance);
    assert.equal(unchanged.reservedBalance, before.reservedBalance);
  }
  assert.equal((await request('/api/wallet/withdrawals', undefined, customer)).body.withdrawals.length, 0);
  const created = await request('/api/wallet/withdraw', body, customer);
  assert.equal(created.status, 201);
  assert.equal((await request('/api/wallet/withdraw', body, customer)).body.user.reservedBalance, 10);
  assert.equal((await request('/api/wallet/withdraw', { ...body, amount: '10.0000001', requestKey: crypto.randomUUID() }, customer)).status, 400);
  const micro = await request('/api/wallet/withdraw', { ...body, amount: '10.000005', requestKey: crypto.randomUUID() }, customer);
  assert.equal(micro.status, 201);
  const id = created.body.withdrawal.id;
  assert.equal((await request('/api/operator/withdrawals/' + id + '/approve', {}, customer)).status, 403);
  const credential = (await fs.readFile(path.join(directory, 'operator.token'), 'utf8')).trim();
  const admin = { Authorization: 'Bearer ' + credential };
  assert.equal((await request('/api/operator/withdrawals/' + micro.body.withdrawal.id + '/reject', {}, admin)).status, 200);
  assert.equal((await request('/api/operator/withdrawals/' + id + '/approve', {}, admin)).status, 200);
  const txid = '6'.repeat(64);
  assert.equal((await request('/api/operator/withdrawals/' + id + '/record', { txid }, admin)).status, 200);
  await fs.writeFile(fixtureFile, JSON.stringify({ history: {}, receipts: { [txid]: receipt(txid, treasury, destination, 9_000_000) } }));
  let account;
  for (let i = 0; i < 40; i++) {
    account = (await request('/api/me', undefined, customer)).body.user;
    if (account.withdrawnTotal === 9) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(account.withdrawnTotal, 9);
  assert.equal(account.reservedBalance, 0);
  assert.equal((await request('/api/wallet/withdrawals', undefined, customer)).body.withdrawals.find(item => item.id === id).status, 'confirmed');
  const failed = await request('/api/wallet/withdraw', { ...body, amount: '10', requestKey: crypto.randomUUID() }, customer);
  assert.equal(failed.status, 201);
  const failedId = failed.body.withdrawal.id;
  const failedTxid = '8'.repeat(64);
  await request('/api/operator/withdrawals/' + failedId + '/approve', {}, admin);
  await request('/api/operator/withdrawals/' + failedId + '/record', { txid: failedTxid }, admin);
  const failedInfo = receipt(failedTxid, treasury, destination, 9_000_000);
  failedInfo.receipt.result = 'REVERT';
  await fs.writeFile(fixtureFile, JSON.stringify({ history: {}, receipts: {
    [txid]: receipt(txid, treasury, destination, 9_000_000), [failedTxid]: failedInfo } }));
  assert.equal((await request('/api/operator/withdrawals/' + failedId + '/release-failed', {}, admin)).status, 200);
  assert.equal((await request('/api/me', undefined, customer)).body.user.reservedBalance, 0);
  assert.equal((await request('/api/me', undefined, customer)).body.user.withdrawnTotal, 9);
  const { chromium } = require('playwright');
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([{ name: 'taskmall_session', value: cookie.split('=')[1], url }]);
  await context.addInitScript(() => localStorage.setItem('taskmall_language', 'en'));
  const page = await context.newPage();
  const uiErrors = [];
  page.on('pageerror', error => uiErrors.push(error.message));
  const output = path.join(root, 'artifacts', 'payments');
  await fs.mkdir(output, { recursive: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 360, height: 740 }]]) {
    await page.setViewportSize(viewport);
    await page.goto(url + '/#wallet');
    await page.locator('.wallet-command-bar [data-wallet-type="withdraw"]').click();
    await page.locator('[data-wallet-form="withdraw"]').waitFor();
    assert.equal(await page.locator('[data-wallet-form="withdraw"] [name="amount"]').getAttribute('min'), '10');
    assert.match(await page.locator('#withdrawal-minimum').textContent(), /10 USDT/);
    await page.locator('[data-wallet-form="withdraw"] [name="amount"]').fill('9.999999');
    assert.equal(await page.locator('[data-wallet-form="withdraw"] [name="amount"]').evaluate(input => input.validity.rangeUnderflow), true);
    await page.locator('[data-wallet-form="withdraw"] [name="amount"]').fill('10');
    assert.equal(await page.locator('[data-withdraw-net]').textContent(), '9.00 USDT');
    assert.equal(await page.locator('[data-wallet-form="withdraw"] [name="amount"]').evaluate(input => input.checkValidity()), true);
    await page.locator('[data-wallet-form="withdraw"] [name="amount"]').fill('10.000005');
    assert.equal(await page.locator('[data-withdraw-net]').textContent(), '9.000004 USDT');
    await page.locator('[data-wallet-form="withdraw"] [name="amount"]').fill('10');
    assert.equal(await page.locator('[name="password"]').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const submitBox = await page.locator('[data-wallet-form="withdraw"] button[type="submit"]').boundingBox();
    assert.ok(submitBox && submitBox.y >= 0 && submitBox.y + submitBox.height <= viewport.height, 'Withdrawal submit button must fit the viewport');
    await page.screenshot({ path: path.join(output, 'withdraw-' + name + '.png') });
  }
  await page.locator('[data-wallet-form="withdraw"] [name="wallet"]').fill(destination);
  await page.locator('[data-wallet-form="withdraw"] [name="password"]').fill(password);
  await page.locator('[data-wallet-form="withdraw"] button[type="submit"]').click();
  await page.locator('[data-wallet-form="withdraw"]').waitFor({ state: 'detached' });
  const queued = (await request('/api/wallet/withdrawals', undefined, customer)).body.withdrawals;
  assert.equal(queued.filter(row => row.status === 'requested' && row.amount === 10 && row.netAmount === 9).length, 1);
  assert.equal((await request('/api/me', undefined, customer)).body.user.reservedBalance, 10);
  await page.reload();
  await page.locator('.wallet-command-bar').waitFor();
  await page.locator('[data-language-select]').selectOption('ka');
  await page.locator('.wallet-command-bar [data-wallet-type="withdraw"]').click();
  await page.locator('[data-wallet-form="withdraw"]').waitFor();
  assert.match(await page.locator('#withdrawal-minimum').textContent(), /გატანის მოთხოვნის მინიმუმი: 10 USDT/);
  await page.keyboard.press('Escape');

  const readyConfig = (await request('/api/payment-config')).body;
  let paymentConfig = { ...readyConfig, available: false, withdrawalsAvailable: false, networks: [] };
  let metadataUnavailable = false;
  let addressUnavailable = true;
  let addressRequests = 0;
  await page.route('**/api/payment-config', route => metadataUnavailable
    ? route.fulfill({ status: 503, json: { error: 'PAYMENTS_UNAVAILABLE' } })
    : route.fulfill({ json: paymentConfig }));
  await page.route('**/api/wallet/deposit-address', route => {
    addressRequests++;
    return addressUnavailable ? route.fulfill({ status: 503, json: { error: 'DEPOSITS_UNAVAILABLE' } }) : route.continue();
  });
  await page.reload();
  await page.locator('.wallet-command-bar').waitFor();
  paymentConfig = readyConfig;
  await page.locator('.wallet-command-bar [data-wallet-type="withdraw"]').click();
  await page.locator('[data-wallet-form="withdraw"]').waitFor();
  assert.equal(addressRequests, 0, 'Withdrawal checks do not depend on allocating a deposit address');
  await page.keyboard.press('Escape');

  metadataUnavailable = true;
  await page.locator('.wallet-command-bar [data-wallet-type="withdraw"]').click();
  await page.locator('[data-action="retry-wallet"]').waitFor();
  assert.equal(await page.locator('.modal-wallet-form').count(), 0, 'A failed fresh status check must not expose a cached form');
  metadataUnavailable = false;
  await page.locator('[data-action="retry-wallet"]').click();
  await page.locator('[data-wallet-form="withdraw"]').waitFor();
  await page.keyboard.press('Escape');

  await page.reload();
  await page.locator('.wallet-command-bar').waitFor();
  assert.equal(addressRequests, 1);
  await page.locator('.wallet-command-bar [data-wallet-type="withdraw"]').click();
  await page.locator('[data-wallet-form="withdraw"]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.wallet-command-bar [data-wallet-type="deposit"]').click();
  await page.locator('[data-action="retry-wallet"]').waitFor();
  assert.equal(await page.locator('.deposit-qr').count(), 0);
  addressUnavailable = false;
  await page.locator('[data-action="retry-wallet"]').click();
  await page.locator('.deposit-qr').waitFor();
  assert.equal(await page.locator('.native-address-row code').textContent(), (await request('/api/wallet/deposit-address', {}, customer)).body.address);
  await page.keyboard.press('Escape');

  for (const config of [{ ...readyConfig, withdrawalsAvailable: false }, { ...readyConfig, withdrawalsAvailable: undefined }]) {
    paymentConfig = config;
    await page.locator('.wallet-command-bar [data-wallet-type="withdraw"]').click();
    await page.locator('[data-action="retry-wallet"]').waitFor();
    assert.equal(await page.locator('[data-wallet-form="withdraw"]').count(), 0, 'Withdrawal admission needs an explicit ready flag');
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(uiErrors, []);
});
