# Automatic TRON Deposits

## Current State

USDT TRC20 deposit processing and automatic per-user addresses are implemented. The local Windows configuration uses `TRON_AUTO_WALLET=1`: starting the app provisions the protected deposit wallet without a setup page, customer action or backup form.

The supplied TronGrid API key is stored only in the ignored local `.env`. Read-only Mainnet connectivity succeeded. Rotate the chat-exposed key before public operation. Real Mainnet settlement with operator funds has not yet been tested; automated tests use isolated chain fixtures.

Local verification on 2026-10-07: automatic protected provisioning completed, the running service reported `deposits: ready`, and the public wallet configuration remained identical after restart. All removed setup routes returned 404. The original JSON database remained unchanged after SQLite import.

Manual withdrawal accounting and a separate local automatic collection worker are now implemented and fixture-tested. Local withdrawal requests are enabled at the operator's request with a 10 USDT gross minimum and explicit TronLink signing for every payout. Automatic collection remains disabled; recovery, reconciliation, operator-approved expense limits and a small real settlement rehearsal remain public launch requirements. USDT stays at customer addresses until a collection transaction is confirmed. The treasury address alone cannot sign from separate deposit addresses. See [PAYMENT_OPERATIONS.md](PAYMENT_OPERATIONS.md).

## Automatic Local Provisioning

Use Node.js 22.13 or newer (verified on 24.14). A domain is not needed locally.

```powershell
npm ci
npm start
npm run payments:check
```

- On the first local Windows start, the application generates a dedicated 256-bit BIP39 wallet with the local ethers library. No private wallet information is printed, sent to customers, placed in command arguments or stored as plaintext.
- It encrypts recovery data with Windows DPAPI CurrentUser. The vault is under `%LOCALAPPDATA%/TaskMall/wallet-vault/`, outside the repository and public directory. An encrypted recovery copy is created beside it.
- The application decrypts the stored ciphertext to verify recovery before publishing addresses. Subsequent starts recover the same wallet, never a new one.
- Only the public branch, derivation path, first public address and signed control proof are written to `config/tron-wallet-public.json`.
- Existing or corrupt wallets are not silently replaced. A missing/mismatched vault or failed recovery stops automatic provisioning rather than creating inaccessible deposit addresses.
- Customers automatically receive stable unique addresses after authentication and see only their address, QR code, TRC20 warning and explorer link. There is no wallet creation, seed, password or backup UI.
- The selected branch is `m/44'/195'/0'/0`; a customer's derivation index is recorded in SQLite.

DPAPI protection is tied to the Windows user profile. A copy of its ciphertext alone is not a portable disaster-recovery backup. Protect the Windows account and machine; code executing under that account can access the vault. Do not deploy this private vault to public hosting.

## Operator Backup

A private terminal-only tool can export a password-encrypted portable keystore:

```powershell
npm run wallet:backup
```

It accepts passwords without echo, verifies decryption before writing, refuses existing-file overwrite and never prints recovery words. Run it yourself in a private local terminal, never through the coding agent or automated logs. Keep the encrypted export offline and its password separately. This is not a page or a customer workflow.

The export contains recoverable HD data and path `m/44'/195'/0'/0/0`. Before accepting customer money, rehearse full recovery and reproduce an allocated address in the intended signing workflow. Do not assume importing a phrase under a different path produces the same address.

The automatic DPAPI recovery copy protects against some local file damage, not loss of the disk, Windows profile or credentials. A portable offline backup and a recovery rehearsal remain public-launch requirements.

## Deposit Processing

- SQLite transactions and unique constraints protect address allocation. Back up user-address mappings and derivation indices as well as wallet recovery data.
- There is no customer-controlled credit action. The monitor fetches confirmed official USDT history and solidified transaction receipts, requiring successful execution, the correct token contract, canonical transfer logs and solidified height.
- Each `(txid, log_index)` is credited once. Multiple transfers in one transaction are processed separately.
- Deposit identity, balanced journal entries and account state commit in one transaction. Failed credits roll back.
- USDT amounts and journal deltas use integer micro-units, with six decimals and a per-balance cap of 100 million USDT. API balances remain bounded numeric values for compatibility.
- Scanning uses pagination, persistent checkpoints, ten-minute overlaps, six-hour full backfills and paced requests. Errors pause new address issuance.
- Polling waits 30 seconds after each completed cycle; the visible frontend refreshes every 20 seconds. Confirmation, indexing, quotas and address count affect timing; there is no fixed settlement-time or zero-error guarantee.
- SQLite permits one writer process. Lease acquisition is serialized; a crashed lease can be reclaimed only when its PID is no longer running.

## Public Deployment Gates

- Set `TRON_AUTO_WALLET=0` for production. Deploy the verified public configuration and current database; leave recovery keys on the operator computer. Production refuses automatic private-key provisioning.
- Rotate the exposed API key and keep its replacement server-side.
- Run one app process on persistent local disk. Do not use network SQLite storage or a multi-process cluster. Larger deployments need reviewed database/indexing architecture.
- SQL mode imports existing `db.json` once, preserves it, then stores current state in `payments.sqlite`. Old JSON is not a current financial backup.
- Imported balances and opening journal entries are not evidence of actual reserve funds; reconcile them before public operation.
- Test consistent encrypted database backup/restore, including WAL. The seed does not restore user mappings; the database does not restore wallet keys.
- Complete a real withdrawal rehearsal using the implemented reservation, local operator authorization, manual TronLink signing and verified settlement before promising withdrawals.
- Verify signing access to the deposit addresses, collection and TRON resource funding. Budget account activation, Energy/Bandwidth and TRX costs.
- Complete legal, task-income, reserves and independent security reviews in `PRODUCTION_READINESS.md`.
- Public operation needs an always-on supervised server, HTTPS, secrets management, backups and monitoring. The local development server is not a public deployment.

## Verification

```powershell
npm run check
npm run test:api
npm run test:payments
npm run test:outgoing
npm run test:tronlink
npm run test:collections
npm run test:ui
npm audit
```

Payment tests use isolated mocked chain responses, never customer funds. They cover derivation, ownership proof, receipts, duplicate logs, multiple recipients, rollback, restart, balanced journals, paging, outages, fail-closed configuration, protected recovery and automatic provisioning with no setup page.

Latest results: 10 deposit/provisioning tests, 8 outgoing-payment tests, 5 TronLink operator tests, 5 collection-activation tests and 12 API tests passed; responsive UI checks passed across seven viewport sizes. Collection tests verify encrypted file recovery, budget rollover, backend caps, preserved retries and refusal to activate outside a private interactive terminal. TronLink tests use a simulated injected wallet and isolated chain responses to verify private sessions, CSRF, wrong account/network rejection, wallet cancellation, preserved signatures, fixed transaction identity, lost acknowledgements and verified settlement. They do not establish compatibility with your installed extension or real Mainnet sending. Outgoing tests also include offline signing, protected destinations, persisted retries, gas limits and verified failure release. Dependency audit reported no known vulnerabilities, which is not an independent security audit.

The screenshots in `artifacts/payments` show only public fixture addresses. After recovery/security checks, test an operator-authorized small Mainnet transfer. Never fund the public test mnemonic's fixture addresses. The entire platform is not yet production ready.

## Official References

- [TRON integration](https://developers.tron.network/docs/exchangewallet-integrate-with-the-tron-network)
- [TronGrid API keys](https://developers.tron.network/reference/select-network)
- [Microsoft ProtectedData / DPAPI](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata)
- [ethers HD wallets](https://docs.ethers.org/v6/api/wallet/)
