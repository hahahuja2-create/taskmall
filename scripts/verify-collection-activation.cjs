'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { HDNodeWallet } = require('ethers');
const { BRANCH_PATH, deriveAddress, tronAddress } = require('../payments/tron');
const { SignerJournal, CollectionWorker } = require('../payments/collector');
const { validateCollectionLimits, verifyPortableRecovery, readWorkerStatus, writeWorkerStatus } = require('../payments/collection-activation');
const { unsignedToken } = require('./tron-test-helpers.cjs');
const { signTransfer } = require('../payments/transactions');
const { verifiedOfflineCopy, copyBackupToUsb } = require('../payments/offline-backup');

// Public fixture only. Never fund these addresses.
const phrase = 'test test test test test test test test test test test junk';
const branch = HDNodeWallet.fromPhrase(phrase, '', BRANCH_PATH);
const xpub = branch.neuter().extendedKey;
const treasury = deriveAddress(xpub, 9);
const root = path.resolve(__dirname, '..');

async function directory(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-collection-'));
  t.after(async () => {
    assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(folder).startsWith('taskmall-collection-'));
    await fs.rm(folder, { recursive: true, force: true });
  });
  return folder;
}

test('explicit collection caps are bounded by backend policy and allow at least one funded transfer', () => {
  const good = validateCollectionLimits(20_000_000, '40000000', '50000000', 20_000_000);
  assert.equal(good.gasEnabled, true);
  assert.equal(good.feeDailyLimit, '40000000');
  assert.throws(() => validateCollectionLimits(30_000_000, '60000000', '70000000', 20_000_000), /EXCEEDS_BACKEND/);
  assert.throws(() => validateCollectionLimits(20_000_000, '10000000', '50000000', 20_000_000), /DAILY_LIMIT_TOO_SMALL/);
  assert.throws(() => validateCollectionLimits(20_000_000, '40000000', '22000000', 20_000_000), /DAILY_LIMIT_TOO_SMALL/);
  assert.throws(() => validateCollectionLimits(20_000_000, undefined, '50000000', 20_000_000));
  assert.throws(() => validateCollectionLimits(0, '40000000', '50000000', 20_000_000));
  assert.equal(validateCollectionLimits(20_000_000, '40000000', undefined, 20_000_000, false).gasDailyLimit, '0');
});

test('portable recovery verifies a fresh file decrypt, the entire deposit branch and fuel account without exposing keys', { timeout: 60_000 }, async t => {
  const folder = await directory(t);
  const wallet = { xpub };
  const encrypted = await branch.deriveChild(0).encrypt('PublicFixturePassword2026');
  const file = path.join(folder, 'fixture.keystore.json');
  await fs.writeFile(file, encrypted, { flag: 'wx' });
  const verified = await verifyPortableRecovery(await fs.readFile(file, 'utf8'), 'PublicFixturePassword2026', wallet);
  assert.match(verified.backupDigest, /^[a-f0-9]{64}$/);
  assert.equal(verified.fuelAddress, tronAddress(HDNodeWallet.fromPhrase(phrase, '', "m/44'/195'/1'/0/0").address.slice(2)));
  assert.deepEqual(Object.keys(verified).sort(), ['backupDigest', 'fuelAddress']);
  await assert.rejects(verifyPortableRecovery(encrypted, 'wrong', wallet), /RECOVERY_NOT_VERIFIED/);
  await assert.rejects(verifyPortableRecovery(encrypted, 'PublicFixturePassword2026', { xpub: branch.deriveChild(1).neuter().extendedKey }), /RECOVERY_NOT_VERIFIED/);
  await assert.rejects(verifyPortableRecovery('not-json', 'PublicFixturePassword2026', wallet), /RECOVERY_NOT_VERIFIED/);
  await assert.rejects(verifyPortableRecovery('x'.repeat(1_000_001), 'PublicFixturePassword2026', wallet), /RECOVERY_NOT_VERIFIED/);
});

test('daily reservations persist, migrate without deletion, and charge carried-over jobs against the new UTC day', async t => {
  const folder = await directory(t);
  let now = new Date('2026-10-07T23:59:00Z');
  let journal = new SignerJournal(folder, { now: () => now });
  try {
    journal.sql.prepare('INSERT INTO spend_limits VALUES (?,?,?,?)').run('gas', 'legacy', '2026-10-07', '1000000');
    journal.close();
    journal = new SignerJournal(folder, { now: () => now });
    assert.equal(journal.reservedCost('gas', 'legacy'), 1_000_000n);
    journal.reserve('collection-fee', 'a', 20_000_000n, 40_000_000n);
    journal.reserve('collection-fee', 'a', 20_000_000n, 40_000_000n);
    journal.reserve('collection-fee', 'b', 20_000_000n, 40_000_000n);
    assert.throws(() => journal.reserve('collection-fee', 'c', 20_000_000n, 40_000_000n), /DAILY_SPENDING/);
    now = new Date('2026-10-08T00:01:00Z');
    journal.reserve('collection-fee', 'c', 20_000_000n, 40_000_000n);
    journal.reserve('collection-fee', 'a', 20_000_000n, 40_000_000n);
    assert.throws(() => journal.reserve('collection-fee', 'b', 20_000_000n, 40_000_000n), /DAILY_SPENDING/);
    assert.throws(() => journal.reserve('collection-fee', 'a', 10_000_000n, 40_000_000n), /cannot be changed/);
    journal.close();
    journal = new SignerJournal(folder, { now: () => now });
    assert.throws(() => journal.reserve('collection-fee', 'b', 20_000_000n, 40_000_000n), /DAILY_SPENDING/);
    assert.equal(journal.sql.prepare('SELECT count(*) AS n FROM spend_limits').get().n, 1);
  } finally { journal.close(); }
});

