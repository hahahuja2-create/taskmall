'use strict';

// Deterministic provider fixture for isolated tests only; never loaded by npm start.
if (process.env.NODE_ENV !== 'test' || !process.env.TASKMALL_TRON_FIXTURE) throw new Error('TRON fixture requires isolated test configuration.');
const fs = require('node:fs');
const { tronAddress } = require('../payments/tron');
const { unsignedToken } = require('./tron-test-helpers.cjs');
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.origin !== 'https://api.trongrid.io') throw new Error('Unexpected test network request.');
  const fixture = JSON.parse(fs.readFileSync(process.env.TASKMALL_TRON_FIXTURE, 'utf8'));
  if (fixture.offline) return new Response('', { status: 503 });
  let result;
  if (url.pathname === '/walletsolidity/getnowblock') result = { block_header: { raw_data: { number: 1000, timestamp: Date.now() } } };
  else if (url.pathname === '/walletsolidity/gettransactioninfobyid') result = fixture.receipts[JSON.parse(options.body).value] || {};
  else if (fixture.payouts && url.pathname === '/walletsolidity/triggerconstantcontract') result = { result: { result: true }, constant_result: [BigInt(fixture.payouts.usdt || 0).toString(16).padStart(64, '0')] };
  else if (fixture.payouts && url.pathname === '/walletsolidity/getaccount') result = { address: JSON.parse(options.body).address, balance: fixture.payouts.trx || 0 };
  else if (fixture.payouts && url.pathname === '/wallet/triggersmartcontract') {
    const body = JSON.parse(options.body);
    result = { result: { result: true }, transaction: unsignedToken({ from: tronAddress(body.owner_address),
      to: tronAddress('41' + body.parameter.slice(24, 64)), value: BigInt('0x' + body.parameter.slice(64)), feeLimit: body.fee_limit }) };
  } else if (fixture.payouts && url.pathname === '/wallet/broadcasttransaction') {
    const transaction = JSON.parse(options.body);
    fixture.broadcasts ||= [];
    fixture.broadcasts.push(transaction);
    fs.writeFileSync(process.env.TASKMALL_TRON_FIXTURE, JSON.stringify(fixture));
    result = fixture.payouts.lostAck ? { result: false } : { result: true };
  }
  else {
    const match = url.pathname.match(/^\/v1\/accounts\/(T[^/]+)\/transactions\/trc20$/);
    if (!match) throw new Error('Unexpected test provider endpoint.');
    result = { data: (fixture.history[match[1]] || []).filter(row => row.block_timestamp >= Number(url.searchParams.get('min_timestamp'))), meta: {} };
  }
  return Response.json(result);
};
