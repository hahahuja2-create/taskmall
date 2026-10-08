'use strict';

const { TronWeb, utils } = require('tronweb');
const { Interface, AbiCoder } = require('ethers');
const { USDT_CONTRACT, addressHex, MAX_UNITS } = require('./tron');

const token = new Interface(['function transfer(address,uint256) returns (bool)']);
const tron = new TronWeb({ fullHost: 'https://api.trongrid.io' });

function boundedSun(value, name) {
  if (!Number.isSafeInteger(value) || value < 1_000_000 || value > 200_000_000) throw new Error(`Invalid ${name}. Use an explicit limit between 1 and 200 TRX.`);
  return value;
}

function validateTransfer(transaction, { from, to, value, kind = 'usdt', feeLimit }, signed = true) {
  if (!transaction || !/^[a-f0-9]{64}$/.test(transaction.txID) || !utils.transaction.txCheck(transaction)) throw new Error('Transaction bytes do not match the transaction fields.');
  const raw = transaction.raw_data;
  const contracts = raw.contract;
  if (!Array.isArray(contracts) || contracts.length !== 1 || raw.data || raw.auths?.length) throw new Error('Unexpected transaction operations.');
  if (!Number.isSafeInteger(raw.timestamp) || !Number.isSafeInteger(raw.expiration)
    || raw.timestamp > Date.now() + 60_000 || raw.expiration <= raw.timestamp || raw.expiration - raw.timestamp > 600_000) throw new Error('Invalid transaction lifetime.');
  const contract = contracts[0];
  if (contract.Permission_id || contract.permission_id) throw new Error('Unexpected signing permission.');
  const parameters = contract.parameter?.value;
  if (parameters?.owner_address?.toLowerCase() !== addressHex(from)) throw new Error('Unexpected transaction sender.');
  if (kind === 'usdt') {
    boundedSun(feeLimit, 'fee limit');
    if (contract.type !== 'TriggerSmartContract' || parameters.contract_address?.toLowerCase() !== addressHex(USDT_CONTRACT)
      || (parameters.call_value || 0) !== 0 || (parameters.call_token_value || 0) !== 0 || (parameters.token_id || 0) !== 0
      || !Number.isSafeInteger(raw.fee_limit) || raw.fee_limit < 0 || raw.fee_limit > feeLimit) throw new Error('Unexpected token transaction or fee limit.');
    const decoded = token.parseTransaction({ data: '0x' + parameters.data });
    if (!decoded || decoded.name !== 'transfer' || decoded.args[0].slice(2).toLowerCase() !== addressHex(to).slice(2)
      || decoded.args[1] !== BigInt(value) || parameters.data.length !== 136) throw new Error('Unexpected token destination or amount.');
  } else {
    if (kind !== 'trx' || contract.type !== 'TransferContract' || parameters.to_address?.toLowerCase() !== addressHex(to)
      || !Number.isSafeInteger(parameters.amount) || BigInt(parameters.amount) !== BigInt(value) || raw.fee_limit) throw new Error('Unexpected TRX funding transaction.');
  }
  if (signed) {
    if (transaction.signature?.length !== 1 || !/^[a-fA-F0-9]{130}$/.test(transaction.signature[0])
      || utils.crypto.ecRecover(transaction.txID, transaction.signature[0]).toLowerCase() !== addressHex(from)) throw new Error('Transaction signer does not control the expected source.');
  } else if (transaction.signature?.length) throw new Error('Expected an unsigned transaction.');
  return transaction;
}

async function signTransfer(transaction, privateKey, expectation) {
  validateTransfer(transaction, expectation, false);
  const signed = await tron.trx.sign(transaction, privateKey, false, false);
  return validateTransfer(signed, expectation);
}

async function buildTokenTransfer(client, job, feeLimit) {
  boundedSun(feeLimit, 'fee limit');
  const value = BigInt(job.amount_units);
  if (value <= 0n || value > MAX_UNITS) throw new Error('Unsupported collection amount.');
  const data = token.encodeFunctionData('transfer', ['0x' + addressHex(job.treasury).slice(2), value]).slice(2);
  const result = await client.request('/wallet/triggersmartcontract', { owner_address: addressHex(job.address),
    contract_address: addressHex(USDT_CONTRACT), function_selector: 'transfer(address,uint256)',
    parameter: data.slice(8), fee_limit: feeLimit, call_value: 0, visible: false });
  if (result.result?.result !== true) throw new Error('Token transfer could not be constructed.');
  return validateTransfer(result.transaction, { from: job.address, to: job.treasury, value, feeLimit }, false);
}

async function buildTrxTransfer(client, from, to, value) {
  const transaction = await client.request('/wallet/createtransaction', { owner_address: addressHex(from),
    to_address: addressHex(to), amount: Number(value), visible: false });
  return validateTransfer(transaction, { from, to, value, kind: 'trx' }, false);
}

async function tokenBalance(client, address) {
  const result = await client.request('/walletsolidity/triggerconstantcontract', { owner_address: addressHex(address),
    contract_address: addressHex(USDT_CONTRACT), function_selector: 'balanceOf(address)',
    parameter: AbiCoder.defaultAbiCoder().encode(['address'], ['0x' + addressHex(address).slice(2)]).slice(2), visible: false });
  if (result.result?.result !== true || !/^[a-fA-F0-9]{64}$/.test(result.constant_result?.[0])) throw new Error('Invalid USDT balance response.');
  return BigInt('0x' + result.constant_result[0]);
}

async function trxBalance(client, address) {
  const result = await client.request('/walletsolidity/getaccount', { address: addressHex(address), visible: false });
  const balance = result.balance || 0;
  if (!Number.isSafeInteger(balance) || balance < 0 || (result.address && result.address.toLowerCase() !== addressHex(address))) throw new Error('Invalid TRX balance response.');
  return BigInt(balance);
}

async function broadcast(client, transaction) {
  if (transaction.raw_data.expiration <= Date.now()) throw new Error('SIGNED_TRANSACTION_EXPIRED');
  const response = await client.request('/wallet/broadcasttransaction', transaction);
  if (response.result !== true && response.code !== 'DUP_TRANSACTION_ERROR') throw new Error('BROADCAST_NOT_ACKNOWLEDGED');
}

module.exports = { boundedSun, validateTransfer, signTransfer, buildTokenTransfer, buildTrxTransfer, tokenBalance, trxBalance, broadcast };
