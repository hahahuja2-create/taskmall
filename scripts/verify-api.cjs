const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'ApiTestPassword2026';
const dayMs = 86_400_000;

function fixture(email, vipId = 'free', expired = false) {
  const createdAt = new Date(Date.now() - (expired ? (vipId === 'free' ? 10 : 366) : 1) * dayMs).toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: crypto.randomUUID(), name: 'Test Account', email, createdAt,
    passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
    vipId, lockedBalance: 30000, withdrawBalance: 0,
    activities: vipId === 'free' ? [] : [{ id: crypto.randomUUID(), type: 'vip', at: createdAt, vipName: vipId.toUpperCase(), amount: 30 }]
  };
}

async function start(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-api-'));
  const database = path.join(directory, 'db.json');
  if (options.users) await fs.writeFile(database, JSON.stringify({ users: options.users }));
  if (options.corrupt) await fs.writeFile(database, '{broken database');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, windowsHide: true, stdio: 'pipe',
    env: { ...process.env, NODE_ENV: options.production ? 'production' : options.wallet ? 'test' : 'development',
      HOST: '127.0.0.1', PORT: '0', PUBLIC_ORIGIN: options.production ? 'https://taskmall.test' : '',
      TASKMALL_DATA_DIR: directory, TASKMALL_TEST_WALLET: options.wallet ? '1' : '', MYSQL_URL: '', DATABASE_URL: '', ...options.env }
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await exited;
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('taskmall-api-'));
    await fs.rm(directory, { force: true, recursive: true });
  });
  if (options.corrupt || options.rejectStartup) {
    assert.notEqual(await exited, 0);
    return { errors, database };
  }
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server failed to start: ' + errors)), 5000);
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    exited.then(() => { clearTimeout(timer); reject(new Error('Server exited: ' + errors)); });
  });
  return {
    url, database,
    async request(route, body, cookie, extra = {}) {
      const response = await fetch(url + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    async login(email) {
      const response = await this.request('/api/auth/login', { email, password });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    }
  };
}

test('invite codes link new registrations to the correct team and reject unknown referrals', async t => {
  const app = await start(t);
  const inviter = await app.request('/api/auth/signup', { email: 'inviter@taskmall.test', password });
  assert.equal(inviter.status, 201);
  const code = inviter.body.user.inviteCode;
  const cookie = inviter.headers.get('set-cookie').split(';')[0];
  const invalid = await app.request('/api/auth/signup', { email: 'friend@taskmall.test', password, referral: 'UNKNOWNCODE' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'INVALID_REFERRAL');
  const friend = await app.request('/api/auth/signup', { email: 'friend@taskmall.test', password, referral: ' ' + code.toLowerCase() + ' ' });
  assert.equal(friend.status, 201);
  const team = await app.request('/api/team', undefined, cookie);
  assert.equal(team.body.team.inviteCode, code);
  assert.equal(team.body.team.count, 1);
  assert.equal(team.body.team.members[0].id, friend.body.user.id);
  const saved = JSON.parse(await fs.readFile(app.database, 'utf8'));
  assert.equal(saved.users.find(user => user.id === friend.body.user.id).referredBy, code);
});

test('VIP pricing, expiry, renewals, daily limits and payment safeguards', async t => {
  const retained = fixture('retained@taskmall.test');
  retained.vipStartedAt = retained.createdAt;
  retained.vipExpiresAt = new Date(Date.parse(retained.createdAt) + 365 * dayMs).toISOString();
  retained.activities = Array.from({ length: 100 }, () => ({ id: crypto.randomUUID(), type: 'welcome', at: retained.createdAt, amount: 0 }));
  const app = await start(t, { users: [
    fixture('expired@taskmall.test', 'vip1', true),
    fixture('free-expired@taskmall.test', 'free', true),
    fixture('active@taskmall.test', 'vip10'), retained
  ] });

  await t.test('migrates every account without deleting history or extending expired membership', async () => {
    const saved = JSON.parse(await fs.readFile(app.database, 'utf8'));
    assert.equal(saved.users.length, 4);
    for (const user of saved.users) {
      assert.equal(Date.parse(user.vipExpiresAt) - Date.parse(user.vipStartedAt), (user.vipId === 'free' ? 10 : 365) * dayMs);
    }
    assert.equal(saved.users[3].activities.length, 100);
  });

  const signup = await app.request('/api/auth/signup', { email: 'new@taskmall.test', password });
  assert.equal(signup.status, 201);
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  assert.equal(signup.body.user.vipDurationDays, 10);
  assert.equal(signup.body.user.vipActive, true);
  assert.equal(signup.body.user.vipDaysRemaining, 10);

  await t.test('prices recover in 10-12 completed days after the 10% withdrawal fee', async () => {
    const { body } = await app.request('/api/vips', undefined, cookie);
    assert.equal(body.vips.length, 12);
    assert.equal(body.vips[0].maxReward, 0.3);
    const rewards = [3.03, 10.1, 30.3, 80.81, 151.52, 303.03, 505.05, 808.08, 1212.12, 1818.18, 2525.25];
    for (const plan of body.vips) {
      assert.equal(plan.durationDays, plan.price ? 365 : 10);
      if (plan.price) {
        assert.equal(plan.maxReward, rewards[plan.level - 1]);
        assert.ok(plan.netReturnDays >= 10 && plan.netReturnDays <= 12);
        assert.ok(Math.ceil(plan.price / plan.netDailyReward) >= 10 && Math.ceil(plan.price / plan.netDailyReward) <= 12);
      }
    }
  });

  await t.test('each task has its own product title, photograph and review steps', async () => {
    const { body } = await app.request('/api/tasks', undefined, cookie);
    assert.equal(body.tasks.length, 12);
    assert.equal(new Set(body.tasks.map(task => task.title.en)).size, 12);
    assert.equal(new Set(body.tasks.map(task => task.image)).size, 12);
    for (const task of body.tasks) {
      assert.ok(task.product.ka && task.product.en);
      assert.equal(task.steps.en.length, 3);
      const photo = await fetch(app.url + task.image);
      assert.equal(photo.status, 200);
      assert.equal(photo.headers.get('content-type'), 'image/jpeg');
      assert.ok((await photo.arrayBuffer()).byteLength > 5000);
    }
    assert.match(body.tasks[0].description.en, /10 days/);
  });

  await t.test('unconfirmed money cannot be credited or withdrawn', async () => {
    const config = await app.request('/api/payment-config');
    assert.deepEqual(config.body, { available: false, withdrawalsAvailable: false, mode: 'disabled', minimumWithdrawalAmount: 10, networks: [] });
    assert.equal((await app.request('/api/wallet/deposit', { amount: 10000, network: 'trc20' }, cookie)).status, 503);
    assert.equal((await app.request('/api/wallet/withdraw', { amount: 5, network: 'trc20', wallet: 'TestWalletAddress00000' }, cookie)).status, 503);
    const account = await app.request('/api/me', undefined, cookie);
    assert.equal(account.body.user.lockedBalance, 0);
    assert.equal(account.body.user.withdrawnTotal, 0);
  });

  await t.test('concurrent task requests credit only one reward', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => app.request('/api/tasks/free-daily-task/complete', {}, cookie)));
    assert.equal(responses.filter(result => result.status === 200).length, 1);
    assert.equal(responses.filter(result => result.status === 409).length, 4);
    assert.equal((await app.request('/api/me', undefined, cookie)).body.user.withdrawBalance, 0.3);
  });

  await t.test('expired memberships cannot earn and renew at full price for another 365 days', async () => {
    const expiredCookie = await app.login('expired@taskmall.test');
    const account = await app.request('/api/me', undefined, expiredCookie);
    assert.equal(account.body.user.vipActive, false);
    assert.equal(account.body.user.vipDaysRemaining, 0);
    assert.equal((await app.request('/api/tasks/vip1-daily-task/complete', {}, expiredCookie)).body.error, 'VIP_EXPIRED');
    const plans = await app.request('/api/vips', undefined, expiredCookie);
    assert.equal(plans.body.vips[1].upgradeCost, 30);
    assert.equal(plans.body.vips[1].available, true);
    const renewed = await app.request('/api/vips/vip1/buy', {}, expiredCookie);
    assert.equal(renewed.status, 200);
    assert.equal(renewed.body.user.lockedBalance, 29970);
    assert.equal(Date.parse(renewed.body.user.vipExpiresAt) - Date.parse(renewed.body.user.vipStartedAt), 365 * dayMs);
    assert.equal(renewed.body.user.vipActive, true);
    assert.equal((await app.request('/api/tasks/vip1-daily-task/complete', {}, expiredCookie)).status, 200);
    assert.equal((await app.request('/api/vips/vip2/buy', {}, expiredCookie)).status, 200);
    assert.equal((await app.request('/api/tasks/vip2-daily-task/complete', {}, expiredCookie)).body.error, 'DAILY_LIMIT');
    const tasks = await app.request('/api/tasks', undefined, expiredCookie);
    assert.equal(tasks.body.tasks.find(task => task.id === 'vip2-daily-task').lockedReason, 'DAILY_LIMIT');
    const freeCookie = await app.login('free-expired@taskmall.test');
    assert.equal((await app.request('/api/tasks/free-daily-task/complete', {}, freeCookie)).body.error, 'VIP_EXPIRED');
  });

  await t.test('VIP 10 upgrades to VIP 11 with the new reward and expiry', async () => {
    const activeCookie = await app.login('active@taskmall.test');
    const bought = await app.request('/api/vips/vip11/buy', {}, activeCookie);
    assert.equal(bought.status, 200);
    assert.equal(bought.body.user.lockedBalance, 23000);
    assert.equal(bought.body.user.vipDaysRemaining, 365);
    assert.equal((await app.request('/api/tasks/vip11-daily-task/complete', {}, activeCookie)).body.user.withdrawBalance, 2525.25);
    assert.equal((await app.request('/api/vips/vip11/buy', {}, activeCookie)).status, 409);
  });

  await t.test('rejects cross-origin writes, malformed amounts and missing authentication', async () => {
    assert.equal((await app.request('/api/wallet/transfer', { amount: 1 }, cookie, { Origin: 'https://other.test' })).status, 403);
    assert.equal((await app.request('/api/wallet/transfer', { amount: 1 }, cookie, { 'Content-Type': 'text/plain' })).status, 415);
    for (const amount of [true, [], '0x20', 'Infinity', '-1', 0.301]) {
      assert.equal((await app.request('/api/wallet/transfer', { amount }, cookie)).body.error, 'INVALID_AMOUNT');
    }
    assert.equal((await app.request('/api/me', undefined, 'taskmall_session=%ZZ')).status, 401);
    assert.equal((await app.request('/api/wallet/transfer', null, cookie)).status, 400);
    assert.equal((await app.request('/api/wallet/transfer', { amount: 1, padding: 'a'.repeat(20001) }, cookie)).status, 413);
    assert.equal((await app.request('/api/vips')).status, 401);
    const missing = await fetch(app.url + '/assets/missing.png');
    assert.equal(missing.status, 404);
    assert.ok(missing.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  });
});

