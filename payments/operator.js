'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function loadOperatorToken(file, create = false, configured = '') {
  if (configured && !/^[a-zA-Z0-9_-]{43}$/.test(configured)) throw new Error('Invalid configured operator credential.');
  if (create) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    try { await fs.writeFile(file, configured || crypto.randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const token = (await fs.readFile(file, 'utf8')).trim();
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new Error('Invalid operator credential file.');
  if (configured && token !== configured) throw new Error('Operator credential conflicts with the configured value.');
  return token;
}

function authorized(req, token) {
  if (!token || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function localRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  try {
    const host = new URL('http://' + req.headers.host);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) && !host.username && !host.password
      && host.pathname === '/' && !host.search && !host.hash
      && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);
  } catch { return false; }
}

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

class OperatorSessions {
  constructor({ now = Date.now, ttl = 15 * 60_000 } = {}) {
    this.now = now;
    this.ttl = ttl;
    this.tickets = new Map();
    this.sessions = new Map();
  }
  prune() {
    for (const map of [this.tickets, this.sessions]) for (const [key, value] of map) if (value.expiresAt <= this.now()) map.delete(key);
  }
  issue(req) {
    if (!localRequest(req)) return null;
    this.prune();
    if (this.tickets.size >= 8) return null;
    const ticket = crypto.randomBytes(32).toString('base64url');
    this.tickets.set(digest(ticket), { host: req.headers.host, expiresAt: this.now() + 60_000 });
    return ticket;
  }
  exchange(req, ticket) {
    if (!localRequest(req) || req.headers.origin !== 'http://' + req.headers.host || !/^[a-zA-Z0-9_-]{43}$/.test(ticket || '')) return null;
    this.prune();
    const key = digest(ticket);
    const grant = this.tickets.get(key);
    if (!grant || grant.host !== req.headers.host || this.sessions.size >= 8) return null;
    this.tickets.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    const session = { host: req.headers.host, csrf: crypto.randomBytes(32).toString('base64url'), expiresAt: this.now() + this.ttl };
    this.sessions.set(digest(token), session);
    return { token, session };
  }
  get(req, mutation = false) {
    if (!localRequest(req)) return null;
    this.prune();
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)taskmall_operator=([a-zA-Z0-9_-]{43})(?:;|$)/);
    if (!match) return null;
    const session = this.sessions.get(digest(match[1]));
    if (!session || session.host !== req.headers.host) return null;
    if (mutation && (req.headers.origin !== 'http://' + req.headers.host || req.headers['x-operator-csrf'] !== session.csrf)) return null;
    return session;
  }
  revoke(req) {
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)taskmall_operator=([a-zA-Z0-9_-]{43})(?:;|$)/);
    if (match) this.sessions.delete(digest(match[1]));
  }
  cookie(token, clear = false) {
    return `taskmall_operator=${clear ? '' : token}; Path=/operator/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : Math.floor(this.ttl / 1000)}`;
  }
}

function operatorClient(origin, token) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/') throw new Error('Operator access requires local loopback or a private SSH loopback tunnel.');
  return async (route, body) => {
    const response = await fetch(new URL('/api/operator/' + route, url), { method: body === undefined ? 'GET' : 'POST',
      redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'OPERATOR_REQUEST_FAILED');
    return result;
  };
}

module.exports = { loadOperatorToken, authorized, operatorClient, localRequest, OperatorSessions };
