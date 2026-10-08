'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { HDNodeWallet, Mnemonic } = require('ethers');
const { BRANCH_PATH, deriveAddress, proofMessage, validateWallet } = require('./tron');

function defaultVaultFile(walletFile) {
  if (!process.env.LOCALAPPDATA) throw new Error('A Windows user profile is required for automatic wallet provisioning.');
  const scope = crypto.createHash('sha256').update(path.resolve(walletFile)).digest('hex').slice(0, 20);
  return path.join(process.env.LOCALAPPDATA, 'TaskMall', 'wallet-vault', `${scope}.vault`);
}

function dpapi(operation, bytes) {
  if (process.platform !== 'win32') throw new Error('Local automatic wallet provisioning requires Windows DPAPI. Deploy only the public wallet configuration to other hosts.');
  const code = `$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $entropy=[Text.Encoding]::UTF8.GetBytes('TaskMall TRON wallet v1'); $outputBytes=[Security.Cryptography.ProtectedData]::${operation}($inputBytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($outputBytes)); } catch { [Console]::Error.Write('Protected wallet operation failed.'); exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, stdio: 'pipe' });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Protected wallet operation timed out.')); }, 20_000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('Protected wallet process could not start.')); });
    child.on('close', exit => {
      clearTimeout(timer);
      if (exit !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(output)) return reject(new Error('Protected wallet operation failed.'));
      resolve(Buffer.from(output, 'base64'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}

const windowsProtection = { protect: bytes => dpapi('Protect', bytes), unprotect: bytes => dpapi('Unprotect', bytes) };

async function readVault(vaultFile, protector = windowsProtection) {
  const envelope = JSON.parse(await fs.readFile(vaultFile, 'utf8'));
  if (envelope.version !== 1 || envelope.protection !== 'windows-dpapi-current-user' || typeof envelope.sealed !== 'string') throw new Error('Invalid protected wallet envelope.');
  const bytes = await protector.unprotect(Buffer.from(envelope.sealed, 'base64'));
  try {
    const secret = JSON.parse(bytes.toString('utf8'));
    if (secret.version !== 1 || secret.branchPath !== BRANCH_PATH || !Mnemonic.isValidMnemonic(secret.mnemonic)) throw new Error('Invalid protected recovery data.');
    return secret;
  } finally { bytes.fill(0); }
}

async function provisionWallet({ walletFile, treasury, vaultFile, protector = windowsProtection, createMnemonic }) {
  vaultFile ||= defaultVaultFile(walletFile);
  let secret;
  let existingPublic;
  try { existingPublic = validateWallet(JSON.parse(await fs.readFile(walletFile, 'utf8')), treasury); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Existing public wallet configuration is invalid; it was not replaced.'); }
  try { secret = await readVault(vaultFile, protector); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (existingPublic) throw new Error('The existing deposit wallet vault is missing. Restore it; a new wallet was not created.');
    secret = { version: 1, branchPath: BRANCH_PATH, treasuryAddress: treasury,
      mnemonic: createMnemonic ? createMnemonic() : Mnemonic.fromEntropy(crypto.randomBytes(32)).phrase };
    const plaintext = Buffer.from(JSON.stringify(secret), 'utf8');
    let sealed;
    try { sealed = await protector.protect(plaintext); } finally { plaintext.fill(0); }
    const envelope = JSON.stringify({ version: 1, protection: 'windows-dpapi-current-user', sealed: sealed.toString('base64') });
    await fs.mkdir(path.dirname(vaultFile), { recursive: true });
    await fs.writeFile(vaultFile, envelope, { flag: 'wx', mode: 0o600 });
    // Verify recovery from the stored ciphertext before publishing any addresses.
    const recovered = await readVault(vaultFile, protector);
    if (recovered.mnemonic !== secret.mnemonic) throw new Error('Protected wallet recovery verification failed.');
    secret = recovered;
  }
  if (secret.treasuryAddress !== treasury) throw new Error('The protected wallet belongs to a different treasury.');
  const branch = HDNodeWallet.fromPhrase(secret.mnemonic, '', BRANCH_PATH);
  const xpub = branch.neuter().extendedKey;
  if (existingPublic && existingPublic.xpub !== xpub) throw new Error('The protected vault does not match the existing public wallet.');
  const backupFile = `${vaultFile}.backup`;
  try { await fs.access(backupFile); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(backupFile, await fs.readFile(vaultFile), { flag: 'wx', mode: 0o600 });
  }
  const backup = await readVault(backupFile, protector);
  if (backup.mnemonic !== secret.mnemonic || backup.treasuryAddress !== treasury) throw new Error('Protected wallet backup verification failed.');
  const publicData = { version: 1, network: 'tron-mainnet', branchPath: BRANCH_PATH, xpub,
    treasuryAddress: treasury, firstAddress: deriveAddress(xpub, 0),
    proof: await branch.deriveChild(0).signMessage(proofMessage(xpub, treasury)), createdAt: new Date().toISOString() };
  validateWallet(publicData, treasury);
  if (!existingPublic) {
    await fs.mkdir(path.dirname(walletFile), { recursive: true });
    await fs.writeFile(walletFile, JSON.stringify(publicData, null, 2), { flag: 'wx', mode: 0o600 });
  }
  return { publicWallet: existingPublic || publicData, vaultFile };
}

module.exports = { defaultVaultFile, provisionWallet, readVault, windowsProtection };
