# TaskMall

TaskMall provides separate desktop and mobile workspaces for tasks, VIP memberships, accounts, wallet records, team invitations, company information, and support.

## Run locally

Requires Node.js 22.13 or newer.

```powershell
npm ci
npm start
```

Open http://127.0.0.1:4173. Use `npm run dev` for automatic restarts.

## Membership rules

- Free VIP lasts 10 days from registration. VIP 1 through VIP 11 last 365 days.
- Free VIP begins at registration and pays 0.30 USDT per completed daily task.
- Paid memberships begin at purchase. An upgrade starts a new 365-day term.
- Existing accounts receive dates derived from their last recorded VIP purchase, or registration if no purchase remains in their history. Already expired memberships remain expired.
- An expired paid package can be purchased again at its full price. Active upgrades cost the price difference. Active packages cannot be downgraded or purchased twice.
- The daily reward is `roundToCents(price / (11 * 0.90))`. With the current 10% withdrawal fee, it takes approximately 11 completed daily tasks to equal the package price in net reward, with 10-12 days allowed for rounding.
- This is a reward schedule, not a guarantee of profit or payout. Missing a task, withdrawal minimums, network costs, payment availability, and settlement times can delay receipt of funds.
- There is one reward claim per account per UTC day, including days on which a package changes.
- Expired memberships cannot claim task rewards.
- VIP and task directories show every entry in scrollable lists without page-number navigation.
- Each task has an individual Georgian/English name, product photograph and review checklist. Photographs are local assets; their original sources and license are recorded in `public/assets/task-products/credits.json`.

| Plan | Price (USDT) | Daily reward (USDT) | Term |
| --- | ---: | ---: | ---: |
| Free VIP | 0 | 0.30 | 10 days |
| VIP 1 | 30 | 3.03 | 365 days |
| VIP 2 | 100 | 10.10 | 365 days |
| VIP 3 | 300 | 30.30 | 365 days |
| VIP 4 | 800 | 80.81 | 365 days |
| VIP 5 | 1,500 | 151.52 | 365 days |
| VIP 6 | 3,000 | 303.03 | 365 days |
| VIP 7 | 5,000 | 505.05 | 365 days |
| VIP 8 | 8,000 | 808.08 | 365 days |
| VIP 9 | 12,000 | 1,212.12 | 365 days |
| VIP 10 | 18,000 | 1,818.18 | 365 days |
| VIP 11 | 25,000 | 2,525.25 | 365 days |

## Payment availability

USDT TRC20 deposit processing is implemented behind `TRON_DEPOSITS_ENABLED=1` and transactional `TASKMALL_SQLITE=1` storage. The local Windows configuration automatically provisions and verifies a dedicated DPAPI-protected wallet on startup. Customers automatically obtain unique addresses without any wallet setup or backup page. Wallet recovery data stays encrypted outside the repository; only a signed public HD configuration is deployed. Confirmed official token logs are credited automatically and exactly once. The customer cannot credit an arbitrary amount using `/api/wallet/deposit`.

The operator's public TRON treasury address is recorded in `config/tron-payment-setup.json`. A signed public deposit-wallet configuration is generated separately. Without it, deposits remain unavailable. Withdrawal reservation, a private TronLink operator workspace, signed-transaction persistence before broadcast and verified settlement are implemented. Local withdrawal requests are enabled at the operator's request, with a minimum gross amount of 10 USDT (9 USDT net after the existing 10% fee). Every payment still requires operator review and explicit TronLink signing; enabling requests does not send funds. Open the workspace from your private Windows terminal with `npm run payments:desk`; the treasury key stays in TronLink. A separate local collection signer and bounded automatic TRX funding are implemented. `npm run collections:enable` provides guided private startup: create an encrypted backup if missing, verify recovery from that file, check fuel and caps, then require your exact treasury confirmation before starting the worker. No collector is currently running; recovery, balance reconciliation and a real settlement rehearsal remain public launch requirements. No Mainnet funds have been sent by this agent. See [PAYMENT_OPERATIONS.md](PAYMENT_OPERATIONS.md) and [TRON_PAYMENT_SETUP.md](TRON_PAYMENT_SETUP.md).

Only isolated automated tests can enable fixture funding through `NODE_ENV=test`, `TASKMALL_TEST_WALLET=1`, and a separate `TASKMALL_DATA_DIR`. Enabling this outside that configuration prevents startup. This must never be configured for a live deployment.

For a preparation-only operator window, double-click `scripts/payments-prepare.cmd`. It guides private password entry and verifies a local encrypted backup without starting transfers or falsely marking an offline backup ready. The equivalent command is `npm run collections:prepare-local`. When you have a USB flash drive, use `scripts/payments-backup-usb.cmd` or `npm run collections:prepare` to copy and verify the encrypted backup on separate storage. The backup password and recovery file must never be sent in chat. See the operator guide before funding the dedicated TRX account or starting automatic collection.

