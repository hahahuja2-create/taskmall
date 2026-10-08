'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { HDNodeWallet } = require('ethers');
const { BRANCH_PATH, USDT_CONTRACT, TRANSFER_TOPIC, deriveAddress, addressHex, units, amount,
  proofMessage, validateWallet, decodeTransfers, TronGrid } = require('../payments/tron');
const { PaymentStore } = require('../payments/store');
const { DepositWatcher } = require('../payments/watcher');

const root = path.resolve(__dirname, '..');
const treasury = 'TZBZHkdrwv6xrGzRR9a1WqStf3oEmtjDvw';
// Public, well-known test mnemonic. Never fund any address derived from it.
const mnemonic = 'test test test test test test test test test test test junk';
const branch = HDNodeWallet.fromPhrase(mnemonic, '', BRANCH_PATH);
const xpub = branch.neuter().extendedKey;

async function configuration() {
  return { version: 1, network: 'tron-mainnet', branchPath: BRANCH_PATH, xpub, treasuryAddress: treasury,
    firstAddress: deriveAddress(xpub, 0), proof: await branch.deriveChild(0).signMessage(proofMessage(xpub, treasury)) };
}

async function temporary(t) {
  return fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-payments-'));
}

function cleanup(t, directory) {
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('taskmall-payments-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
}

function receipt(txid, to, value = 1_234_567n) {
  return { id: txid, blockNumber: 999, blockTimeStamp: Date.now(), receipt: { result: 'SUCCESS' },
    log: [{ address: addressHex(USDT_CONTRACT).slice(2), topics: [TRANSFER_TOPIC,
      addressHex(treasury).slice(2).padStart(64, '0'), addressHex(to).slice(2).padStart(64, '0')],
      data: value.toString(16).padStart(64, '0') }] };
}

test('public HD derivation, owner proof and exact six-decimal units', async () => {
  const config = await configuration();
  assert.equal(validateWallet(config, treasury).firstAddress, deriveAddress(xpub, 0));
  const addresses = Array.from({ length: 100 }, (_, index) => deriveAddress(xpub, index));
  assert.equal(new Set(addresses).size, 100);
  for (const address of addresses) assert.equal(addressHex(address).length, 42);
  assert.throws(() => deriveAddress(branch.extendedKey, 0), /public/);
  assert.throws(() => deriveAddress(xpub, 0x80000000), /index/);
  assert.throws(() => validateWallet({ ...config, firstAddress: treasury }, treasury), /proof/);
  assert.throws(() => validateWallet({ ...config, treasuryAddress: deriveAddress(xpub, 4) }, treasury), /configuration/);
  assert.throws(() => addressHex(treasury.slice(0, -1) + 'x'), /checksum/);
  assert.equal(units('0.000001'), 1n);
  assert.equal(amount(units('1.234567')), 1.234567);
  assert.throws(() => units('1.0000001'), /amount/);
  assert.throws(() => units('-1'), /amount/);
});

test('receipt decoding trusts only solidified successful official USDT logs', () => {
  const txid = 'a'.repeat(64);
  const info = receipt(txid, deriveAddress(xpub, 0));
  info.log.push({ ...info.log[0], topics: [...info.log[0].topics], data: '2'.padStart(64, '0') });
  const events = decodeTransfers(info, txid, 1000);
  assert.equal(events.length, 2);
  assert.equal(events[0].units, '1234567');
  assert.equal(events[1].logIndex, 1);
  assert.deepEqual(decodeTransfers({ ...info, receipt: { result: 'REVERT' } }, txid, 1000), []);
  assert.throws(() => decodeTransfers(info, txid, 998), /solidified/);
  assert.throws(() => decodeTransfers({ ...info, id: 'b'.repeat(64) }, txid, 1000), /identity/);
  const fake = structuredClone(info);
  fake.log.forEach(log => { log.address = addressHex(treasury).slice(2); });
  assert.deepEqual(decodeTransfers(fake, txid, 1000), []);
});

test('SQLite allocation, atomic credits, rollback, balanced journal and restart', async t => {
  const directory = await temporary(t);
  let store = new PaymentStore(directory);
  t.after(() => store.close());
  cleanup(t, directory);
  assert.throws(() => new PaymentStore(directory), /locked/);
  let state = { users: [{ id: 'user-a', lockedBalance: 0, withdrawBalance: 0 }] };
  store.save(state);
  store.registerWallet(validateWallet(await configuration(), treasury));
  const record = store.allocate('user-a', index => deriveAddress(xpub, index));
  assert.equal(record.address, store.allocate('user-a', () => { throw new Error('Already allocated'); }).address);
  const event = decodeTransfers(receipt('c'.repeat(64), record.address), 'c'.repeat(64), 1000)[0];
  function credit(target, userId, transfer) { target.users.find(user => user.id === userId).lockedBalance = amount(BigInt(transfer.units)); }
  assert.equal(store.credit(event, state, credit), true);
  assert.equal(store.credit(event, state, credit), false);
  assert.equal(store.state().users[0].lockedBalance, 1.234567);
  const failed = { ...event, txid: 'd'.repeat(64) };
  assert.throws(() => store.credit(failed, structuredClone(state), target => { target.users[0].withdrawBalance = -1; }), /amount/);
  assert.equal(store.deposits('user-a').length, 1);
  const deltas = store.sql.prepare('SELECT batch,delta_units FROM journal').all();
  const batches = new Map();
  for (const row of deltas) batches.set(row.batch, (batches.get(row.batch) || 0n) + BigInt(row.delta_units));
  for (const value of batches.values()) assert.equal(value, 0n);
  const shortLived = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true, stdio: 'ignore' });
  await new Promise(resolve => shortLived.once('exit', resolve));
  store.sql.prepare('UPDATE writer_lease SET pid=? WHERE id=1').run(shortLived.pid);
  store.close();
  store = new PaymentStore(directory);
  assert.equal(store.state().users[0].lockedBalance, 1.234567);
  assert.equal(store.address('user-a').address, record.address);
  assert.equal(store.credit(event, store.state(), credit), false);
});

