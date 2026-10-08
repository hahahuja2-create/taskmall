'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const taskCatalog = require('./task-catalog');
const { units, amount: usdtAmount } = require('./payments/tron');
const { OutgoingLedger, SettlementWatcher, MINIMUM_WITHDRAWAL_USDT } = require('./payments/outgoing');
const { loadOperatorToken, authorized } = require('./payments/operator');
const { OperatorPortal } = require('./payments/portal');

const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.TASKMALL_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const FREE_VIP_DAYS = 10;
const WITHDRAWAL_FEE_RATE = 0.1;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';
const TEST_WALLET = process.env.NODE_ENV === 'test' && process.env.TASKMALL_TEST_WALLET === '1'
  && Boolean(process.env.TASKMALL_DATA_DIR) && path.resolve(DATA_DIR) !== path.join(__dirname, 'data');
if (process.env.TASKMALL_TEST_WALLET === '1' && !TEST_WALLET) throw new Error('Test wallet requires an isolated test data directory and NODE_ENV=test.');
if (IS_PRODUCTION && (!PUBLIC_ORIGIN || new URL(PUBLIC_ORIGIN).protocol !== 'https:')) throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');
const USE_SQLITE = !TEST_WALLET && process.env.TASKMALL_SQLITE === '1';
const USE_MYSQL = !TEST_WALLET && (process.env.NODE_ENV !== 'test' || process.env.TASKMALL_MYSQL_TEST === '1')
  && Boolean(process.env.MYSQL_URL || process.env.DATABASE_URL);
const TRON_DEPOSITS = !TEST_WALLET && process.env.TRON_DEPOSITS_ENABLED === '1';
if (TRON_DEPOSITS && !USE_SQLITE && !USE_MYSQL) throw new Error('TRON deposits require transactional database storage.');
if (IS_PRODUCTION && process.env.TRON_AUTO_WALLET === '1') throw new Error('Provision the protected wallet locally, then deploy only its verified public configuration with TRON_AUTO_WALLET=0.');
const WALLET_FILE = process.env.TRON_WALLET_PUBLIC_FILE || path.join(__dirname, 'config', 'tron-wallet-public.json');
const WALLET_JSON = process.env.TRON_WALLET_PUBLIC_JSON || '';
if (WALLET_JSON && process.env.TRON_AUTO_WALLET === '1') throw new Error('Public wallet variables cannot be combined with local wallet generation.');
const TREASURY = process.env.TRON_TREASURY_ADDRESS || require('./config/tron-payment-setup.json').treasuryAddress;
let paymentStore;
let depositWatcher;
let outgoingLedger;
let settlementWatcher;
let operatorToken;
const OPERATOR_FILE = process.env.TASKMALL_OPERATOR_TOKEN_FILE || path.join(DATA_DIR, 'operator.token');
const MANUAL_WITHDRAWALS = process.env.TRON_MANUAL_WITHDRAWALS_ENABLED === '1';
let operationQueue = Promise.resolve();
function exclusive(operation) {
  const next = operationQueue.then(operation);
  operationQueue = next.catch(() => {});
  return next;
}
const sessions = new Map();
const rateLimits = new Map();

const { vipPlans } = require('./platform-catalog');

const paymentNetworks = {
  trc20: { label: 'USDT TRC20', address: TEST_WALLET ? 'TEST_ONLY_NOT_A_PAYMENT_ADDRESS' : '' },
  erc20: { label: 'USDT ERC20', address: TEST_WALLET ? 'TEST_ONLY_NOT_A_PAYMENT_ADDRESS' : '' },
  bep20: { label: 'USDT BEP20', address: TEST_WALLET ? 'TEST_ONLY_NOT_A_PAYMENT_ADDRESS' : '' },
  polygon: { label: 'USDT Polygon', address: TEST_WALLET ? 'TEST_ONLY_NOT_A_PAYMENT_ADDRESS' : '' }
};

const seedTasks = vipPlans.map((plan) => ({
  ...taskCatalog[plan.level],
  id: `${plan.id}-daily-task`,
  icon: plan.level === 0 ? 'star' : 'crown',
  category: plan.level === 0 ? 'free' : `vip${plan.level}`,
  minutes: 3 + Math.min(plan.level, 8),
  reward: plan.maxReward,
  requiredVip: plan.level,
  description: {
    ka: plan.level === 0
      ? `${taskCatalog[plan.level].description.ka} Free VIP ხელმისაწვდომია პირველი ${FREE_VIP_DAYS} დღე.`
      : taskCatalog[plan.level].description.ka,
    en: plan.level === 0
      ? `${taskCatalog[plan.level].description.en} Free VIP is available for the first ${FREE_VIP_DAYS} days.`
      : taskCatalog[plan.level].description.en
  }
}));

let db = { users: [], tasks: seedTasks };
let writeQueue = Promise.resolve();
let storageHealthy = true;
const operatorPortal = new OperatorPortal({ treasury: TREASURY, exclusive, json, readBody,
  getToken: () => operatorToken, getLedger: () => outgoingLedger, getClient: () => depositWatcher?.client,
  getState: () => db, commitState: next => { db = next; }, isHealthy: () => storageHealthy,
  isSendingEnabled: () => storageHealthy && MANUAL_WITHDRAWALS && Boolean(depositWatcher?.ready()) });

