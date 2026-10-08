'use strict';

const $ = selector => document.querySelector(selector);
const labels = { requested: 'Awaiting review', approved: 'Approved', submitted: 'Awaiting confirmation', confirmed: 'Confirmed', rejected: 'Rejected' };
const errors = {
  OPERATOR_AUTH_REQUIRED: 'Operator session expired. Open a new session from your private terminal.',
  PAYOUT_SENDING_DISABLED: 'Withdrawal sending is not enabled.',
  INVALID_NETWORK_FEE_LIMIT: 'Enter an explicit network fee limit between 1 and 200 TRX.',
  PAYOUT_INTENT_EXPIRED_REVIEW_REQUIRED: 'The prepared transaction expired. This request is held for review; no replacement will be created automatically.',
  PAYOUT_FEE_LIMIT_ALREADY_FIXED: 'This request already has a fixed network fee limit.',
  TREASURY_USDT_INSUFFICIENT: 'The treasury has insufficient confirmed USDT.',
  TREASURY_TRX_RESERVE_REQUIRED: 'The treasury needs the selected maximum fee plus 1 TRX as a conservative reserve.',
  PAYOUT_NETWORK_UNAVAILABLE: 'Network check unavailable. The request remains reserved.',
  WALLET_MISSING: 'TronLink is not available in this browser.',
  WALLET_ACCOUNT_MISMATCH: 'Select the configured treasury account in TronLink.',
  MAINNET_REQUIRED: 'Select TRON Mainnet with the official TronGrid node in TronLink.',
  WALLET_CHANGED: 'The TronLink account or network changed. Review the request again.',
  INVALID_PAYOUT_TRANSACTION: 'Transaction validation failed. No broadcast was requested.',
  REQUEST_FAILED: 'The request could not be completed. Check its saved status before retrying.'
};
let state;
let provider;
let walletConnected = false;
let filter = 'active';
let selectedId;
let prepared;
let busy = false;
let walletRevision = 0;
const pendingSignatures = new Map();
const walletWeb = () => provider?.tronWeb || (provider === window.tronLink ? window.tronWeb : null);

