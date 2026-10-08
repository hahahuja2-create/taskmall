'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { OperatorSessions, localRequest } = require('./operator');
const { TronLinkPayouts } = require('./payouts');
const { USDT_CONTRACT } = require('./tron');
const { failure } = require('./outgoing');

class OperatorPortal {
  constructor(options) {
    Object.assign(this, options);
    this.sessions = new OperatorSessions();
    this.payouts = new TronLinkPayouts(options);
  }

  async handle(req, res, url) {
    const { json, readBody } = this;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' https://api.trongrid.io; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (!this.getToken() || !localRequest(req)) return json(res, 403, { error: 'OPERATOR_AUTH_REQUIRED' });
    const mutation = req.method === 'POST';
    if (mutation && String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: 'JSON_REQUIRED' });
    if (url.pathname === '/operator/session' && mutation) {
      const body = await readBody(req);
      const grant = this.sessions.exchange(req, body.ticket);
      if (!grant) return json(res, 403, { error: 'OPERATOR_AUTH_REQUIRED' });
      return json(res, 200, { ok: true }, { 'Set-Cookie': this.sessions.cookie(grant.token) });
    }
    const session = this.sessions.get(req, mutation);
    const bootstrap = ['/operator/unlock', '/operator/unlock.js'].includes(url.pathname);
    if (!bootstrap && !session) return json(res, 403, { error: 'OPERATOR_AUTH_REQUIRED' });
    if (!mutation && ['GET', 'HEAD'].includes(req.method)) {
      const files = { '/operator/': 'index.html', '/operator/unlock': 'unlock.html', '/operator/unlock.js': 'unlock.js',
        '/operator/app.js': 'app.js', '/operator/styles.css': 'styles.css' };
      const file = files[url.pathname];
      if (file) {
        const data = await fs.readFile(path.join(__dirname, 'operator-ui', file));
        res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
        return res.end(req.method === 'HEAD' ? undefined : data);
      }
    }
    if (!this.getLedger() || !this.isHealthy()) return json(res, 503, { error: 'STORAGE_UNAVAILABLE' });
    if (req.method === 'GET' && url.pathname === '/operator/api/state') {
      return this.exclusive(() => json(res, 200, { treasury: this.treasury, contract: USDT_CONTRACT,
        sendingEnabled: this.isSendingEnabled(), csrf: session.csrf, expiresAt: session.expiresAt,
        withdrawals: this.getLedger().withdrawals().map(row => {
          const intent = this.getLedger().withdrawalIntent(row.id);
          return { ...row, prepared: Boolean(intent), preparedFeeLimitSun: intent?.fee_limit || null,
            signed: Boolean(this.getLedger().signedWithdrawal(row.id)) };
        }) }));
    }
    if (mutation && url.pathname === '/operator/api/logout') {
      this.sessions.revoke(req);
      return json(res, 200, { ok: true }, { 'Set-Cookie': this.sessions.cookie('', true) });
    }
    const match = url.pathname.match(/^\/operator\/api\/withdrawals\/([a-f0-9-]{36})\/(approve|reject|prepare|signed|send)$/);
    if (!mutation || !match) return json(res, 404, { error: 'NOT_FOUND' });
    const body = await readBody(req);
    const [, id, action] = match;
    if (['approve', 'reject'].includes(action)) {
      return this.exclusive(() => {
        const next = structuredClone(this.getState());
        const result = this.getLedger().decide(next, id, action);
        this.commitState(next);
        json(res, 200, { withdrawal: result.record });
      });
    }
    try {
      const result = action === 'prepare' ? await this.payouts.prepare(id, body.feeLimitSun)
        : action === 'signed' ? await this.payouts.record(id, body.transaction) : await this.payouts.send(id);
      return json(res, result.broadcastAcknowledged === false ? 202 : 200, result);
    } catch (error) {
      if (error.status || String(error.code || '').includes('SQLITE')) throw error;
      throw failure('PAYOUT_NETWORK_UNAVAILABLE', 503);
    }
  }
}

module.exports = { OperatorPortal };