test('signed collection retries require the current UTC budget; expired intents never broadcast or consume new budgets', async t => {
  const folder = await directory(t);
  let now = new Date('2026-10-07T23:59:00Z');
  const journal = new SignerJournal(folder, { now: () => now });
  try {
    const from = deriveAddress(xpub, 0);
    const expectation = { from, to: treasury, value: '10000000', feeLimit: 20_000_000 };
    const signed = await signTransfer(unsignedToken(expectation), branch.deriveChild(0).privateKey.slice(2), expectation);
    const jobId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    journal.reserve('collection-fee', jobId, 20_000_000n, 20_000_000n);
    now = new Date('2026-10-08T00:01:00Z');
    journal.reserve('collection-fee', 'new', 20_000_000n, 20_000_000n);
    let broadcasts = 0;
    const worker = new CollectionWorker({ operator: async () => ({}), client: { request: async () => { broadcasts++; return { result: true }; } },
      wallet: { xpub, treasuryAddress: treasury }, treasury, branch, journal, gasWallet: {}, feeLimit: 20_000_000,
      feeDailyLimit: '20000000', gasEnabled: false });
    const job = { id: jobId, address: from, address_index: 0, treasury, amount_units: '10000000',
      status: 'signed', txid: signed.txID, payload: JSON.stringify(signed) };
    await assert.rejects(worker.process(job), /DAILY_SPENDING/);
    assert.equal(broadcasts, 0);
    const savedNow = Date.now;
    Date.now = () => signed.raw_data.expiration + 1;
    try { await assert.rejects(worker.process(job), /SIGNED_TRANSACTION_EXPIRED/); }
    finally { Date.now = savedNow; }
    assert.equal(journal.sql.prepare('SELECT count(*) AS n FROM spend_limits_daily WHERE job_id=? AND day=?').get(job.id, '2026-10-08').n, 0);
    assert.equal(broadcasts, 0);
    worker.operator = async () => ({ treasury, feeLimitSun: 1_000_000, collections: [] });
    await assert.rejects(worker.cycle(), /EXCEEDS_BACKEND/);
  } finally { journal.close(); }
});

test('worker status ignores stale and stopped markers, and real activation refuses non-interactive tool execution', async t => {
  const folder = await directory(t);
  const file = path.join(folder, 'status.json');
  await writeWorkerStatus(file, { state: 'running', recoveryVerified: true });
  assert.equal((await readWorkerStatus(file)).running, true);
  assert.equal((await readWorkerStatus(file, Date.now() + 121_000)).running, false);
  await writeWorkerStatus(file, { state: 'stopped' });
  assert.equal((await readWorkerStatus(file)).running, false);
  assert.equal((await readWorkerStatus(path.join(folder, 'absent.json'))).running, false);
  for (const args of [['--setup', '--run'], ['--setup'], ['--setup', '--copy-backup'], ['--setup', '--local-backup'], ['--run']]) {
    const result = spawnSync(process.execPath, ['scripts/collection-worker.cjs', ...args], { cwd: root, encoding: 'utf8',
      windowsHide: true, env: { ...process.env, TASKMALL_DATA_DIR: folder } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PRIVATE_TERMINAL_REQUIRED/);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual((await fs.readdir(folder)).sort(), ['status.json']);
});

test('offline copy is checked independently; missing, modified, oversized and same-file copies cannot authorize recovery', async t => {
  const folder = await directory(t);
  const original = path.join(folder, 'original.keystore.json');
  const copy = path.join(folder, 'copy.keystore.json');
  const encryptedFixture = '{"fixture":"encrypted test bytes, not a real wallet"}';
  await fs.writeFile(original, encryptedFixture);
  await fs.writeFile(copy, encryptedFixture);
  assert.equal(await verifiedOfflineCopy(original, copy), encryptedFixture);
  await assert.rejects(verifiedOfflineCopy(original, original), /COPY_NOT_VERIFIED/);
  await assert.rejects(verifiedOfflineCopy(original, 'relative.keystore.json'), /COPY_NOT_VERIFIED/);
  await assert.rejects(verifiedOfflineCopy(original, path.join(folder, 'missing.json')), /COPY_NOT_VERIFIED/);
  await fs.writeFile(copy, encryptedFixture.replace('bytes', 'WRONG'));
  await assert.rejects(verifiedOfflineCopy(original, copy), /COPY_NOT_VERIFIED/);
  await fs.writeFile(original, 'x'.repeat(1_000_001));
  await fs.writeFile(copy, 'x'.repeat(1_000_001));
  await assert.rejects(verifiedOfflineCopy(original, copy), /COPY_NOT_VERIFIED/);
  await assert.rejects(copyBackupToUsb(original), /PRIVATE_TERMINAL_REQUIRED/);
});

test('invalid collection options fail before reading any credentials or creating any local files', async t => {
  const folder = await directory(t);
  for (const args of [['--copy-backup'], ['--setup', '--preflight'], ['--run', '--fuel-address'], ['--preflight', '--fuel-address'], ['--unknown'],
    ['--local-backup'], ['--run', '--setup', '--local-backup'], ['--setup', '--local-backup', '--copy-backup']]) {
    const result = spawnSync(process.execPath, ['scripts/collection-worker.cjs', ...args], { cwd: root, encoding: 'utf8',
      windowsHide: true, env: { ...process.env, TASKMALL_DATA_DIR: folder } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /INVALID_WORKER_OPTIONS/);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(await fs.readdir(folder), []);
});