test('invalid stored data stops startup without overwriting the database', async t => {
  const app = await start(t, { corrupt: true });
  assert.match(app.errors, /Startup failed/);
  assert.equal(await fs.readFile(app.database, 'utf8'), '{broken database');
});

test('production secure cookies and rejection of test funding', async t => {
  const rejected = await start(t, { production: true, rejectStartup: true, env: { TASKMALL_TEST_WALLET: '1' } });
  assert.match(rejected.errors, /Test wallet requires/);
  const production = await start(t, { production: true });
  const result = await production.request('/api/auth/signup', { email: 'prod@taskmall.test', password }, undefined, { Origin: 'https://taskmall.test' });
  assert.equal(result.status, 201);
  assert.match(result.headers.get('set-cookie'), /; Secure/);
  assert.equal(result.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await production.request('/api/payment-config')).body.available, false);
});

test('pending withdrawals do not count as settled payouts in isolated test mode', async t => {
  const app = await start(t, { wallet: true });
  const registered = await app.request('/api/auth/signup', { email: 'wallet@taskmall.test', password });
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.request('/api/wallet/deposit', { amount: 200, network: 'trc20' }, cookie)).status, 200);
  assert.equal((await app.request('/api/vips/vip2/buy', {}, cookie)).status, 200);
  assert.equal((await app.request('/api/tasks/vip2-daily-task/complete', {}, cookie)).status, 200);
  assert.equal((await app.request('/api/payment-config')).body.minimumWithdrawalAmount, 10);
  const before = (await app.request('/api/me', undefined, cookie)).body.user.withdrawBalance;
  for (const amount of [5, 9.99]) {
    assert.equal((await app.request('/api/wallet/withdraw', { amount, network: 'trc20', wallet: 'TEST_WALLET_ADDRESS' }, cookie)).status, 400);
    assert.equal((await app.request('/api/me', undefined, cookie)).body.user.withdrawBalance, before);
  }
  const withdrawal = await app.request('/api/wallet/withdraw', { amount: 10, network: 'trc20', wallet: 'TEST_WALLET_ADDRESS' }, cookie);
  assert.equal(withdrawal.status, 200);
  assert.equal(withdrawal.body.user.withdrawnTotal, 0);
  assert.equal(withdrawal.body.user.withdrawFeeTotal, 0);
  assert.equal(withdrawal.body.activities[0].status, 'pending');
  assert.equal(withdrawal.body.activities[0].netAmount, 9);
});