function planById(id) {
  return vipPlans.find((plan) => plan.id === id) || vipPlans[0];
}

function planByLevel(level) {
  return vipPlans.find((plan) => plan.level === level) || vipPlans[0];
}

function money(value) {
  return usdtAmount(units(value === undefined ? 0 : value));
}

function displayNameFromEmail(email) {
  const localPart = String(email || '').split('@')[0] || 'TaskMall user';
  const name = localPart.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
  return name.length >= 2 ? name : 'TaskMall user';
}

function makeInviteCode(user) {
  const digest = crypto.createHash('sha1').update(`${user.id}:${user.email}`).digest('hex').slice(0, 7).toUpperCase();
  return `TM${digest}`;
}

function ensureUserShape(user) {
  let changed = false;
  const defaults = [
    ['points', 0],
    ['streak', 0],
    ['lastCompletionDate', null],
    ['completedTaskIds', []],
    ['activities', []],
    ['lockedBalance', 0],
    ['withdrawBalance', 0],
    ['reservedBalance', 0],
    ['earnedTotal', 0],
    ['withdrawnTotal', 0],
    ['withdrawFeeTotal', 0],
    ['vipId', 'free'],
    ['referredBy', null]
  ];
  for (const [key, value] of defaults) {
    if (user[key] === undefined) {
      user[key] = Array.isArray(value) ? [] : value;
      changed = true;
    }
  }
  if (!Array.isArray(user.completedTaskIds)) {
    user.completedTaskIds = [];
    changed = true;
  }
  if (!Array.isArray(user.activities)) {
    user.activities = [];
    changed = true;
  }
  if (!user.inviteCode) {
    user.inviteCode = makeInviteCode(user);
    changed = true;
  }
  user.lockedBalance = money(user.lockedBalance);
  user.withdrawBalance = money(user.withdrawBalance);
  user.reservedBalance = money(user.reservedBalance);
  user.earnedTotal = money(user.earnedTotal);
  user.withdrawnTotal = money(user.withdrawnTotal);
  user.withdrawFeeTotal = money(user.withdrawFeeTotal);
  if (!vipPlans.some((plan) => plan.id === user.vipId)) {
    user.vipId = 'free';
    changed = true;
  }
  if (!user.vipStartedAt || !user.vipExpiresAt) {
    const purchase = user.activities.find(activity => activity.type === 'vip');
    user.vipStartedAt = user.vipId !== 'free' && purchase ? purchase.at : user.createdAt;
    if (!Number.isFinite(Date.parse(user.vipStartedAt))) throw new Error('Invalid membership start date.');
    user.vipExpiresAt = new Date(Date.parse(user.vipStartedAt) + planById(user.vipId).durationDays * 86_400_000).toISOString();
    changed = true;
  }
  if (user.vipId === 'free') {
    const expiresAt = new Date(Date.parse(user.createdAt) + FREE_VIP_DAYS * 86_400_000).toISOString();
    if (user.vipStartedAt !== user.createdAt || user.vipExpiresAt !== expiresAt) {
      user.vipStartedAt = user.createdAt;
      user.vipExpiresAt = expiresAt;
      changed = true;
    }
  }
  return changed;
}

function cleanUser(user) {
  ensureUserShape(user);
  const vip = planById(user.vipId);
  const freeDaysRemaining = getFreeDaysRemaining(user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    points: user.points,
    streak: user.streak,
    completedCount: user.completedTaskIds.length,
    completedTaskIds: user.completedTaskIds,
    lockedBalance: money(user.lockedBalance),
    withdrawBalance: money(user.withdrawBalance),
    reservedBalance: money(user.reservedBalance),
    earnedTotal: money(user.earnedTotal),
    withdrawnTotal: money(user.withdrawnTotal),
    withdrawFeeTotal: money(user.withdrawFeeTotal),
    withdrawalFeeRate: WITHDRAWAL_FEE_RATE,
    vipId: vip.id,
    vipLevel: vip.level,
    vipName: vip.name,
    vipDailyTasks: vip.dailyTasks,
    vipDurationDays: vip.durationDays,
    vipStartedAt: user.vipStartedAt,
    vipExpiresAt: user.vipExpiresAt,
    vipActive: vipActive(user),
    vipDaysRemaining: vipDaysRemaining(user),
    freeDaysRemaining,
    inviteCode: user.inviteCode,
    createdAt: user.createdAt
  };
}

