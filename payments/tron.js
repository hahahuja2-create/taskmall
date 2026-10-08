'use strict';

const crypto = require('node:crypto');
const { HDNodeWallet, encodeBase58, decodeBase58, getAddress, verifyMessage, id } = require('ethers');

const BRANCH_PATH = "m/44'/195'/0'/0";
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRANSFER_TOPIC = id('Transfer(address,address,uint256)').slice(2);
const MAX_UNITS = 100_000_000_000_000n;

function checksum(bytes) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(bytes).digest()).digest().subarray(0, 4);
}

function tronAddress(hex) {
  if (!/^(?:41)?[a-fA-F0-9]{40}$/.test(hex)) throw new Error('Invalid TRON address bytes.');
  const bytes = Buffer.from(hex.length === 40 ? `41${hex}` : hex, 'hex');
  return encodeBase58(Buffer.concat([bytes, checksum(bytes)]));
}

function addressHex(address) {
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error('Invalid TRON address.');
  const bytes = Buffer.from(decodeBase58(address).toString(16).padStart(50, '0'), 'hex');
  if (bytes.length !== 25 || bytes[0] !== 0x41 || !crypto.timingSafeEqual(bytes.subarray(21), checksum(bytes.subarray(0, 21)))) {
    throw new Error('Invalid TRON address checksum.');
  }
  return bytes.subarray(0, 21).toString('hex');
}

function units(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(6) : String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('Invalid USDT amount.');
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (amount > MAX_UNITS) throw new Error('USDT balance limit exceeded.');
  return amount;
}

function amount(unitsValue) {
  const value = BigInt(unitsValue);
  if (value < 0n || value > MAX_UNITS) throw new Error('USDT balance limit exceeded.');
  return Number(value) / 1_000_000;
}

function publicBranch(xpub) {
  if (typeof xpub !== 'string' || !xpub.startsWith('xpub')) throw new Error('Only a public HD key is accepted.');
  const branch = HDNodeWallet.fromExtendedKey(xpub);
  if ('privateKey' in branch || branch.depth !== 4 || branch.index !== 0) throw new Error('Expected a public external-chain key at depth 4.');
  return branch;
}

function deriveAddress(xpub, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error('Invalid deposit address index.');
  const wallet = publicBranch(xpub).deriveChild(index);
  return tronAddress(wallet.address.slice(2));
}

function proofMessage(xpub, treasury) {
  addressHex(treasury);
  publicBranch(xpub);
  return `TaskMall deposit wallet v1\nNetwork: TRON Mainnet\nTreasury: ${treasury}\nPath: ${BRANCH_PATH}\nPublic key: ${xpub}`;
}

function validateWallet(config, treasury) {
  if (!config || config.version !== 1 || config.network !== 'tron-mainnet' || config.branchPath !== BRANCH_PATH || config.treasuryAddress !== treasury) {
    throw new Error('Invalid public deposit wallet configuration.');
  }
  const branch = publicBranch(config.xpub);
  const recovered = verifyMessage(proofMessage(config.xpub, treasury), config.proof);
  if (getAddress(recovered) !== getAddress(branch.deriveChild(0).address) || config.firstAddress !== deriveAddress(config.xpub, 0)) {
    throw new Error('Deposit wallet control proof is invalid.');
  }
  const fingerprint = crypto.createHash('sha256').update(config.xpub).digest('hex');
  return { ...config, fingerprint };
}

function decodeTransfers(info, txid, solidHeight) {
  if (!/^[0-9a-f]{64}$/.test(txid) || info.id !== txid || !Number.isSafeInteger(info.blockNumber) || info.blockNumber > solidHeight) {
    throw new Error('Transaction is not solidified or has an invalid identity.');
  }
  if (!Number.isSafeInteger(info.blockTimeStamp) || info.blockTimeStamp <= 0) throw new Error('Missing transaction timestamp.');
  if (info.receipt?.result !== 'SUCCESS') return [];
  if (!Array.isArray(info.log)) return [];
  const contract = addressHex(USDT_CONTRACT).slice(2);
  return info.log.flatMap((log, logIndex) => {
    if (String(log.address).toLowerCase().replace(/^41/, '') !== contract || log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC) return [];
    if (log.topics.length !== 3 || !/^0{24}[0-9a-fA-F]{40}$/.test(log.topics[1]) || !/^0{24}[0-9a-fA-F]{40}$/.test(log.topics[2]) || !/^[0-9a-fA-F]{64}$/.test(log.data)) {
      throw new Error('Malformed USDT transfer log.');
    }
    const value = BigInt(`0x${log.data}`);
    if (!value) return [];
    if (value > MAX_UNITS) throw new Error('Deposit exceeds the supported balance limit.');
    return [{ txid, logIndex, contract: USDT_CONTRACT, units: value.toString(),
      from: tronAddress(log.topics[1].slice(24)), to: tronAddress(log.topics[2].slice(24)),
      blockNumber: info.blockNumber, timestamp: info.blockTimeStamp }];
  });
}

class TronGrid {
  constructor(apiKey, fetcher = fetch) { this.apiKey = apiKey; this.fetcher = fetcher; this.lastRequest = 0; this.queue = Promise.resolve(); }

  request(route, body) {
    const next = this.queue.then(() => this.requestInside(route, body));
    this.queue = next.catch(() => {});
    return next;
  }

  async requestInside(route, body) {
    const wait = Math.max(0, 350 - (Date.now() - this.lastRequest));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastRequest = Date.now();
    const response = await this.fetcher(`https://api.trongrid.io${route}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'TRON-PRO-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(`TRON_NETWORK_HTTP_${response.status}`);
    const result = await response.json();
    if (result.Error || result.success === false) throw new Error('TRON_NETWORK_RESPONSE_ERROR');
    return result;
  }

  async solidHeight() {
    const result = await this.request('/walletsolidity/getnowblock', {});
    const number = result.block_header?.raw_data?.number;
    const timestamp = result.block_header?.raw_data?.timestamp;
    if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('Invalid solidified block response.');
    this.lastSolidTimestamp = timestamp;
    return number;
  }

  async history(address, since, fingerprint) {
    addressHex(address);
    const query = new URLSearchParams({ only_confirmed: 'true', only_to: 'true', contract_address: USDT_CONTRACT,
      limit: '200', order_by: 'block_timestamp,asc', min_timestamp: String(since) });
    if (fingerprint) query.set('fingerprint', fingerprint);
    const result = await this.request(`/v1/accounts/${address}/transactions/trc20?${query}`);
    if (!Array.isArray(result.data)) throw new Error('Invalid TRC20 history response.');
    let next = null;
    if (result.meta?.links?.next) {
      const link = new URL(result.meta.links.next, 'https://api.trongrid.io');
      if (link.origin !== 'https://api.trongrid.io' || link.pathname !== `/v1/accounts/${address}/transactions/trc20`) throw new Error('Invalid TRON history cursor.');
      next = link.searchParams.get('fingerprint');
      if (!next) throw new Error('Missing TRON history cursor.');
    }
    return { rows: result.data, next };
  }

  receipt(txid) {
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Invalid transaction identifier.');
    return this.request('/walletsolidity/gettransactioninfobyid', { value: txid });
  }
}

module.exports = { BRANCH_PATH, USDT_CONTRACT, TRANSFER_TOPIC, MAX_UNITS, addressHex, tronAddress, units, amount,
  deriveAddress, proofMessage, validateWallet, decodeTransfers, TronGrid };
