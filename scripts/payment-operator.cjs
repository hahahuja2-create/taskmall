'use strict';

const path = require('node:path');
const readline = require('node:readline/promises');
const { loadOperatorToken, operatorClient } = require('../payments/operator');

async function main() {
  const data = process.env.TASKMALL_DATA_DIR || path.join(__dirname, '..', 'data');
  const token = await loadOperatorToken(process.env.TASKMALL_OPERATOR_TOKEN_FILE || path.join(data, 'operator.token'));
  const request = operatorClient(process.env.TASKMALL_OPERATOR_ORIGIN || 'http://127.0.0.1:' + (process.env.PORT || 4173), token);
  const [area = 'withdrawals', action = 'list', id, txid] = process.argv.slice(2);
  if (!['withdrawals', 'collections'].includes(area)) throw new Error('Use withdrawals or collections.');
  if (action === 'list') {
    const result = await request(area);
    const rows = result[area].map(row => area === 'withdrawals' ? { id: row.id, status: row.status, destination: row.destination,
      grossUSDT: Number(row.gross_units) / 1e6, feeUSDT: Number(row.fee_units) / 1e6, sendUSDT: Number(row.net_units) / 1e6, txid: row.txid, issue: row.issue }
      : { id: row.id, source: row.address, destination: row.treasury, usdt: Number(row.amount_units) / 1e6, status: row.status, txid: row.txid, issue: row.issue });
    console.table(rows);
    return;
  }
  if (area === 'collections' && action === 'plan') { const result = await request('collections/plan', {}); console.log('Collection jobs:', result.collections.length); return; }
  if (!/^[a-f0-9-]{36}$/.test(id || '') || (area === 'withdrawals' ? !['approve', 'reject', 'record', 'release-failed'].includes(action) : action !== 'release-failed')) throw new Error('Use withdrawals approve/reject/record/release-failed REQUEST_ID [TXID], or collections release-failed JOB_ID.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Operator changes require your private interactive terminal.');
  const row = (await request(area))[area].find(item => item.id === id);
  if (!row) throw new Error('Outgoing request not found.');
  console.log('Destination:', row.destination || row.treasury);
  console.log('Exact USDT:', Number(row.net_units || row.amount_units) / 1e6, '| Status:', row.status);
  console.log('This tool never signs or sends a withdrawal. Send only once using TronLink after approval.');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { if (await prompt.question(`Type ${action} to confirm: `) !== action) throw new Error('Cancelled.'); }
  finally { prompt.close(); }
  const result = await request(area + '/' + id + '/' + action, action === 'record' ? { txid } : {});
  console.log('Status:', result.withdrawal?.status || (result.ok ? 'Verified failed transaction released.' : 'Not completed.'));
}
main().catch(error => { console.error('Operator action not completed:', /^[A-Z_]+$/.test(error.message) ? error.message : 'Check the private terminal, command and local server configuration.'); process.exitCode = 1; });