async function loadDatabase() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (USE_SQLITE || USE_MYSQL) {
    if (USE_MYSQL) {
      const { MysqlPaymentStore } = require('./payments/mysql-store');
      paymentStore = await MysqlPaymentStore.open();
      await paymentStore.catalog(vipPlans, seedTasks);
    } else {
      const { PaymentStore } = require('./payments/store');
      paymentStore = new PaymentStore(DATA_DIR);
    }
    let saved = await paymentStore.state();
    if (!saved && USE_MYSQL && (fs.existsSync(DATA_FILE) || fs.existsSync(path.join(DATA_DIR, 'payments.sqlite')))) {
      throw new Error('Existing local database requires an explicit reconciled MySQL migration. Automatic import is disabled.');
    }
    if (!saved && !USE_MYSQL) {
      try {
        const raw = await fsp.readFile(DATA_FILE, 'utf8');
        saved = JSON.parse(raw.replace(/^\uFEFF/, ''));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (saved && !Array.isArray(saved.users)) throw new Error('Database users must be an array.');
    db.users = saved?.users || [];
    for (const user of db.users) ensureUserShape(user);
    await paymentStore.save(db, 'initial-import-or-migration');
    outgoingLedger = new OutgoingLedger(paymentStore, TREASURY);
    if (process.env.TASKMALL_OPERATOR_ENABLED === '1') operatorToken = await loadOperatorToken(OPERATOR_FILE, true, process.env.TASKMALL_OPERATOR_TOKEN);
    if (TRON_DEPOSITS) {
      if (process.env.TRON_AUTO_WALLET === '1') {
        const { provisionWallet } = require('./payments/vault');
        await provisionWallet({ walletFile: WALLET_FILE, treasury: TREASURY, vaultFile: process.env.TRON_LOCAL_VAULT_FILE });
      }
      const { DepositWatcher } = require('./payments/watcher');
      depositWatcher = new DepositWatcher({ store: paymentStore, walletFile: WALLET_FILE, walletJson: WALLET_JSON,
        treasury: TREASURY, apiKey: process.env.TRONGRID_API_KEY, exclusive,
        interval: process.env.NODE_ENV === 'test' ? Number(process.env.TRON_TEST_POLL_MS || 30_000) : 30_000,
        async credit(event) {
          if (!storageHealthy) throw new Error('Storage is unavailable.');
          const next = structuredClone(db);
          const credited = await paymentStore.credit(event, next, (state, userId, transfer) => {
            const user = state.users.find(item => item.id === userId);
            if (!user) throw new Error('Deposit account was not found.');
            user.lockedBalance = usdtAmount(units(user.lockedBalance) + BigInt(transfer.units));
            addActivity(user, { type: 'deposit', amount: usdtAmount(transfer.units), amountUnits: transfer.units,
              network: 'USDT TRC20', address: transfer.to, txid: transfer.txid, logIndex: transfer.logIndex,
              blockNumber: transfer.blockNumber, status: 'confirmed', at: new Date(transfer.timestamp).toISOString() });
          });
          if (credited) db = next;
          return credited;
        } });
      depositWatcher.start();
      settlementWatcher = new SettlementWatcher({ ledger: outgoingLedger, client: depositWatcher.client, exclusive,
        getState: () => db, commitState: state => { db = state; }, onFatal: () => { storageHealthy = false; },
        interval: process.env.NODE_ENV === 'test' ? Number(process.env.TRON_TEST_POLL_MS || 30_000) : 30_000 });
      settlementWatcher.start();
    }
    return;
  }
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const saved = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!Array.isArray(saved.users)) throw new Error('Database users must be an array.');
    db.users = saved.users;
    db.tasks = seedTasks;
    let changed = false;
    for (const user of db.users) if (ensureUserShape(user)) changed = true;
    if (changed) await saveDatabase();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await saveDatabase();
  }
}

async function saveDatabase() {
  if (paymentStore) {
    try { await paymentStore.save(db); return; }
    catch (error) { storageHealthy = false; throw error; }
  }
  const payload = JSON.stringify(db, null, 2);
  writeQueue = writeQueue.then(async () => {
    const temporary = `${DATA_FILE}.tmp`;
    await fsp.writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temporary, DATA_FILE);
  }).catch((error) => {
    storageHealthy = false;
    throw error;
  });
  return writeQueue;
}

function json(res, status, body, extraHeaders = {}) {
  const output = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(output),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(output);
}

function parseCookies(req) {
  const cookies = {};
  for (const item of (req.headers.cookie || '').split(';')) {
    const splitAt = item.indexOf('=');
    if (splitAt > 0) {
      try { cookies[item.slice(0, splitAt).trim()] = decodeURIComponent(item.slice(splitAt + 1).trim()); } catch {}
    }
  }
  return cookies;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  if (USE_MYSQL) await paymentStore.createSession(token, userId, Date.now() + SESSION_TTL_MS);
  else sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function sessionCookie(token) {
  return `taskmall_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${IS_PRODUCTION ? '; Secure' : ''}`;
}

function clearSessionCookie() {
  return `taskmall_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${IS_PRODUCTION ? '; Secure' : ''}`;
}

async function currentUser(req) {
  if (!storageHealthy) return null;
  const cookies = parseCookies(req);
  const token = cookies.taskmall_session || cookies.taskora_session;
  if (!token) return null;
  const session = USE_MYSQL ? await paymentStore.session(token, SESSION_TTL_MS) : sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  const user = db.users.find((item) => item.id === session.userId) || null;
  if (user) ensureUserShape(user);
  return user;
}

async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) json(res, 401, { error: 'AUTH_REQUIRED' });
  return user;
}