USB is not the only backup medium. `scripts/payments-backup-iphone.cmd` / `npm run wallet:iphone` verifies the existing backup password privately, stages only encrypted bytes outside public assets, guides an Apple File Sharing transfer, and checks an independent file saved back from the iPhone. It verifies exact bytes and wallet recovery, not the physical location of a file: the operator must confirm its local availability on the protected phone. This tool never starts a signer, changes sending settings or treats a phone as a cold hardware wallet. An actual iPhone transfer still requires a data cable, an Apple file-transfer application and a trusted compatible iPhone app. Do not remove that app or its backup file.

An interrupted iPhone check can continue with `scripts/payments-verify-iphone.cmd` / `npm run wallet:iphone-verify`. This privately revalidates the existing password, recreates missing encrypted staging without replacing conflicts, and checks the already returned independent file. It does not repeat phone transfer, relax integrity checks, authorize collection or turn a local file move into proof of phone storage.

iPhone checks use a private Windows password dialog, masked by default with an optional local visibility checkbox. Enter the original encrypted backup password, not a TaskMall login, Windows password or phone passcode. Unlock failures allow up to three user-entered attempts and use sanitized statuses; passwords never enter command arguments, environment variables, files or logs. Select the returned file inside the tool's file picker, not by opening the JSON in Explorer.

If a backup password was shared, use **TaskMall Secure Backup** / `scripts/payments-secure-backup.cmd` / `npm run wallet:secure-backup`. A single masked form accepts and confirms a new password, then the tool re-encrypts the existing protected wallet, guides a NEW iPhone copy and return check, and only after successful recovery and phone-storage confirmation replaces the active encrypted backup. It preserves the previous encrypted file privately, refuses conflicts or concurrent source changes, never changes deposit addresses, and never starts payments. Older copies still use their original password: changing encryption does not revoke already distributed copies. No seed or shared password is needed by the coding agent.

An interrupted password-change flow resumes with **TaskMall Finish Phone Backup** / `scripts/payments-finish-backup.cmd` / `npm run wallet:finish-backup`. It requires exactly one existing encrypted pending candidate, asks for the SAME NEW password privately, and can use a single already returned, independently matching copy. It never generates another backup or repeats phone transfer. Phone storage and separate password custody must still be confirmed explicitly in a dedicated dialog by checking both statements and typing `IPHONE`. Matching bytes alone do not prove physical phone storage. Nothing is typed as a password into the black status terminal.

Private password and phone dialogs have a 30-minute timeout. A private GUI visibility timer restores only the intended dialog owned by the helper process after its modal message loop starts; tests assert OS-level modal window visibility under hidden launch, not just constructed controls. The desktop finish shortcut opens through the user's shell so its private window remains independent of an agent command session.

Production mode requires `NODE_ENV=production` and an HTTPS `PUBLIC_ORIGIN`. TLS must terminate at a trusted reverse proxy. These settings enable Secure session cookies and HSTS; they do not make the application ready for handling real funds. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for launch blockers. The environment template can be loaded with Node's `--env-file` option after configuring a real domain.

## Data

Railway MySQL storage is available through `MYSQL_URL`. It persists normalized
accounts, wallets, memberships, tasks, sessions and the payment ledger in
transactional InnoDB tables. See [MYSQL_DEPLOYMENT.md](MYSQL_DEPLOYMENT.md) for
migrations, private Railway connection variables, the single-writer limit,
credential rotation, and the required financial cutover. Existing local SQLite
data is not silently imported or replaced.

`TASKMALL_DATA_DIR` selects the data directory. With `TASKMALL_SQLITE=1`, application state, deposit mappings, transfer identities and balance journals are stored in `payments.sqlite` using WAL and FULL synchronous transactions. Existing `db.json` is imported once and left unchanged; it is no longer the current state in SQL mode. Back up and restore SQLite consistently, including its active WAL, rather than using an outdated JSON snapshot. Only one application writer process may run against that directory. Imported balances still require reconciliation with real funds.

Without the SQLite flag, previous JSON storage is retained for compatibility and isolated tests; it cannot enable real deposits. Invalid stored data stops startup instead of being overwritten. A persistence failure stops further mutation requests.

## Verification

```powershell
npx playwright install chromium
npm run check
npm run test:api
npm run test:payments
npm run test:outgoing
npm run test:tronlink
npm run test:collections
npm run test:iphone-backup
npm run test:backup-rotation
npm run test:ui
npm audit
```

API tests cover membership migration, rates, expiry, renewals, concurrent claims, payment restrictions, malformed input, origin checks, and production cookies. UI tests use temporary data and verify desktop/mobile pages, authentication, wallet controls, VIP purchases, CSV, search, sorting, and profile updates. Screenshots are written to `artifacts/ui`.

The headquarters image is a generated brand concept, not a photograph of an established company office. It must not be represented as evidence of company premises.