function decimal(value) {
  const n = BigInt(value || 0);
  const fractional = String(n % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  return String(n / 1_000_000n) + (fractional ? '.' + fractional : '');
}
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
function icons() { window.lucide?.createIcons(); }
function notice(message, modal = false) { const el = $(modal ? '#review-notice' : '#notice'); el.textContent = message; el.hidden = !message; }
function errorMessage(error) {
  if (error.code === 4001 || error.code === 4000) return 'TronLink request cancelled. No new broadcast was requested.';
  if ([-32000, -32002].includes(error.code)) return 'A TronLink request is already pending.';
  return errors[error.message] || errors.REQUEST_FAILED;
}
async function api(route, body) {
  const response = await fetch('/operator/api/' + route, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error',
    signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json', ...(body === undefined ? {} : { 'X-Operator-CSRF': state?.csrf || '' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'REQUEST_FAILED');
  return result;
}
function selected() { return state?.withdrawals.find(row => row.id === selectedId); }
function render() {
  $('#treasury').textContent = state.treasury;
  $('#sending-status').textContent = state.sendingEnabled ? 'Sending enabled' : 'Sending not enabled';
  $('#sending-status').classList.toggle('ready', state.sendingEnabled);
  $('#session-status').textContent = 'Expires ' + new Date(state.expiresAt).toLocaleTimeString('en-GB');
  const sum = status => state.withdrawals.filter(row => row.status === status).reduce((n, row) => n + BigInt(row.net_units), 0n);
  $('#requested-count').textContent = state.withdrawals.filter(row => row.status === 'requested').length;
  $('#approved-total').textContent = decimal(sum('approved')) + ' USDT';
  $('#submitted-count').textContent = state.withdrawals.filter(row => row.status === 'submitted').length;
  $('#confirmed-total').textContent = decimal(sum('confirmed')) + ' USDT';
  const rows = state.withdrawals.filter(row => filter === 'all' || (filter === 'active' ? ['requested', 'approved', 'submitted'].includes(row.status) : row.status === filter));
  $('#withdrawals').innerHTML = rows.length ? '<div class="table-head"><span>Request / Created</span><span>Recipient</span><span>Net USDT</span><span>Status</span><span></span></div>' + rows.map(row => `
    <article class="request-row"><div><strong>${escape(row.id.slice(0, 8))}</strong><small>${escape(new Date(row.created_at).toLocaleString('en-GB'))}</small></div>
      <div class="recipient"><code>${escape(row.destination)}</code>${row.txid ? `<small><a class="tx-link" href="https://tronscan.org/#/transaction/${escape(row.txid)}" target="_blank" rel="noopener noreferrer">${escape(row.txid.slice(0, 16))}...</a></small>` : ''}</div>
      <div><strong>${decimal(row.net_units)}</strong><small>Fee ${decimal(row.fee_units)}</small></div><div class="row-status ${escape(row.status)}">${escape(labels[row.status] || row.status)}${row.issue ? `<small>${escape(row.issue.replace(/_/g, ' '))}</small>` : ''}</div>
      <button data-review="${escape(row.id)}"><i data-lucide="arrow-up-right"></i>Review</button></article>`).join('') : '<div class="empty">No withdrawal requests in this view.</div>';
  icons();
  updateControls();
}
async function refresh() { state = await api('state'); render(); }
function updateControls() {
  const row = selected();
  if (!row) return;
  const checked = $('#confirm-details').checked;
  $('#approve').hidden = row.status !== 'requested';
  $('#reject').hidden = row.status !== 'requested';
  $('#prepare-controls').hidden = row.status !== 'approved' || Boolean(prepared) || pendingSignatures.has(row.id);
  $('#send').hidden = row.status !== 'approved' || !prepared || pendingSignatures.has(row.id);
  $('#retry').hidden = !(row.status === 'submitted' && row.signed) && !pendingSignatures.has(row.id);
  $('#retry-label').textContent = pendingSignatures.has(row.id) ? 'Save signed transaction and retry' : 'Retry same transaction';
  $('#approve').disabled = busy || !checked;
  $('#reject').disabled = busy;
  $('#prepare').disabled = busy || !state.sendingEnabled || !$('#fee-limit').value || !$('#fee-limit').validity.valid;
  $('#send').disabled = busy || !checked || !walletConnected || !state.sendingEnabled;
  $('#retry').disabled = busy || !checked || !state.sendingEnabled;
  $('#review-connect').hidden = walletConnected || row.status !== 'approved';
  $('#review-connect').disabled = busy;
  $('#close').disabled = busy;
  $('#connect').disabled = busy;
}
function review(id) {
  selectedId = id;
  prepared = null;
  const row = selected();
  if (!row) return;
  $('#confirm-details').checked = false;
  $('#review-net').textContent = decimal(row.net_units);
  $('#review-id').textContent = row.id;
  $('#review-from').textContent = state.treasury;
  $('#review-to').textContent = row.destination;
  $('#review-gross').textContent = decimal(row.gross_units) + ' USDT';
  $('#review-fee').textContent = decimal(row.fee_units) + ' USDT';
  $('#review-status').textContent = labels[row.status];
  $('#fee-limit').value = row.preparedFeeLimitSun ? decimal(row.preparedFeeLimitSun) : '';
  $('#fee-limit').disabled = row.prepared;
  $('#transaction-details').hidden = true;
  notice(row.issue ? row.issue.replace(/_/g, ' ') : '', true);
  updateControls();
  if (!$('#review').open) $('#review').showModal();
}
async function walletReady() {
  const revision = walletRevision;
  const web = walletWeb();
  if (!web?.defaultAddress?.base58) throw new Error('WALLET_MISSING');
  if (web.defaultAddress.base58 !== state.treasury) throw new Error('WALLET_ACCOUNT_MISMATCH');
  const host = new URL(web.fullNode.host);
  if (host.origin !== 'https://api.trongrid.io') throw new Error('MAINNET_REQUIRED');
  const genesis = await web.trx.getBlockByNumber(0);
  if (String(genesis.blockID).slice(-8).toLowerCase() !== '2b6653dc') throw new Error('MAINNET_REQUIRED');
  if (revision !== walletRevision || walletWeb() !== web || web.defaultAddress.base58 !== state.treasury) throw new Error('WALLET_CHANGED');
  return web;
}
function walletChanged() {
  walletRevision++;
  walletConnected = false;
  prepared = null;
  $('#transaction-details').hidden = true;
  $('#confirm-details').checked = false;
  $('#wallet-status').textContent = 'Account or network changed';
  notice('TronLink account or network changed. Reconnect the treasury wallet.');
  updateControls();
}
async function connect() {
  provider ||= window.tron?.isTronLink ? window.tron : window.tronLink;
  if (!provider) throw new Error('WALLET_MISSING');
  try { await provider.request({ method: 'eth_requestAccounts' }); }
  catch (error) {
    if (![4200, -32601].includes(error.code)) throw error;
    const result = await provider.request({ method: 'tron_requestAccounts' });
    if (result?.code !== 200) throw Object.assign(new Error('WALLET_MISSING'), { code: result?.code });
  }
  await walletReady();
  provider.removeListener?.('accountsChanged', walletChanged);
  provider.removeListener?.('chainChanged', walletChanged);
  provider.removeListener?.('disconnect', walletChanged);
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.on?.(event, walletChanged);
  walletConnected = true;
  $('#wallet-status').textContent = 'Treasury connected / Mainnet';
  $('#connect').innerHTML = '<i data-lucide="wallet"></i>Treasury connected';
  notice('');
  icons();
}
function validatePreview(transaction, row, web) {
  const raw = transaction.raw_data;
  const operation = raw?.contract?.[0];
  const data = operation?.parameter?.value;
  const hex = address => web.address.toHex(address).toLowerCase();
  const expected = 'a9059cbb' + hex(row.destination).slice(2).padStart(64, '0') + BigInt(row.net_units).toString(16).padStart(64, '0');
  if (raw.contract.length !== 1 || operation.type !== 'TriggerSmartContract' || data.owner_address?.toLowerCase() !== hex(state.treasury)
    || data.contract_address?.toLowerCase() !== hex(state.contract) || data.data?.toLowerCase() !== expected || data.call_value
    || raw.fee_limit !== prepared.feeLimitSun || raw.expiration <= Date.now()) throw new Error('INVALID_PAYOUT_TRANSACTION');
}
async function sendStored() {
  const id = selectedId;
  if (pendingSignatures.has(id)) {
    await api('withdrawals/' + id + '/signed', { transaction: pendingSignatures.get(id) });
    pendingSignatures.delete(id);
  }
  const result = await api('withdrawals/' + id + '/send', {});
  await refresh();
  review(id);
  notice(result.confirmed ? 'Payment confirmed on-chain.' : result.broadcastAcknowledged
    ? 'Transaction broadcast acknowledged. Awaiting chain confirmation.'
    : 'Broadcast outcome is unknown or expired. The same transaction remains saved; do not create another payment.', true);
}
async function action(name) {
  const id = selectedId;
  if (name === 'prepare') {
    prepared = await api('withdrawals/' + id + '/prepare', { feeLimitSun: Math.round(Number($('#fee-limit').value) * 1e6) });
    $('#transaction-details').hidden = false;
    $('#review-network-fee').textContent = decimal(prepared.feeLimitSun) + ' TRX maximum';
    $('#review-txid').textContent = prepared.transaction.txID;
    $('#review-expiry').textContent = new Date(prepared.transaction.raw_data.expiration).toLocaleTimeString('en-GB');
    $('#confirm-details').checked = false;
  } else if (name === 'send') {
    const web = await walletReady();
    validatePreview(prepared.transaction, selected(), web);
    const signed = await web.trx.sign(prepared.transaction);
    pendingSignatures.set(id, signed);
    await api('withdrawals/' + id + '/signed', { transaction: signed });
    pendingSignatures.delete(id);
    await walletReady();
    await sendStored();
  } else if (name === 'retry') await sendStored();
  else {
    if (name === 'reject' && !window.confirm('Reject this request and return its reserved amount?')) return;
    await api('withdrawals/' + id + '/' + name, {});
    await refresh();
    review(id);
  }
}
async function run(operation, modal = false) {
  if (busy) return;
  busy = true;
  updateControls();
  notice('', modal);
  try { await operation(); }
  catch (error) { notice(errorMessage(error), modal); }
  finally { busy = false; updateControls(); }
}
window.addEventListener('TIP6963:announceProvider', event => {
  if (event.detail?.info?.name === 'TronLink' && !walletConnected) provider = event.detail.provider;
});
window.dispatchEvent(new Event('TIP6963:requestProvider'));
window.addEventListener('message', event => {
  if (event.source === window && provider === window.tronLink && ['setAccount', 'setNode', 'accountsChanged', 'disconnect'].includes(event.data?.message?.action)) walletChanged();
});
$('#connect').addEventListener('click', () => run(connect));
$('#review-connect').addEventListener('click', () => run(connect, true));
$('#refresh').addEventListener('click', () => run(refresh));
$('#logout').addEventListener('click', () => run(async () => { await api('logout', {}); location.replace('/operator/unlock'); }));
$('#withdrawals').addEventListener('click', event => { const button = event.target.closest('[data-review]'); if (button && !busy) review(button.dataset.review); });
$('.tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button || busy) return;
  filter = button.dataset.filter;
  for (const item of document.querySelectorAll('[data-filter]')) item.setAttribute('aria-pressed', String(item === button));
  render();
});
$('#close').addEventListener('click', () => $('#review').close());
$('#review').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('#confirm-details').addEventListener('change', updateControls);
$('#fee-limit').addEventListener('input', updateControls);
for (const name of ['approve', 'reject', 'prepare', 'send', 'retry']) $('#' + name).addEventListener('click', () => run(() => action(name), true));
run(refresh);
setInterval(() => { if (!busy && !$('#review').open) run(refresh); }, 15_000);
