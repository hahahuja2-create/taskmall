'use strict';

const fs = require('node:fs/promises');
const { validateWallet } = require('./tron');

const publicFields = new Set(['version', 'network', 'branchPath', 'xpub', 'treasuryAddress', 'firstAddress', 'proof', 'createdAt', 'fingerprint']);

async function loadPublicWallet({ walletFile, walletJson, treasury }) {
  const raw = walletJson || await fs.readFile(walletFile, 'utf8');
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 32_768) throw new Error();
    const config = JSON.parse(raw);
    if (!config || Array.isArray(config) || Object.keys(config).some(key => !publicFields.has(key))) throw new Error();
    return validateWallet(config, treasury);
  } catch {
    // Never include a supplied configuration or key in errors.
    throw new Error('Invalid public deposit wallet configuration.');
  }
}

module.exports = { loadPublicWallet };