test('monitor handles paging, replay, multiple recipients, outage and recovery', async t => {
  const directory = await temporary(t);
  const store = new PaymentStore(directory);
  t.after(() => store.close());
  cleanup(t, directory);
  const walletFile = path.join(directory, 'wallet.json');
  await fs.writeFile(walletFile, JSON.stringify(await configuration()));
  let state = { users: [{ id: 'a', lockedBalance: 0, withdrawBalance: 0 }, { id: 'b', lockedBalance: 0, withdrawBalance: 0 }] };
  store.save(state);
  const a = store.allocate('a', index => deriveAddress(xpub, index));
  const b = store.allocate('b', index => deriveAddress(xpub, index));
  const txid = 'e'.repeat(64);
  const info = receipt(txid, a.address, 1111111n);
  info.log.push(receipt(txid, b.address, 2222222n).log[0]);
  let offline = false;
  let pages = 0;
  const client = {
    async solidHeight() { if (offline) throw new Error('TRON_NETWORK_HTTP_503'); return 1000; },
    async history(address, since, cursor) { pages++; return { rows: [{ transaction_id: txid, value: '999999999' }], next: cursor ? null : 'page-two' }; },
    async receipt() { return info; }
  };
  const watcher = new DepositWatcher({ store, walletFile, treasury, client, exclusive: async operation => operation(),
    credit(event) {
      const next = structuredClone(state);
      if (store.credit(event, next, (target, userId, transfer) => { target.users.find(user => user.id === userId).lockedBalance = amount(BigInt(transfer.units)); })) state = next;
    } });
  await watcher.poll();
  assert.equal(watcher.ready(), true);
  assert.equal(pages, 4);
  assert.equal(state.users[0].lockedBalance, 1.111111);
  assert.equal(state.users[1].lockedBalance, 2.222222);
  await watcher.poll();
  assert.equal(store.deposits('a').length, 1);
  const checkpoint = store.address('a').scanned_at;
  offline = true;
  await watcher.poll();
  assert.equal(watcher.ready(), false);
  assert.equal(store.address('a').scanned_at, checkpoint);
  offline = false;
  await watcher.poll();
  assert.equal(watcher.ready(), true);
  watcher.stop();
});

test('TronGrid queries are confirmed, contract-filtered and reject unsafe pagination', async () => {
  let request;
  const client = new TronGrid('fixture-credential', async (url, options) => {
    request = { url: new URL(url), options };
    return Response.json({ data: [], meta: { links: { next: 'https://example.invalid/steal?fingerprint=x' } } });
  });
  await assert.rejects(client.history(treasury, 10), /cursor/);
  assert.equal(request.url.searchParams.get('only_confirmed'), 'true');
  assert.equal(request.url.searchParams.get('contract_address'), USDT_CONTRACT);
  assert.equal(request.options.headers['TRON-PRO-API-KEY'], 'fixture-credential');
  assert.equal(request.options.redirect, 'error');
});

async function startProcess(t, script, env, preload = false) {
  const child = spawn(process.execPath, [...(preload ? ['--require', './scripts/tron-fixture-preload.cjs'] : []), script], {
    cwd: root, windowsHide: true, stdio: 'pipe', env: { ...process.env, TRON_AUTO_WALLET: '', ...env }
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Process did not start: ' + errors)), 10_000);
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+(?:\/#[-\w]+)?/);
      if (match) { clearTimeout(timer); resolve({ url: match[0], child }); }
    });
    exited.then(() => { clearTimeout(timer); reject(new Error('Process exited: ' + errors)); });
  });
}

