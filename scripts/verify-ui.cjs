const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:4187';

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmall-ui-'));
  const output = path.join(root, 'artifacts', 'ui');
  await fs.mkdir(output, { recursive: true });
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', TASKMALL_TEST_WALLET: '1', PUBLIC_ORIGIN: '', PORT: '4187', TASKMALL_DATA_DIR: dataDir },
    stdio: 'pipe', windowsHide: true
  });
  let browser;
  let serverError = '';
  server.stderr.on('data', chunk => { serverError += chunk; });
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(serverError, '', serverError);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ka-GE' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (message.location().url.endsWith('/api/me') && message.text().includes('401')) return;
      errors.push(message.text());
    });

    async function screenshot(name) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: false });
    }
    async function layout(name, oneScreen = false) {
      await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
      const result = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight,
        docWidth: document.documentElement.scrollWidth,
        docHeight: document.documentElement.scrollHeight,
        imageFailures: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.src),
        sections: [...document.querySelectorAll('.topbar, .page-heading, .metrics-grid, .earnings-panel, .membership-panel, .daily-panel, .recent-panel, .workspace-footer')].map(element => ({ class: element.className, height: element.getBoundingClientRect().height, top: element.getBoundingClientRect().top })),
        oversized: [...document.querySelectorAll('button, input, select, h1, h2, h3')].filter(element => {
          const box = element.getBoundingClientRect();
          return box.width && (box.right > innerWidth + 1 || box.left < -1);
        }).map(element => element.outerHTML.slice(0, 160))
      }));
      assert.ok(result.docWidth <= result.width + 1, name + ': horizontal overflow ' + JSON.stringify(result));
      assert.equal(result.oversized.length, 0, name + ': elements outside viewport');
      if (oneScreen && result.docHeight > result.height + 1) await screenshot(name + '-overflow');
      if (oneScreen) assert.ok(result.docHeight <= result.height + 1, name + ': vertical overflow ' + JSON.stringify(result));
      assert.equal(result.imageFailures.length, 0, name + ': broken images');
      assert.doesNotMatch(await page.locator('body').innerText(), /\bdemo\b|დემო/i, name + ': obsolete workspace label');
      console.log(name + ': ' + result.docWidth + 'x' + result.docHeight + ', no horizontal overflow');
    }
    async function view(name) {
      const scope = (await page.locator('.sidebar').isVisible()) ? '.sidebar' : '.bottom-nav';
      if (['wallet', 'company', 'support'].includes(name) && scope === '.bottom-nav') {
        await page.locator('[data-action="mobile-menu"]').click();
        await page.locator('.mobile-menu [data-view="' + name + '"]').click();
      } else await page.locator(scope + ' .' + (scope === '.sidebar' ? 'nav-button' : 'bottom-nav-button') + '[data-view="' + name + '"]').click();
      await page.locator('.page').waitFor();
    }

    await page.goto(url);
    await page.locator('#auth-email').waitFor();
    assert.equal(await page.locator('#auth-name').count(), 0);
    for (const size of [[1440, 900], [1366, 768], [390, 844], [375, 667], [360, 640]]) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await layout('auth-' + size.join('x'), true);
      await screenshot('auth-' + size.join('x'));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.auth-topline nav [data-action="public-view"][data-view="company"]').click();
    await page.locator('.company-masthead').waitFor();
    await layout('public-company');
    await screenshot('public-company');
    await page.locator('[data-action="public-view"][data-view="support"]').click();
    await page.locator('.faq-item').first().waitFor();
    await page.locator('.public-header [data-action="auth-home"]').last().click();
    await page.locator('[data-mode="signup"]').click();
    await page.locator('#auth-email').fill('workspace@taskmall.test');
    await page.locator('#auth-password').fill('PreviewPass2026');
    await page.locator('#auth-confirm').fill('DifferentPass2026');
    await page.locator('.auth-submit').click();
    await page.locator('#auth-message').filter({ hasText: /.+/ }).waitFor();
    await page.locator('#auth-confirm').fill('PreviewPass2026');
    await page.locator('.auth-submit').click();
    await page.locator('.dashboard-page').waitFor();
    assert.equal(await page.locator('.sidebar').isVisible(), true);
    await page.locator('[data-action="open-task"]:not(:disabled)').first().click();
    await page.locator('.dialog').waitFor();
    assert.equal(await page.locator('[data-action="complete-task"]').isDisabled(), true);
    for (const checkbox of await page.locator('[data-step]').all()) await checkbox.check();
    await page.locator('.dialog-close').click();
    await page.locator('.dialog').waitFor({ state: 'detached' });
    assert.match(await page.locator('.metric-card.amber strong').textContent(), /0[,.]00 USDT/);
    await view('wallet');
    await page.locator('[data-wallet-type="deposit"]').click();
    await page.locator('input[name="amount"]').fill('300');
    await page.locator('.wallet-form button[type="submit"]').click();
    await page.locator('.dialog').waitFor({ state: 'detached' });
    assert.match(await page.locator('.balance-card.locked strong').textContent(), /300/);
    await view('vip');
    assert.equal(await page.locator('.vip-card').count(), 12);
    assert.equal(await page.locator('.vip-page .pagination').count(), 0);
    assert.match(await page.locator('.vip-card').first().textContent(), /10/);
    await page.locator('[data-vip-id="vip3"]').click();
    await page.locator('.vip-card.current').filter({ hasText: 'VIP 3' }).waitFor();
    assert.match(await page.locator('.vip-card.current').textContent(), /365/);
    await view('home');
    await page.locator('[data-action="open-task"]:not(:disabled)').first().click();
    for (const checkbox of await page.locator('[data-step]').all()) await checkbox.check();
    await page.locator('[data-action="complete-task"]').click();
    await page.locator('.dialog').waitFor({ state: 'detached' });
    await view('wallet');
    await page.locator('[data-wallet-type="transfer"]').click();
    await page.locator('input[name="amount"]').fill('1');
    await page.locator('.wallet-form button[type="submit"]').click();
    await page.locator('.dialog').waitFor({ state: 'detached' });
    await page.locator('[data-wallet-type="withdraw"]').click();
    assert.equal(await page.locator('input[name="amount"]').getAttribute('min'), '10');
    await page.locator('input[name="amount"]').fill('10');
    await page.locator('input[name="wallet"]').fill('TPreviewWalletAddress00000000');
    await page.locator('.wallet-form button[type="submit"]').click();
    await page.locator('.dialog').waitFor({ state: 'detached' });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="export-history"]').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'taskmall-transactions.csv');
    await view('tasks');
    assert.equal(await page.locator('.task-card').count(), 12);
    assert.equal(await page.locator('.tasks-page .pagination').count(), 0);
    await page.locator('#task-search').fill('VIP 9');
    assert.equal(await page.locator('.task-card').count(), 1);
    await page.locator('#task-search').fill('VIP 11');
    assert.equal(await page.locator('.task-card').count(), 1);
    await page.locator('#task-search').fill('no-result-xyz');
    assert.equal(await page.locator('.empty-state').count(), 1);
    await page.locator('#task-search').fill('');
    await page.locator('[data-task-sort]').selectOption('reward');
    assert.match(await page.locator('.task-card h3').first().textContent(), /დინამიკი/);
    await page.locator('[data-task-sort]').selectOption('default');
    await page.locator('[data-filter="completed"]').click();
    assert.ok(await page.locator('.task-card.completed').count() >= 1);
    await page.locator('[data-filter="all"]').click();
    await view('me');
    await page.locator('#profile-name').fill('TaskMall');
    await page.locator('.profile-form button[type="submit"]').click();
    await page.locator('.profile-summary h2').filter({ hasText: 'TaskMall' }).waitFor();
    await view('home');
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#earnings-chart').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0);
    const graph = await page.evaluate(() => {
      const canvas = document.querySelector('#earnings-chart');
      const chart = Chart.getChart(canvas);
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let bars = 0;
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] === 23 && pixels[index + 1] === 107 && pixels[index + 2] === 86 && pixels[index + 3] > 0) bars++;
      return { total: chart.data.datasets[0].data.reduce((sum, value) => sum + value, 0), bars };
    });
    assert.equal(graph.total, 30.3);
    assert.ok(graph.bars > 50, 'Earnings chart must render the actual data');
    await page.locator('.topbar [data-language-select]').selectOption('en');
    await page.locator('.page-heading h1').filter({ hasText: 'Overview' }).waitFor();

    for (const size of [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [390, 844], [375, 667], [360, 640]]) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      for (const name of ['home', 'tasks', 'vip', 'team', 'wallet', 'me', 'company', 'support']) {
        await view(name);
        if (name === 'tasks' || name === 'vip') {
          const selector = name === 'tasks' ? '.task-card' : '.vip-card';
          assert.equal(await page.locator(selector).count(), 12);
          assert.equal(await page.locator('.page .pagination').count(), 0);
          await page.locator(selector).last().scrollIntoViewIfNeeded();
          assert.equal(await page.locator(selector).last().isVisible(), true);
          await page.evaluate(() => scrollTo(0, 0));
        }
        await layout(name + '-' + size.join('x'), name === 'home');
        if ([1440, 390].includes(size[0])) await screenshot(name + '-' + size.join('x'));
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await view('wallet');
    await page.locator('[data-wallet-type="deposit"]').click();
    await screenshot('wallet-dialog-mobile');
    await page.keyboard.press('Escape');
    await page.locator('.dialog').waitFor({ state: 'detached' });
    await view('me');
    await page.locator('[data-action="logout"]').click();
    await page.locator('#auth-email').waitFor();
    await page.locator('#auth-email').fill('workspace@taskmall.test');
    await page.locator('#auth-password').fill('PreviewPass2026');
    await page.locator('.auth-submit').click();
    await page.locator('.dashboard-page').waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });
    await view('me');
    await page.locator('[data-action="logout"]').click();
    await page.locator('[data-mode="signup"]').click();
    await page.reload();
    await page.locator('#auth-email').waitFor();
    await screenshot('auth-desktop-final');
    await layout('auth-desktop-final', true);
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot('auth-mobile-final');
    await page.route('**/api/payment-config', route => route.fulfill({ json: { available: false, networks: [] } }));
    await page.reload();
    await page.locator('[data-mode="login"]').click();
    await page.locator('#auth-email').fill('workspace@taskmall.test');
    await page.locator('#auth-password').fill('PreviewPass2026');
    await page.locator('.auth-submit').click();
    await page.locator('.dashboard-page').waitFor();
    await view('wallet');
    await page.locator('[data-wallet-type="deposit"]').click();
    await page.locator('.dialog').waitFor();
    assert.equal(await page.locator('.wallet-form').count(), 0);
    assert.equal(await page.locator('[data-deposit-address]').count(), 0);
    await screenshot('payments-unavailable-mobile');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    await view('vip');
    await layout('vip-production-desktop');
    await screenshot('vip-production-desktop');
    assert.deepEqual(errors, [], 'Browser errors');
    console.log('PASS: responsive layouts, public pages, authentication, tasks, wallet operations, VIP, CSV, search, sorting, profile, logout, login.');
  } finally {
    await browser?.close();
    server.kill();
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(dataDir).startsWith('taskmall-ui-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
