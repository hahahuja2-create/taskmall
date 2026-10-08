'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifiedOfflineCopy } = require('./offline-backup');

const digest = data => crypto.createHash('sha256').update(data).digest('hex');

function encryptedDocument(text) {
  try {
    if (Buffer.byteLength(text) < 1 || Buffer.byteLength(text) > 1_000_000) throw new Error('Invalid size.');
    const document = JSON.parse(text);
    const fields = (object, allowed) => object && typeof object === 'object' && !Array.isArray(object)
      && Object.keys(object).every(name => allowed.includes(name));
    if (!fields(document, ['address', 'id', 'version', 'Crypto', 'x-ethers']) || document.version !== 3
      || !fields(document.Crypto, ['cipher', 'cipherparams', 'ciphertext', 'kdf', 'kdfparams', 'mac'])
      || document.Crypto.cipher !== 'aes-128-ctr' || document.Crypto.kdf !== 'scrypt'
      || !fields(document.Crypto.cipherparams, ['iv']) || !/^[a-f0-9]{32}$/i.test(document.Crypto.cipherparams.iv)
      || !fields(document.Crypto.kdfparams, ['salt', 'n', 'dklen', 'p', 'r'])
      || !/^[a-f0-9]{64}$/i.test(document.Crypto.ciphertext) || !/^[a-f0-9]{64}$/i.test(document.Crypto.mac)
      || !fields(document['x-ethers'], ['client', 'gethFilename', 'path', 'locale', 'mnemonicCounter', 'mnemonicCiphertext', 'version'])
      || document['x-ethers'].version !== '0.1' || !/^[a-f0-9]{32}$/i.test(document['x-ethers'].mnemonicCounter)
      || !/^[a-f0-9]{32,64}$/i.test(document['x-ethers'].mnemonicCiphertext)) throw new Error('Not an encrypted TaskMall backup.');
    return text;
  } catch { throw new Error('ENCRYPTED_BACKUP_REQUIRED'); }
}

async function readEncryptedBackup(file) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size < 1 || info.size > 1_000_000) throw new Error('Invalid file.');
    return encryptedDocument(await fs.readFile(file, 'utf8'));
  } catch { throw new Error('ENCRYPTED_BACKUP_REQUIRED'); }
}

async function prepareIphoneExport(source, transferRoot) {
  const encrypted = await readEncryptedBackup(source);
  const folder = path.join(path.resolve(transferRoot), digest(path.resolve(source)).slice(0, 20));
  const outgoing = path.join(folder, 'To-iPhone');
  const incoming = path.join(folder, 'From-iPhone');
  const file = path.join(outgoing, 'TaskMall-recovery-' + digest(encrypted).slice(0, 12) + '.keystore.json');
  await fs.mkdir(outgoing, { recursive: true, mode: 0o700 });
  await fs.mkdir(incoming, { recursive: true, mode: 0o700 });
  try { await fs.writeFile(file, encrypted, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw new Error('IPHONE_EXPORT_FAILED');
    const info = await fs.lstat(file);
    if (!info.isFile() || await fs.readFile(file, 'utf8') !== encrypted) throw new Error('IPHONE_EXPORT_CONFLICT');
  }
  return { source: path.resolve(source), file, outgoing, incoming };
}

async function verifyIphoneReturn(transfer, returned) {
  if (typeof returned !== 'string' || !path.isAbsolute(returned)
    || path.resolve(returned).toLowerCase() === path.resolve(transfer.file).toLowerCase()) throw new Error('IPHONE_RETURN_NOT_VERIFIED');
  try {
    const encrypted = await verifiedOfflineCopy(transfer.source, returned);
    await verifiedOfflineCopy(transfer.file, returned);
    return encryptedDocument(encrypted);
  } catch { throw new Error('IPHONE_RETURN_NOT_VERIFIED'); }
}

async function findIphoneReturn(transfer) {
  const names = await fs.readdir(transfer.incoming);
  const matches = [];
  for (const name of names.filter(file => file.endsWith('.keystore.json'))) {
    const file = path.join(transfer.incoming, name);
    try { await verifyIphoneReturn(transfer, file); matches.push(file); }
    catch { /* A local filename alone is not a verified return copy. */ }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

module.exports = { encryptedDocument, readEncryptedBackup, prepareIphoneExport, verifyIphoneReturn, findIphoneReturn };
