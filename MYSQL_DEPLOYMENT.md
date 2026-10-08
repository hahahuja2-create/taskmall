# TaskMall MySQL Deployment

## Storage

The application selects MySQL when `MYSQL_URL` (or a MySQL `DATABASE_URL`) is set.
Otherwise the existing SQLite/JSON behavior is preserved. MySQL connection or
validation failures never fall back to another database.

Use MySQL 8.0.16+ with InnoDB, `utf8mb4` and database collation
`utf8mb4_0900_ai_ci`. Migrations validate the collation before changing schema.
Financial amounts are integer micro-USDT in `DECIMAL(30,0)`, not SQL floats.
TRON addresses and idempotency keys use case-sensitive ASCII columns.

The schema includes users, wallets, memberships, VIP plans, tasks, activities,
daily task completions, persistent hashed sessions, deposit addresses, deposits,
withdrawals, collections, outgoing transactions, payout intents, payment audit,
balanced journals, settings, application state and migration history.

The compatibility state snapshot and normalized tables are updated in the same
transaction. Account removal is rejected. Unique transfer identities prevent
deposit replays; request keys prevent duplicate withdrawal reservations. The
existing chain validation and signing controls are unchanged.

## Railway

In the **TaskMall application service**, add a reference variable:

```text
MYSQL_URL=${{MySQL.MYSQL_URL}}
```

Replace `MySQL` with the actual database service name. Use the private/internal
URL, not the public TCP proxy URL. Keep `NODE_ENV=production` and the real HTTPS
`PUBLIC_ORIGIN`. The server binds to `0.0.0.0` in production unless `HOST` is set.
Do not set `HOST=127.0.0.1` in Railway. Railway supplies `PORT`.

Run migrations using `npm run db:migrate`; they are also checked/applied during
startup. Migrations are checksummed and serialized with a database advisory lock.
DDL is restartable, but MySQL DDL is not transactionally rolled back as a group.
The migration command seeds only the 12 VIP plans and 12 product tasks. It does
not import customers, allocate addresses, credit money, or send transactions.

Run exactly **one application replica**. The application still caches the state
of all users, so a connection-bound advisory writer lock rejects a second writer.
It is not horizontally scalable. Stop the previous instance before replacing it;
overlapping zero-downtime deployments are incompatible with this writer model.
A graceful stop releases the lock; a disconnected MySQL connection also loses
the lock and the application fails closed instead of reconnecting blindly.

Retain a persistent volume for the operator token, or configure
`TASKMALL_OPERATOR_TOKEN` as a protected service variable (43 base64url characters).
The server recreates its private token file with that exact credential; a
conflicting file stops startup rather than silently replacing credentials.
The signed public deposit
configuration can be mounted using `TRON_WALLET_PUBLIC_FILE`, or supplied as the
`TRON_WALLET_PUBLIC_JSON` service variable. JSON takes precedence and must contain
only the original signed public configuration; invalid input never falls back
to a different wallet. Set `TRON_AUTO_WALLET=0` on the web host.

Deposit readiness requires `TRON_DEPOSITS_ENABLED=1`, a server-side
`TRONGRID_API_KEY`, that verified public configuration, transactional storage and
a successful chain scan. Withdrawal admission additionally requires
`TASKMALL_OPERATOR_ENABLED=1`, a protected persistent operator token and
`TRON_MANUAL_WITHDRAWALS_ENABLED=1`. Enabling admission only reserves requests;
it does not send funds. Operator endpoints remain loopback-only. A private
tunnel/access path and a payout rehearsal are still required from Railway.
Check `/api/payment-config` on the actual deployment, not just local settings.

MySQL does not provision a wallet, replace a signer, or enable
Mainnet withdrawals/collection. Never deploy the mnemonic, private key, Windows
vault, backup file, or backup password to the public web service.

## Credentials And TLS

The root connection supplied in chat is not committed. Rotate that exposed
password in Railway and update dependent services. Use a separate application
account rather than root. The current automatic startup migrations require DDL
privileges as well as data privileges; a separate migration identity and
read/write-only runtime identity remain a hardening step before public launch.

Public MySQL connections require TLS. Provide `MYSQL_SSL_CA` as the PEM CA in a
secret variable, or `MYSQL_SSL_CA_FILE` as an external file. Without a supplied
CA, the public connection verifies both normal CA trust and hostname identity.
With a specific self-signed MySQL CA, it verifies that certificate chain
(VERIFY_CA); auto-generated MySQL certificates do not identify the proxy hostname.
Private `.railway.internal` connections use Railway private networking.

The local preparation connection originally pinned the observed CA on first
contact. Its SHA-256 fingerprint was subsequently compared with
`/var/lib/mysql/ca.pem` through an authenticated Railway SSH session and matched.
Repeat that check when replacing the database or CA. Credentials and the CA stay
in ignored local files; the credential file has a restricted Windows ACL.

## Existing Data And Launch Gates

The existing local SQLite database was not imported. `db.json` is a stale
snapshot after SQLite activation and must not be used as the financial source.
For cutover, pause requests and deposit/settlement watchers, make a consistent
SQLite backup, migrate all state, address indexes, wallet fingerprint, receipts,
withdrawal reservations, signed outgoing bytes, payout intents, audits and
journals, then reconcile balances before resuming. Do not run two independent
live ledgers for the same deposit wallet. Startup refuses an automatic import
into empty MySQL when existing local data is present.

Database creation is not proof of production readiness. Backups with a tested
restore, least-privilege credentials, externally monitored health, an explicit
cutover, operator access from the deployment, protected wallet recovery and a
user-authorized real deposit/payout rehearsal still need verification. Current
reward obligations also require funding/reconciliation; schema cannot supply it.

The restricted `payments/deployment-cutover.js` helper supports only an unfunded
source with free memberships, welcome activity and an empty payment journal.
It preserves account identities and password hashes in one MySQL transaction,
requires an empty target, binds a checksummed import marker to the wallet and
reserved address range, and refuses conflicting retries. It is not a general
financial migration tool and rejects any earned or funded balances.

A reviewed `deposit_index_start` setting reserves previously issued address
indexes. The retired local ledger must be stopped, backed up and marked with
`deposit_allocation_retired` before the primary deployment can issue later
indexes. Retired mappings are retained, not reassigned to new owners. Do not
resume the old application as an independent payment ledger. Its records and
any later deposits to a retired address require operator reconciliation.

## Verification

```powershell
npm run test:mysql
```

This runs configuration tests and skips real-server integration by default.
For an authorized administrator connection, set `TASKMALL_MYSQL_INTEGRATION=1`
and provide the URL/TLS configuration privately before running the test. It
creates a uniquely named `taskmall_test_*` database and drops only that exact
owned database after testing. Fixtures never enter the configured application
database. Tests cover atomic credit/rollback, exact micro-units, replay,
withdrawal reservation/settlement, writer exclusion, hashed sessions, account
retention and HTTP authentication/reward persistence through restart. They do
not use Mainnet RPC, broadcast transactions, or prove real payment settlement.
