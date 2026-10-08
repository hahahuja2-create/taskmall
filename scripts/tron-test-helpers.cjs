'use strict';

const { utils } = require('tronweb');
const { Interface } = require('ethers');
const { USDT_CONTRACT, addressHex } = require('../payments/tron');
const abi = new Interface(['function transfer(address,uint256) returns (bool)']);

function unsignedToken({ from, to, value, feeLimit, timestamp = Date.now(), expiration = timestamp + 600_000 }) {
  const transaction = { visible: false, raw_data: { ref_block_bytes: '1234', ref_block_hash: '0011223344556677', timestamp, expiration,
    fee_limit: feeLimit, contract: [{ type: 'TriggerSmartContract', parameter: { type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
      value: { owner_address: addressHex(from), contract_address: addressHex(USDT_CONTRACT), call_value: 0,
        data: abi.encodeFunctionData('transfer', ['0x' + addressHex(to).slice(2), BigInt(value)]).slice(2) } } }] } };
  const pb = utils.transaction.txJsonToPb(transaction);
  transaction.raw_data_hex = utils.transaction.txPbToRawDataHex(pb);
  transaction.txID = utils.transaction.txPbToTxID(pb).replace(/^0x/, '');
  return transaction;
}

module.exports = { unsignedToken };