function allowRequest(req, key, limit, windowMs) {
  const ip = req.socket.remoteAddress || 'local';
  const id = `${ip}:${key}`;
  const now = Date.now();
  const record = rateLimits.get(id);
  if (!record || record.resetAt < now) {
    rateLimits.set(id, { count: 1, resetAt: now + windowMs });
    return true;
  }
  record.count += 1;
  return record.count <= limit;
}

async function readBody(req) {
  if (req.taskmallBody) return req.taskmallBody;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > 20_000) {
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
        resolve(body);
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function hashPassword(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, hash) => error ? reject(error) : resolve(hash.toString('hex'))));
}

async function verifyPassword(password, user) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 128) return false;
  const candidate = Buffer.from(await hashPassword(password, user.passwordSalt), 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function dayDifference(earlier, later) {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function getFreeDaysRemaining(user) {
  return user.vipId === 'free' ? vipDaysRemaining(user) : 0;
}

function vipDaysRemaining(user) {
  return Math.max(0, Math.ceil((Date.parse(user.vipExpiresAt) - Date.now()) / 86_400_000));
}

function vipActive(user) {
  return Number.isFinite(Date.parse(user.vipExpiresAt)) && Date.now() < Date.parse(user.vipExpiresAt);
}

function tasksCompletedToday(user) {
  const today = dayKey();
  return user.lastCompletionDate === today ? 1 : 0;
}

function taskCompletedToday(user, taskId) {
  const today = dayKey();
  return (user.activities || []).some((activity) => activity.type === 'task' && activity.taskId === taskId && String(activity.at || '').startsWith(today));
}

function taskForClient(task, user) {
  const vip = planById(user.vipId);
  const exactVipLocked = vip.level !== task.requiredVip;
  const expired = !vipActive(user);
  const dailyLimit = tasksCompletedToday(user) >= vip.dailyTasks;
  return {
    ...task,
    completed: taskCompletedToday(user, task.id),
    locked: exactVipLocked || expired || dailyLimit,
    lockedReason: expired ? 'VIP_EXPIRED' : exactVipLocked ? 'VIP_EXACT_REQUIRED' : dailyLimit ? 'DAILY_LIMIT' : null,
    requiredVipName: planByLevel(task.requiredVip).name
  };
}

function addActivity(user, activity) {
  ensureUserShape(user);
  user.activities.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...activity });
}

function parseAmount(value, min, max) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) return null;
  const amount = money(number);
  if (amount < min || amount > max) return null;
  return amount;
}

function parseExactUsdt(value, min, max) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  try {
    const parsed = units(String(value));
    if (parsed < units(min) || parsed > units(max)) return null;
    return usdtAmount(parsed);
  } catch { return null; }
}

function getPaymentNetwork(value) {
  const key = String(value || 'trc20').trim().toLowerCase();
  return paymentNetworks[key] ? { id: key, ...paymentNetworks[key] } : null;
}

function vipListForUser(user) {
  const current = planById(user.vipId);
  const active = vipActive(user);
  return vipPlans.map((plan) => ({
    ...plan,
    current: plan.id === current.id,
    active: plan.id === current.id && active,
    upgradeCost: money(Math.max(0, plan.price - (active ? current.price : 0))),
    available: plan.level > 0 && (!active || plan.level > current.level),
    grossReturnDays: plan.maxReward > 0 && plan.price > 0 ? money(plan.price / plan.maxReward) : null,
    netDailyReward: money(plan.maxReward - money(plan.maxReward * WITHDRAWAL_FEE_RATE)),
    netReturnDays: plan.price ? money(plan.price / money(plan.maxReward - money(plan.maxReward * WITHDRAWAL_FEE_RATE))) : null,
    withdrawalFeeRate: WITHDRAWAL_FEE_RATE
  }));
}

function teamForUser(user) {
  const members = db.users.filter((candidate) => candidate.referredBy === user.inviteCode);
  const totalLocked = money(members.reduce((sum, item) => sum + (Number(item.lockedBalance) || 0), 0));
  const totalEarned = money(members.reduce((sum, item) => sum + (Number(item.earnedTotal) || 0), 0));
  return {
    inviteCode: user.inviteCode,
    count: members.length,
    totalLocked,
    totalEarned,
    members: members.slice(0, 20).map((member) => {
      ensureUserShape(member);
      const vip = planById(member.vipId);
      return {
        id: member.id,
        name: member.name,
        vipName: vip.name,
        lockedBalance: money(member.lockedBalance),
        earnedTotal: money(member.earnedTotal),
        createdAt: member.createdAt
      };
    })
  };
}

