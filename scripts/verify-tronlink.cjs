'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { HDNodeWallet } = require('ethers');
const { PaymentStore } = require('../payments/store');
const { OutgoingLedger } = require('../payments/outgoing');
const { OperatorSessions, localRequest } = require('../payments/operator');
const { TronLinkPayouts } = require('../payments/payouts');
const { signTransfer } = require('../payments/transactions');
const { BRANCH_PATH, addressHex, tronAddress, deriveAddress, proofMessage, USDT_CONTRACT, TRANSFER_TOPIC } = require('../payments/tron');
const { unsignedToken } = require('./tron-test-helpers.cjs');

const root = path.resolve(__dirname, '..');
// Public fixture mnemonic. Never fund any address derived here.
const branch = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', '', BRANCH_PATH);
const xpub = branch.neuter().extendedKey;
const treasury = deriveAddress(xpub, 9);
const destination = deriveAddress(xpub, 7);
const feeLimit = 2_500_000;
const expectation = { from: treasury, to: destination, value: '9000000', feeLimit };

function httpRequest(headers = {}, peer = '127.0.0.1') { return { socket: { remoteAddress: peer }, headers: { host: '127.0.0.1:4173', ...headers } }; }

test('private operator grants are one-use, host-bound, short-lived and require CSRF protection', () => {
  let now = 1000;
  const sessions = new OperatorSessions({ now: () => now, ttl: 5000 });
  assert.equal(localRequest(httpRequest({ host: 'attacker.invalid' })), false);
  assert.equal(localRequest(httpRequest({}, '198.51.100.20')), false);
  assert.equal(localRequest(httpRequest({ 'sec-fetch-site': 'cross-site' })), false);
  const req = httpRequest({ origin: 'http://127.0.0.1:4173' });
  const ticket = sessions.issue(req);
  assert.equal(sessions.exchange(httpRequest({ origin: 'https://attacker.invalid' }), ticket), null);
  assert.equal(sessions.exchange(httpRequest({ host: 'localhost:4173', origin: 'http://localhost:4173' }), ticket), null);
  const grant = sessions.exchange(req, ticket);
  assert.ok(grant);
  assert.equal(sessions.exchange(req, ticket), null);
  const cookie = sessions.cookie(grant.token);
  assert.match(cookie, /Path=\/operator\/; HttpOnly; SameSite=Strict/);
  const browser = httpRequest({ cookie, origin: 'http://127.0.0.1:4173' });
  assert.ok(sessions.get(browser));
  assert.equal(sessions.get(browser, true), null);
  browser.headers['x-operator-csrf'] = grant.session.csrf;
  assert.ok(sessions.get(browser, true));
  assert.equal(sessions.get(httpRequest({ ...browser.headers, host: 'localhost:4173' })), null);
  now += 5001;
  assert.equal(sessions.get(browser), null);
  const expired = sessions.issue(req);
  now += 60_001;
  assert.equal(sessions.exchange(req, expired), null);
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-tronlink-'));
  const f = { directory, store: new PaymentStore(directory), current: { users: [{ id: 'a', withdrawBalance: 100, lockedBalance: 0, reservedBalance: 0, activities: [] }] },
    enabled: true, usdt: 100_000_000n, trx: 50_000_000, broadcasts: [], builds: 0, lostAck: false };
  f.ledger = new OutgoingLedger(f.store, treasury);
  f.store.save(f.current);
  const row = (await f.ledger.request(f.current, 'a', { key: crypto.randomUUID(), destination, gross: '10' })).record;
  await f.ledger.decide(f.current, row.id, 'approve');
  f.id = row.id;
  let queue = Promise.resolve();
  const exclusive = op => { const next = queue.then(op); queue = next.catch(() => {}); return next; };
  const client = { request: async (route, body) => {
    if (route === '/walletsolidity/triggerconstantcontract') return { result: { result: true }, constant_result: [f.usdt.toString(16).padStart(64, '0')] };
    if (route === '/walletsolidity/getaccount') return { address: addressHex(treasury), balance: f.trx };
    if (route === '/wallet/triggersmartcontract') {
      f.builds++;
      return { result: { result: true }, transaction: unsignedToken({ from: tronAddress(body.owner_address), to: destination,
        value: BigInt('0x' + body.parameter.slice(64)), feeLimit: body.fee_limit }) };
    }
    if (route === '/wallet/broadcasttransaction') {
      assert.deepEqual(await f.ledger.signedWithdrawal(f.id), body);
      assert.equal((await f.ledger.withdrawal(f.id)).status, 'submitted');
      f.broadcasts.push(structuredClone(body));
      if (f.lostAck) throw new Error('Simulated missing acknowledgement');
      return { result: true };
    }
    throw new Error('Unexpected fixture endpoint');
  } };
  f.payouts = new TronLinkPayouts({ treasury, exclusive, getLedger: () => f.ledger, getClient: () => client,
    getState: () => f.current, commitState: next => { f.current = next; }, isHealthy: () => true, isSendingEnabled: () => f.enabled });
  t.after(async () => {
    f.store.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('taskmall-tronlink-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return f;
}

test('unsigned intent is pinned once, cannot be substituted, and signed bytes survive restart before broadcast', async t => {
  const f = await fixture(t);
  const prepared = await f.payouts.prepare(f.id, feeLimit);
  assert.equal(f.broadcasts.length, 0);
  assert.equal((await f.payouts.prepare(f.id, feeLimit)).transaction.txID, prepared.transaction.txID);
  assert.equal(f.builds, 1);
  await assert.rejects(f.payouts.prepare(f.id, 3_000_000), /ALREADY_FIXED/);
  await assert.rejects(f.payouts.record(f.id, prepared.transaction), /INVALID_PAYOUT/);
  const substitute = await signTransfer(unsignedToken({ ...expectation, timestamp: prepared.transaction.raw_data.timestamp + 1 }), branch.deriveChild(9).privateKey.slice(2), expectation);
  await assert.rejects(f.payouts.record(f.id, substitute), /INTENT_MISMATCH/);
  const signed = await signTransfer(prepared.transaction, branch.deriveChild(9).privateKey.slice(2), expectation);
  await f.payouts.record(f.id, signed);
  await f.payouts.record(f.id, signed);
  assert.equal((await f.ledger.pending()).length, 1);
  assert.equal(f.current.users[0].withdrawnTotal || 0, 0);
  f.store.close();
  f.store = new PaymentStore(f.directory);
  f.ledger = new OutgoingLedger(f.store, treasury);
  f.current = f.store.state();
  assert.deepEqual(await f.ledger.signedWithdrawal(f.id), signed);
  assert.equal((await f.payouts.send(f.id)).broadcastAcknowledged, true);
  assert.equal(f.broadcasts.length, 1);
  assert.equal((await f.ledger.withdrawal(f.id)).status, 'submitted');
  assert.equal(f.current.users[0].reservedBalance, 10);
});

test('lost acknowledgement retries identical bytes; admission closure and expiry never create a replacement', async t => {
  const f = await fixture(t);
  const prepared = await f.payouts.prepare(f.id, feeLimit);
  const signed = await signTransfer(prepared.transaction, branch.deriveChild(9).privateKey.slice(2), expectation);
  f.enabled = false;
  await f.payouts.record(f.id, signed);
  await assert.rejects(f.payouts.send(f.id), /SENDING_DISABLED/);
  assert.equal(f.broadcasts.length, 0);
  f.enabled = true;
  f.lostAck = true;
  assert.equal((await f.payouts.send(f.id)).broadcastAcknowledged, false);
  f.lostAck = false;
  assert.equal((await f.payouts.send(f.id)).broadcastAcknowledged, true);
  assert.deepEqual(f.broadcasts[0], f.broadcasts[1]);
  assert.equal(f.builds, 1);
  const savedNow = Date.now;
  Date.now = () => signed.raw_data.expiration + 1;
  try {
    assert.equal((await f.payouts.send(f.id)).issue, 'SIGNED_TRANSACTION_EXPIRED');
    assert.equal(f.broadcasts.length, 2);
  } finally { Date.now = savedNow; }
  assert.equal(f.current.users[0].reservedBalance, 10);
});

test('treasury reserves and explicit limits are required; concurrent preparation keeps a single intent', async t => {
  const f = await fixture(t);
  await assert.rejects(f.payouts.prepare(f.id, undefined), /INVALID_NETWORK_FEE/);
  await assert.rejects(f.payouts.prepare(f.id, 201_000_000), /INVALID_NETWORK_FEE/);
  f.usdt = 8_000_000n;
  await assert.rejects(f.payouts.prepare(f.id, feeLimit), /USDT_INSUFFICIENT/);
  f.usdt = 100_000_000n;
  f.trx = 3_000_000;
  await assert.rejects(f.payouts.prepare(f.id, feeLimit), /TRX_RESERVE/);
  f.trx = 50_000_000;
  const [a, b] = await Promise.all([f.payouts.prepare(f.id, feeLimit), f.payouts.prepare(f.id, feeLimit)]);
  assert.equal(a.transaction.txID, b.transaction.txID);
  assert.equal(f.store.sql.prepare('SELECT count(*) AS n FROM payout_intents').get().n, 1);
  const realNow = Date.now;
  Date.now = () => a.transaction.raw_data.expiration + 1;
  try { await assert.rejects(f.payouts.prepare(f.id, feeLimit), /EXPIRED_REVIEW/); }
  finally { Date.now = realNow; }
  assert.equal(f.broadcasts.length, 0);
});

test('private browser workspace signs with a fixture wallet, preserves unknown outcomes and verifies chain settlement', { timeout: 90_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-tronlink-'));
  const walletFile = path.join(directory, 'wallet.json');
  const fixtureFile = path.join(directory, 'chain.json');
  const password = 'TronLinkFixture2026';
  const salt = crypto.randomBytes(16).toString('hex');
  const chain = { history: {}, receipts: {}, payouts: { usdt: '100000000', trx: 50_000_000, lostAck: true } };
  await fs.writeFile(walletFile, JSON.stringify({ version: 1, network: 'tron-mainnet', branchPath: BRANCH_PATH, xpub,
    treasuryAddress: treasury, firstAddress: deriveAddress(xpub, 0), proof: await branch.deriveChild(0).signMessage(proofMessage(xpub, treasury)) }));
  await fs.writeFile(fixtureFile, JSON.stringify(chain));
  await fs.writeFile(path.join(directory, 'db.json'), JSON.stringify({ users: [{ id: 'a', email: 'tronlink@test.invalid', name: 'Fixture Account',
    passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'), lockedBalance: 0, withdrawBalance: 100,
    reservedBalance: 0, activities: [], vipId: 'free', createdAt: new Date().toISOString() }] }));
  const child = spawn(process.execPath, ['--require', './scripts/tron-fixture-preload.cjs', 'server.js'], { cwd: root, windowsHide: true, stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', PUBLIC_ORIGIN: '', TRON_AUTO_WALLET: '', TASKMALL_TEST_WALLET: '',
      TASKMALL_DATA_DIR: directory, TASKMALL_SQLITE: '1', TRON_DEPOSITS_ENABLED: '1', TASKMALL_OPERATOR_ENABLED: '1', TRON_MANUAL_WITHDRAWALS_ENABLED: '1',
      TRON_TREASURY_ADDRESS: treasury, TRONGRID_API_KEY: 'fixture-only', TRON_WALLET_PUBLIC_FILE: walletFile,
      TASKMALL_TRON_FIXTURE: fixtureFile, TRON_TEST_POLL_MS: '100', TASKMALL_OPERATOR_TOKEN_FILE: '' } });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let browser;
  t.after(async () => {
    await browser?.close();
    if (child.exitCode === null) child.kill();
    await exited;
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('taskmall-tronlink-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(stderr)), 10_000);
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    exited.then(() => { clearTimeout(timer); reject(new Error(stderr)); });
  });
  const request = async (route, body, headers = {}) => {
    const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const login = await request('/api/auth/login', { email: 'tronlink@test.invalid', password });
  const customer = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  for (let i = 0; i < 50 && !(await request('/api/payment-config')).body.available; i++) await new Promise(resolve => setTimeout(resolve, 50));
  const created = await request('/api/wallet/withdraw', { amount: '10', wallet: destination, network: 'trc20', password, requestKey: crypto.randomUUID() }, customer);
  assert.equal(created.status, 201);
  const id = created.body.withdrawal.id;
  const route = '/operator/api/withdrawals/' + id;
  assert.equal((await request('/operator/api/state', undefined, customer)).status, 403);
  assert.equal((await request('/operator/app.js')).status, 403);
  assert.equal((await request('/api/operator/browser-session', {}, customer)).status, 403);
  const operatorToken = (await fs.readFile(path.join(directory, 'operator.token'), 'utf8')).trim();
  const bearer = { Authorization: 'Bearer ' + operatorToken };
  const grant = await request('/api/operator/browser-session', {}, bearer);
  const exchange = await request('/operator/session', { ticket: grant.body.ticket }, { Origin: url });
  assert.equal(exchange.status, 200);
  assert.match(exchange.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const operatorCookie = exchange.headers.get('set-cookie').split(';')[0];
  const operator = { Cookie: operatorCookie, Origin: url };
  assert.equal((await request('/operator/session', { ticket: grant.body.ticket }, { Origin: url })).status, 403);
  const info = await request('/operator/api/state', undefined, operator);
  assert.equal((await request(route + '/approve', {}, operator)).status, 403);
  operator['X-Operator-CSRF'] = info.body.csrf;
  assert.equal((await request(route + '/approve', {}, { ...operator, Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await request('/api/operator/withdrawals', undefined, operator)).status, 403);
  const { chromium } = require('playwright');
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.exposeFunction('fixtureSign', async transaction => signTransfer(transaction, branch.deriveChild(9).privateKey.slice(2), expectation));
  await context.addInitScript(({ treasury, destination, treasuryHex, destinationHex, contract, contractHex }) => {
    const f = window.walletFixture = { signs: 0, connections: 0, rejectSign: false, chain: '2b6653dc', handlers: {} };
    const web = { defaultAddress: { base58: treasury }, fullNode: { host: 'https://api.trongrid.io' }, address: { toHex: address => ({
      [treasury]: treasuryHex, [destination]: destinationHex, [contract]: contractHex })[address] }, trx: {
      getBlockByNumber: async () => ({ blockID: '0'.repeat(56) + f.chain }),
      sign: async transaction => { f.signs++; if (f.rejectSign) throw { code: 4001 }; return window.fixtureSign(transaction); }
    } };
    window.tron = { isTronLink: true, tronWeb: web, request: async ({ method }) => {
      if (method !== 'eth_requestAccounts') throw { code: 4200 }; f.connections++; return [web.defaultAddress.base58];
    }, on: (event, handler) => { f.handlers[event] = handler; }, removeListener: event => { delete f.handlers[event]; } };
  }, { treasury, destination, treasuryHex: addressHex(treasury), destinationHex: addressHex(destination), contract: USDT_CONTRACT, contractHex: addressHex(USDT_CONTRACT) });
  const ticket = (await request('/api/operator/browser-session', {}, bearer)).body.ticket;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
  await page.goto(url + '/operator/unlock#' + ticket);
  await page.waitForURL(url + '/operator/');
  await page.locator('[data-review="' + id + '"]').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await page.evaluate(() => walletFixture.connections), 0);
  const output = path.join(root, 'artifacts', 'payments');
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'operator-desktop.png') });
  await page.evaluate(destination => { tron.tronWeb.defaultAddress.base58 = destination; }, destination);
  await page.locator('#connect').click();
  await page.getByText('Select the configured treasury account in TronLink.', { exact: true }).waitFor();
  await page.evaluate(treasury => { tron.tronWeb.defaultAddress.base58 = treasury; walletFixture.chain = 'cd8690dc'; }, treasury);
  await page.locator('#connect').click();
  await page.getByText('Select TRON Mainnet with the official TronGrid node in TronLink.', { exact: true }).waitFor();
  await page.evaluate(() => { walletFixture.chain = '2b6653dc'; });
  await page.locator('#connect').click();
  await page.getByText('Treasury connected / Mainnet', { exact: true }).waitFor();
  await page.locator('[data-review="' + id + '"]').click();
  assert.equal(await page.locator('#approve').isEnabled(), false);
  await page.locator('#confirm-details').check();
  await page.locator('#approve').click();
  await page.locator('#prepare-controls').waitFor();
  await page.locator('#fee-limit').fill('2.5');
  await page.locator('#prepare').click();
  await page.locator('#transaction-details').waitFor();
  assert.equal(await page.locator('#review-network-fee').textContent(), '2.5 TRX maximum');
  await page.locator('#confirm-details').check();
  await page.evaluate(() => { walletFixture.handlers.chainChanged({ chainId: '0xcd8690dc' }); });
  assert.equal(await page.locator('#send').isVisible(), false);
  assert.equal(await page.locator('#confirm-details').isChecked(), false);
  await page.locator('#review-connect').click();
  await page.getByText('Treasury connected / Mainnet', { exact: true }).waitFor();
  await page.locator('#prepare').click();
  await page.locator('#transaction-details').waitFor();
  const txid = await page.locator('#review-txid').textContent();
  await page.locator('#confirm-details').check();
  await page.evaluate(() => { walletFixture.rejectSign = true; });
  await page.locator('#send').click();
  await page.getByText('TronLink request cancelled. No new broadcast was requested.', { exact: true }).waitFor();
  assert.equal((JSON.parse(await fs.readFile(fixtureFile, 'utf8')).broadcasts || []).length, 0);
  await page.evaluate(() => { walletFixture.rejectSign = false; });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 360, height: 740 }]]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#review').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: path.join(output, 'operator-review-' + name + '.png') });
  }
  await page.locator('#send').click();
  await page.getByText('Broadcast outcome is unknown or expired. The same transaction remains saved; do not create another payment.', { exact: true }).waitFor();
  const afterSend = JSON.parse(await fs.readFile(fixtureFile, 'utf8'));
  assert.equal(afterSend.broadcasts.length, 1);
  assert.equal(afterSend.broadcasts[0].txID, txid);
  assert.equal((await request('/api/me', undefined, customer)).body.user.withdrawnTotal || 0, 0);
  afterSend.payouts.lostAck = false;
  await fs.writeFile(fixtureFile, JSON.stringify(afterSend));
  await page.locator('#confirm-details').check();
  await page.locator('#retry').click();
  await page.getByText('Transaction broadcast acknowledged. Awaiting chain confirmation.', { exact: true }).waitFor();
  const afterRetry = JSON.parse(await fs.readFile(fixtureFile, 'utf8'));
  assert.deepEqual(afterRetry.broadcasts[0], afterRetry.broadcasts[1]);
  assert.equal(await page.evaluate(() => walletFixture.signs), 2);
  afterRetry.receipts[txid] = { id: txid, blockNumber: 999, blockTimeStamp: Date.now(), receipt: { result: 'SUCCESS' }, log: [{
    address: addressHex(USDT_CONTRACT).slice(2), topics: [TRANSFER_TOPIC, addressHex(treasury).slice(2).padStart(64, '0'),
      addressHex(destination).slice(2).padStart(64, '0')], data: (9_000_000).toString(16).padStart(64, '0') }] };
  await fs.writeFile(fixtureFile, JSON.stringify(afterRetry));
  let account;
  for (let i = 0; i < 60; i++) {
    account = (await request('/api/me', undefined, customer)).body.user;
    if (account.withdrawnTotal === 9) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(account.withdrawnTotal, 9);
  assert.equal(account.reservedBalance, 0);
  await page.locator('#close').click();
  await page.locator('#refresh').click();
  await page.locator('[data-filter="confirmed"]').click();
  await page.locator('[data-review="' + id + '"]').waitFor();
  await page.screenshot({ path: path.join(output, 'operator-mobile.png') });
  await page.locator('#logout').click();
  await page.waitForURL(url + '/operator/unlock');
  assert.equal((await context.request.get(url + '/operator/api/state')).status(), 403);
  assert.deepEqual(pageErrors, []);
});