test('real API wiring allocates separate addresses and credits verified receipt fixtures only', async t => {
  const directory = await temporary(t);
  const walletFile = path.join(directory, 'wallet.json');
  const fixtureFile = path.join(directory, 'chain.json');
  await fs.writeFile(walletFile, JSON.stringify(await configuration()));
  await fs.writeFile(fixtureFile, JSON.stringify({ history: {}, receipts: {} }));
  const { url } = await startProcess(t, 'server.js', { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
    PUBLIC_ORIGIN: '', TASKMALL_TEST_WALLET: '', TASKMALL_DATA_DIR: directory, TASKMALL_SQLITE: '1', TRON_DEPOSITS_ENABLED: '1',
    TRON_WALLET_PUBLIC_FILE: walletFile, TRONGRID_API_KEY: 'fixture-only', TRON_TEST_POLL_MS: '100', TASKMALL_TRON_FIXTURE: fixtureFile }, true);
  cleanup(t, directory);
  const request = async (route, body, cookie) => {
    const response = await fetch(url + route, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  for (let i = 0; i < 30 && !(await request('/api/payment-config')).body.available; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await request('/api/payment-config')).body.mode, 'tron-watch-only');
  const signup = await request('/api/auth/signup', { email: 'chain@test.invalid', password: 'PaymentTest2026' });
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/wallet/deposit-address', {})).status, 401);
  const address = await request('/api/wallet/deposit-address', {}, cookie);
  assert.equal(address.status, 200);
  assert.equal(address.body.address, deriveAddress(xpub, 0));
  assert.match(address.body.qr, /^data:image\/png;base64,/);
  assert.equal((await request('/api/wallet/deposit', { amount: 5000, network: 'trc20' }, cookie)).status, 503);
  const txid = 'f'.repeat(64);
  const info = receipt(txid, address.body.address);
  await fs.writeFile(fixtureFile, JSON.stringify({ history: { [address.body.address]: [{ transaction_id: txid, block_timestamp: info.blockTimeStamp }] }, receipts: { [txid]: info } }));
  let account;
  for (let i = 0; i < 40; i++) {
    account = await request('/api/me', undefined, cookie);
    if (account.body.user.lockedBalance === 1.234567) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(account.body.user.lockedBalance, 1.234567);
  assert.equal((await request('/api/wallet/deposits', undefined, cookie)).body.deposits.length, 1);
  assert.equal((await request('/api/wallet/withdraw', { amount: 5, wallet: treasury }, cookie)).status, 503);
  const second = await request('/api/auth/signup', { email: 'second@test.invalid', password: 'PaymentTest2026' });
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/wallet/deposit-address', {}, secondCookie)).body.address, deriveAddress(xpub, 1));
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.addCookies([{ name: 'taskmall_session', value: cookie.split('=')[1], url }]);
  await context.addInitScript(() => localStorage.setItem('taskmall_language', 'en'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = path.join(root, 'artifacts', 'payments');
  await fs.mkdir(output, { recursive: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 360, height: 740 }]]) {
    await page.setViewportSize(viewport);
    await page.goto(url + '/#wallet');
    await page.locator('.wallet-command-bar [data-wallet-type="deposit"]').click();
    await page.locator('.deposit-qr').waitFor();
    assert.equal(await page.locator('.native-address-row code').textContent(), address.body.address);
    assert.equal(await page.locator('form[data-wallet-form="deposit"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => document.querySelector('.deposit-qr').naturalWidth > 0), true);
    await page.screenshot({ path: path.join(output, 'deposit-' + name + '.png') });
  }
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('unconfigured wallets never expose a treasury address or allow customer funding', async t => {
  const directory = await temporary(t);
  const fixtureFile = path.join(directory, 'chain.json');
  await fs.writeFile(fixtureFile, JSON.stringify({ history: {}, receipts: {} }));
  const { url } = await startProcess(t, 'server.js', { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', PUBLIC_ORIGIN: '',
    TASKMALL_TEST_WALLET: '', TASKMALL_DATA_DIR: directory, TASKMALL_SQLITE: '1', TRON_DEPOSITS_ENABLED: '1',
    TRON_WALLET_PUBLIC_FILE: path.join(directory, 'missing.json'), TRONGRID_API_KEY: 'fixture-only', TASKMALL_TRON_FIXTURE: fixtureFile }, true);
  cleanup(t, directory);
  const config = await (await fetch(url + '/api/payment-config')).json();
  assert.equal(config.available, false);
  assert.deepEqual(config.networks, []);
  assert.equal(JSON.stringify(config).includes(treasury), false);
  const signup = await fetch(url + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'blocked@test.invalid', password: 'PaymentTest2026' }) });
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const result = await fetch(url + '/api/wallet/deposit-address', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, 'DEPOSITS_UNAVAILABLE');
});

test('automatic protected wallet creation, recovery and immutable configuration', async t => {
  const directory = await temporary(t);
  cleanup(t, directory);
  const { provisionWallet, readVault } = require('../payments/vault');
  const walletFile = path.join(directory, 'public-wallet.json');
  const vaultFile = path.join(directory, 'private.vault');
  const provisioned = await provisionWallet({ walletFile, treasury, vaultFile, createMnemonic: () => mnemonic });
  assert.equal(provisioned.publicWallet.firstAddress, deriveAddress(xpub, 0));
  const restored = await readVault(vaultFile);
  assert.equal(restored.mnemonic, mnemonic);
  const serialized = await fs.readFile(vaultFile, 'utf8');
  assert.equal(serialized.includes(mnemonic), false);
  assert.equal(serialized.includes('mnemonic'), false);
  assert.equal(await fs.readFile(vaultFile + '.backup', 'utf8'), serialized);
  const again = await provisionWallet({ walletFile, treasury, vaultFile, createMnemonic: () => { throw new Error('Must not regenerate'); } });
  assert.equal(again.publicWallet.xpub, xpub);
  await fs.unlink(vaultFile + '.backup');
  await provisionWallet({ walletFile, treasury, vaultFile });
  assert.equal(await fs.readFile(vaultFile + '.backup', 'utf8'), serialized);
  await assert.rejects(provisionWallet({ walletFile, treasury: deriveAddress(xpub, 5), vaultFile }), /not replaced/);
  const missingVault = path.join(directory, 'missing.vault');
  await assert.rejects(provisionWallet({ walletFile, treasury, vaultFile: missingVault }), /missing/);
  const corrupt = JSON.parse(serialized);
  corrupt.sealed = Buffer.from('invalid ciphertext').toString('base64');
  await fs.writeFile(path.join(directory, 'corrupt.vault'), JSON.stringify(corrupt));
  await assert.rejects(readVault(path.join(directory, 'corrupt.vault')), /Protected/);
  await fs.writeFile(vaultFile + '.backup', JSON.stringify(corrupt));
  await assert.rejects(provisionWallet({ walletFile, treasury, vaultFile }), /Protected/);
});

test('production rejects automatic private-key provisioning', async t => {
  await assert.rejects(startProcess(t, 'server.js', { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://taskmall.test', TRON_AUTO_WALLET: '1' }), /Provision the protected wallet locally/);
});

test('application automatically provisions the wallet without exposing a setup page', async t => {
  const directory = await temporary(t);
  const fixtureFile = path.join(directory, 'chain.json');
  const walletFile = path.join(directory, 'public-wallet.json');
  const vaultFile = path.join(directory, 'protected.vault');
  await fs.writeFile(fixtureFile, JSON.stringify({ history: {}, receipts: {} }));
  const { url } = await startProcess(t, 'server.js', { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', PUBLIC_ORIGIN: '',
    TASKMALL_TEST_WALLET: '', TASKMALL_DATA_DIR: directory, TASKMALL_SQLITE: '1', TRON_DEPOSITS_ENABLED: '1',
    TRON_AUTO_WALLET: '1', TRON_LOCAL_VAULT_FILE: vaultFile, TRON_WALLET_PUBLIC_FILE: walletFile,
    TRONGRID_API_KEY: 'fixture-only', TASKMALL_TRON_FIXTURE: fixtureFile }, true);
  cleanup(t, directory);
  for (let i = 0; i < 40 && !(await (await fetch(url + '/api/payment-config')).json()).available; i++) await new Promise(resolve => setTimeout(resolve, 50));
  const config = await (await fetch(url + '/api/payment-config')).json();
  assert.equal(config.available, true);
  for (const route of ['/setup/wallet.html', '/wallet.js', '/api/setup', '/config/tron-wallet-public.json']) assert.equal((await fetch(url + route)).status, 404);
  const signup = await fetch(url + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'automatic@test.invalid', password: 'PaymentTest2026' }) });
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const response = await fetch(url + '/api/wallet/deposit-address', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
  assert.equal(response.status, 200);
  const deposit = await response.json();
  const publicWallet = validateWallet(JSON.parse(await fs.readFile(walletFile, 'utf8')), treasury);
  assert.equal(deposit.address, publicWallet.firstAddress);
  assert.equal(JSON.stringify(deposit).includes('mnemonic'), false);
  assert.equal(JSON.stringify(deposit).includes('xpub'), false);
});