async function handleApi(req, res, url) {
  if (url.pathname.startsWith('/api/operator/')) {
    if (!authorized(req, operatorToken)) return json(res, 403, { error: 'OPERATOR_AUTH_REQUIRED' });
    if (!outgoingLedger || !storageHealthy) return json(res, 503, { error: 'STORAGE_UNAVAILABLE' });
    if (req.method === 'POST' && url.pathname === '/api/operator/browser-session') {
      const ticket = operatorPortal.sessions.issue(req);
      return json(res, ticket ? 200 : 403, ticket ? { ticket } : { error: 'OPERATOR_AUTH_REQUIRED' });
    }
    if (req.method === 'GET' && url.pathname === '/api/operator/withdrawals') return json(res, 200, { withdrawals: await outgoingLedger.withdrawals() });
    if (req.method === 'GET' && url.pathname === '/api/operator/collections') return json(res, 200, { treasury: TREASURY,
      feeLimitSun: require('./payments/transactions').boundedSun(Number(process.env.TRON_COLLECTION_FEE_LIMIT_SUN || 100_000_000), 'fee limit'), collections: await outgoingLedger.collections() });
    if (req.method === 'POST' && url.pathname === '/api/operator/collections/plan') return json(res, 200, { treasury: TREASURY,
      feeLimitSun: require('./payments/transactions').boundedSun(Number(process.env.TRON_COLLECTION_FEE_LIMIT_SUN || 100_000_000), 'fee limit'), collections: await outgoingLedger.planCollections() });
    const release = url.pathname.match(/^\/api\/operator\/(withdrawals|collections)\/([a-f0-9-]{36})\/release-failed$/);
    if (req.method === 'POST' && release) {
      if (!req.failureProof) return json(res, 503, { error: 'CHAIN_FAILURE_NOT_VERIFIED' });
      const next = structuredClone(db);
      await outgoingLedger.releaseFailed(next, release[1] === 'withdrawals' ? 'withdrawal' : 'collection', release[2], req.failureProof.info, req.failureProof.height);
      db = next;
      return json(res, 200, { ok: true });
    }
    const decision = url.pathname.match(/^\/api\/operator\/withdrawals\/([a-f0-9-]{36})\/(approve|reject|record)$/);
    if (req.method === 'POST' && decision) {
      const next = structuredClone(db);
      const result = decision[2] === 'record'
        ? await outgoingLedger.submitWithdrawal(next, decision[1], String(req.taskmallBody.txid || '').trim().toLowerCase())
        : await outgoingLedger.decide(next, decision[1], decision[2]);
      db = next;
      return json(res, 200, { withdrawal: result.record || result });
    }
    const collection = url.pathname.match(/^\/api\/operator\/collections\/([a-f0-9-]{36})\/record$/);
    if (req.method === 'POST' && collection) {
      const { validateTransfer, boundedSun } = require('./payments/transactions');
      const limit = boundedSun(Number(process.env.TRON_COLLECTION_FEE_LIMIT_SUN || 100_000_000), 'fee limit');
      const record = await outgoingLedger.recordCollection(collection[1], req.taskmallBody.transaction, (transaction, job) => {
        if (transaction?.raw_data?.timestamp < job.created_at - 60_000) throw Object.assign(new Error('INVALID_TRANSACTION_TIME'), { status: 400 });
        try { validateTransfer(transaction, { from: job.address, to: TREASURY, value: job.amount_units, feeLimit: limit }); }
        catch { throw Object.assign(new Error('INVALID_COLLECTION_TRANSACTION'), { status: 400 }); }
      });
      return json(res, 200, { collection: record });
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    if (USE_MYSQL && !paymentStore?.healthy) storageHealthy = false;
    return json(res, storageHealthy ? 200 : 503, { ok: storageHealthy, service: 'taskmall', paymentsAvailable: TEST_WALLET || Boolean(depositWatcher?.ready()),
      ...(TRON_DEPOSITS ? { deposits: depositWatcher?.status || 'starting', lastDepositScan: depositWatcher?.lastSuccess || null } : {}), time: new Date().toISOString() });
  }

  if (req.method === 'GET' && url.pathname === '/api/payment-config') {
    if (TRON_DEPOSITS) return json(res, 200, { available: storageHealthy && Boolean(depositWatcher?.ready()), mode: 'tron-watch-only',
      withdrawalsAvailable: storageHealthy && MANUAL_WITHDRAWALS && Boolean(operatorToken) && Boolean(depositWatcher?.ready()), status: depositWatcher?.status || 'starting',
      minimumWithdrawalAmount: MINIMUM_WITHDRAWAL_USDT,
      networks: storageHealthy && depositWatcher?.ready() ? [{ id: 'trc20', label: 'USDT TRC20' }] : [] });
    return json(res, 200, { available: TEST_WALLET, withdrawalsAvailable: TEST_WALLET, mode: TEST_WALLET ? 'test-wallet' : 'disabled', minimumWithdrawalAmount: MINIMUM_WITHDRAWAL_USDT,
      networks: TEST_WALLET ? Object.entries(paymentNetworks).map(([id, network]) => ({ id, ...network })) : [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/wallet/deposit-address') {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!allowRequest(req, 'deposit-address', 20, 60_000)) return json(res, 429, { error: 'TOO_MANY_REQUESTS' });
    if (!storageHealthy || !depositWatcher?.ready()) return json(res, 503, { error: 'DEPOSITS_UNAVAILABLE' });
    const record = await depositWatcher.allocate(user.id);
    const qr = await require('qrcode').toDataURL(record.address, { width: 240, margin: 4, errorCorrectionLevel: 'M' });
    return json(res, 200, { address: record.address, network: 'trc20', asset: 'USDT', decimals: 6,
      qr, explorer: `https://tronscan.org/#/address/${record.address}` });
  }

  if (req.method === 'GET' && url.pathname === '/api/wallet/deposits') {
    const user = await requireUser(req, res);
    if (!user) return;
    return json(res, 200, { deposits: await paymentStore?.deposits(user.id) || [] });
  }

  if (req.method === 'GET' && url.pathname === '/api/wallet/withdrawals') {
    const user = await requireUser(req, res);
    if (!user) return;
    return json(res, 200, { withdrawals: (await outgoingLedger?.withdrawals(user.id) || []).map(item => ({ id: item.id,
      destination: item.destination, amount: usdtAmount(item.gross_units), fee: usdtAmount(item.fee_units),
      netAmount: usdtAmount(item.net_units), status: item.status, txid: item.txid, createdAt: new Date(item.created_at).toISOString() })) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
    if (!allowRequest(req, 'signup', 8, 15 * 60_000)) return json(res, 429, { error: 'TOO_MANY_REQUESTS' });
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || displayNameFromEmail(email)).trim().replace(/\s+/g, ' ');
    const password = String(body.password || '');
    const referral = String(body.referral || '').trim().toUpperCase();
    if (name.length < 2 || name.length > 50) return json(res, 400, { error: 'INVALID_NAME' });
    if (!validEmail(email)) return json(res, 400, { error: 'INVALID_EMAIL' });
    if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return json(res, 400, { error: 'WEAK_PASSWORD' });
    }
    if (db.users.some((item) => item.email === email)) return json(res, 409, { error: 'EMAIL_EXISTS' });
    if (referral && !db.users.some((item) => item.inviteCode === referral)) return json(res, 400, { error: 'INVALID_REFERRAL' });

    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordSalt: salt,
      passwordHash: await hashPassword(password, salt),
      points: 0,
      streak: 0,
      lastCompletionDate: null,
      completedTaskIds: [],
      activities: [],
      lockedBalance: 0,
      withdrawBalance: 0,
      earnedTotal: 0,
      withdrawnTotal: 0,
      vipId: 'free',
      referredBy: referral || null,
      createdAt: new Date().toISOString()
    };
    user.inviteCode = makeInviteCode(user);
    addActivity(user, { type: 'welcome', amount: 0 });
    db.users.push(user);
    await saveDatabase();
    const token = await createSession(user.id);
    return json(res, 201, { user: cleanUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!allowRequest(req, 'login', 12, 15 * 60_000)) return json(res, 429, { error: 'TOO_MANY_REQUESTS' });
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((item) => item.email === email);
    if (password.length > 128 || !validEmail(email)) return json(res, 401, { error: 'INVALID_CREDENTIALS' });
    let matches = false;
    if (user) {
      matches = await verifyPassword(password, user);
    } else {
      await hashPassword(password || 'invalid-password', '00000000000000000000000000000000');
    }
    if (!matches) return json(res, 401, { error: 'INVALID_CREDENTIALS' });
    ensureUserShape(user);
    const token = await createSession(user.id);
    return json(res, 200, { user: cleanUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const cookies = parseCookies(req);
    const token = cookies.taskmall_session || cookies.taskora_session;
    if (token) {
      if (USE_MYSQL) await paymentStore.revokeSession(token);
      else sessions.delete(token);
    }
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = await requireUser(req, res);
    if (!user) return;
    return json(res, 200, { user: cleanUser(user) });
  }

  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    const user = await requireUser(req, res);
    if (!user) return;
    return json(res, 200, { tasks: db.tasks.map((task) => taskForClient(task, user)) });
  }

  if (req.method === 'GET' && url.pathname === '/api/vips') {
    const user = await requireUser(req, res);
    if (!user) return;
    return json(res, 200, { vips: vipListForUser(user) });
  }

  if (req.method === 'GET' && url.pathname === '/api/team') {
    const user = await requireUser(req, res);
    if (!user) return;
    return json(res, 200, { team: teamForUser(user) });
  }

  if (req.method === 'GET' && url.pathname === '/api/activity') {
    const user = await requireUser(req, res);
    if (!user) return;
    return json(res, 200, { activities: user.activities || [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/wallet/deposit') {
    if (!allowRequest(req, 'deposit', 30, 60_000)) return json(res, 429, { error: 'TOO_MANY_REQUESTS' });
    const user = await requireUser(req, res);
    if (!user) return;
    if (!TEST_WALLET) return json(res, 503, { error: 'PAYMENTS_UNAVAILABLE' });
    const body = await readBody(req);
    const amount = parseAmount(body.amount, 5, 100_000);
    const network = getPaymentNetwork(body.network);
    if (!amount) return json(res, 400, { error: 'INVALID_AMOUNT' });
    if (!network) return json(res, 400, { error: 'INVALID_NETWORK' });
    user.lockedBalance = money(user.lockedBalance + amount);
    addActivity(user, { type: 'deposit', amount, network: network.label, address: network.address });
    await saveDatabase();
    return json(res, 200, { user: cleanUser(user), activities: user.activities });
  }

  if (req.method === 'POST' && url.pathname === '/api/wallet/transfer') {
    if (!allowRequest(req, 'transfer', 30, 60_000)) return json(res, 429, { error: 'TOO_MANY_REQUESTS' });
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const amount = parseAmount(body.amount, 1, 100_000);
    if (!amount) return json(res, 400, { error: 'INVALID_AMOUNT' });
    if (amount > user.withdrawBalance) return json(res, 400, { error: 'INSUFFICIENT_WITHDRAW_BALANCE' });
    user.withdrawBalance = money(user.withdrawBalance - amount);
    user.lockedBalance = money(user.lockedBalance + amount);
    addActivity(user, { type: 'transfer', amount });
    await saveDatabase();
    return json(res, 200, { user: cleanUser(user), activities: user.activities });
  }

  if (req.method === 'POST' && url.pathname === '/api/wallet/withdraw') {
    if (!allowRequest(req, 'withdraw', 20, 60_000)) return json(res, 429, { error: 'TOO_MANY_REQUESTS' });
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    if (!TEST_WALLET) {
      if (!MANUAL_WITHDRAWALS || !operatorToken || !outgoingLedger || !depositWatcher?.ready()) return json(res, 503, { error: 'PAYMENTS_UNAVAILABLE' });
      if (body.network !== 'trc20') return json(res, 400, { error: 'INVALID_NETWORK' });
      if (!(await verifyPassword(body.password, user))) return json(res, 403, { error: 'PASSWORD_CONFIRMATION_REQUIRED' });
      const value = parseExactUsdt(body.amount, 0, 100_000);
      if (!value) return json(res, 400, { error: 'INVALID_AMOUNT' });
      const next = structuredClone(db);
      const result = await outgoingLedger.request(next, user.id, { key: body.requestKey, destination: String(body.wallet || '').trim(), gross: value });
      if (result.changed) db = next;
      return json(res, result.changed ? 201 : 200, { user: cleanUser(db.users.find(item => item.id === user.id)), activities: db.users.find(item => item.id === user.id).activities,
        withdrawal: { id: result.record.id, status: result.record.status } });
    }
    const amount = parseAmount(body.amount, MINIMUM_WITHDRAWAL_USDT, 100_000);
    const network = getPaymentNetwork(body.network);
    const wallet = String(body.wallet || '').trim();
    if (!amount) return json(res, 400, { error: 'INVALID_AMOUNT' });
    if (!network) return json(res, 400, { error: 'INVALID_NETWORK' });
    if (wallet.length < 12 || wallet.length > 120) return json(res, 400, { error: 'INVALID_WALLET' });
    if (amount > user.withdrawBalance) return json(res, 400, { error: 'INSUFFICIENT_WITHDRAW_BALANCE' });
    const fee = money(amount * WITHDRAWAL_FEE_RATE);
    const netAmount = money(amount - fee);
    user.withdrawBalance = money(user.withdrawBalance - amount);
    addActivity(user, { type: 'withdraw', amount, fee, netAmount, network: network.label, wallet: `${wallet.slice(0, 6)}...${wallet.slice(-4)}`, status: 'pending' });
    await saveDatabase();
    return json(res, 200, { user: cleanUser(user), activities: user.activities });
  }

  const vipMatch = url.pathname.match(/^\/api\/vips\/([a-z0-9-]+)\/buy$/);
  if (req.method === 'POST' && vipMatch) {
    if (!allowRequest(req, 'buy-vip', 30, 60_000)) return json(res, 429, { error: 'TOO_MANY_REQUESTS' });
    const user = await requireUser(req, res);
    if (!user) return;
    const plan = planById(vipMatch[1]);
    if (!plan || plan.id === 'free') return json(res, 404, { error: 'VIP_NOT_FOUND' });
    const current = planById(user.vipId);
    if (vipActive(user) && plan.level <= current.level) return json(res, 409, { error: 'VIP_ALREADY_ACTIVE' });
    const upgradeCost = money(plan.price - (vipActive(user) ? current.price : 0));
    if (user.lockedBalance < upgradeCost) return json(res, 400, { error: 'INSUFFICIENT_LOCKED_BALANCE', required: upgradeCost });
    user.lockedBalance = money(user.lockedBalance - upgradeCost);
    user.vipId = plan.id;
    user.vipStartedAt = new Date().toISOString();
    user.vipExpiresAt = new Date(Date.parse(user.vipStartedAt) + plan.durationDays * 86_400_000).toISOString();
    addActivity(user, { type: 'vip', amount: upgradeCost, vipName: plan.name, expiresAt: user.vipExpiresAt });
    await saveDatabase();
    return json(res, 200, { user: cleanUser(user), vips: vipListForUser(user), activities: user.activities });
  }

  const completionMatch = url.pathname.match(/^\/api\/tasks\/([a-z0-9-]+)\/complete$/);
  if (req.method === 'POST' && completionMatch) {
    if (!allowRequest(req, 'complete', 30, 60_000)) return json(res, 429, { error: 'TOO_MANY_REQUESTS' });
    const user = await requireUser(req, res);
    if (!user) return;
    const task = db.tasks.find((item) => item.id === completionMatch[1]);
    if (!task) return json(res, 404, { error: 'TASK_NOT_FOUND' });
    const vip = planById(user.vipId);
    if (vip.level !== task.requiredVip) return json(res, 403, { error: 'VIP_REQUIRED', requiredVip: task.requiredVip });
    if (!vipActive(user)) return json(res, 403, { error: 'VIP_EXPIRED' });
    if (taskCompletedToday(user, task.id)) return json(res, 409, { error: 'ALREADY_COMPLETED' });
    if (tasksCompletedToday(user) >= vip.dailyTasks) return json(res, 409, { error: 'DAILY_LIMIT' });

    const today = dayKey();
    if (!user.lastCompletionDate) user.streak = 1;
    else {
      const gap = dayDifference(user.lastCompletionDate, today);
      if (gap === 1) user.streak += 1;
      else if (gap > 1) user.streak = 1;
    }
    user.lastCompletionDate = today;
    if (!user.completedTaskIds.includes(task.id)) user.completedTaskIds.push(task.id);
    user.points += Math.round(task.reward * 100);
    user.withdrawBalance = money(user.withdrawBalance + task.reward);
    user.earnedTotal = money(user.earnedTotal + task.reward);
    addActivity(user, { type: 'task', taskId: task.id, amount: task.reward, title: task.title });
    await saveDatabase();
    return json(res, 200, { user: cleanUser(user), task: taskForClient(task, user), activities: user.activities });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/profile') {
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 50) return json(res, 400, { error: 'INVALID_NAME' });
    user.name = name;
    await saveDatabase();
    return json(res, 200, { user: cleanUser(user) });
  }

  return json(res, 404, { error: 'NOT_FOUND' });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

async function serveStatic(req, res, url) {
  let requested = url.pathname === '/' ? '/index.html' : url.pathname;
  try { requested = decodeURIComponent(requested); } catch { return json(res, 400, { error: 'BAD_PATH' }); }
  const absolute = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!absolute.startsWith(`${PUBLIC_DIR}${path.sep}`)) return json(res, 403, { error: 'FORBIDDEN' });
  try {
    const stat = await fsp.stat(absolute);
    if (!stat.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
    const data = await fsp.readFile(absolute);
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(absolute)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    });
    if (req.method === 'HEAD') res.end(); else res.end(data);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (path.extname(requested)) return json(res, 404, { error: 'NOT_FOUND' });
    const index = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': index.length, 'Cache-Control': 'no-cache' });
    res.end(index);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith('/operator/')) {
      await operatorPortal.handle(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/api/') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      if (!storageHealthy) return json(res, 503, { error: 'STORAGE_UNAVAILABLE' });
      const expectedOrigin = PUBLIC_ORIGIN || `http://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: 'JSON_REQUIRED' });
    }
    if (url.pathname.startsWith('/api/')) {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) req.taskmallBody = await readBody(req);
      const failedRelease = url.pathname.match(/^\/api\/operator\/(withdrawals|collections)\/([a-f0-9-]{36})\/release-failed$/);
      if (req.method === 'POST' && failedRelease && authorized(req, operatorToken) && depositWatcher) {
        const row = failedRelease[1] === 'withdrawals' ? await outgoingLedger.withdrawal(failedRelease[2])
          : (await outgoingLedger.collections()).find(item => item.id === failedRelease[2]);
        if (row?.txid) req.failureProof = { info: await depositWatcher.client.receipt(row.txid), height: await depositWatcher.client.solidHeight() };
      }
      await exclusive(() => handleApi(req, res, url));
    }
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url);
    else json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (String(error.code || '').startsWith('ERR_SQLITE') || String(error.code || '').startsWith('SQLITE_')) storageHealthy = false;
    if (USE_MYSQL) { if (!error.status) storageHealthy = false; console.error('Request failed:', error.status ? error.message : 'Database or internal operation failed.'); }
    else console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'SERVER_ERROR' });
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  for (const [key, limit] of rateLimits) if (limit.resetAt <= now) rateLimits.delete(key);
  if (USE_MYSQL && paymentStore?.healthy) exclusive(() => paymentStore.pruneSessions()).catch(() => { storageHealthy = false; });
}, 60_000).unref();

loadDatabase().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`TaskMall is running at http://${HOST}:${server.address().port}`);
  });
}).catch(async error => {
  console.error('Startup failed; stored data was preserved:', USE_MYSQL ? `MySQL configuration or storage validation failed (${error.code || 'VALIDATION'}).` : error.message);
  await paymentStore?.close();
  process.exitCode = 1;
});

function shutdown() {
  depositWatcher?.stop();
  settlementWatcher?.stop();
  server.close(async () => { await exclusive(() => paymentStore?.close()); process.exit(0); });
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
