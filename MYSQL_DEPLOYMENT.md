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

Retain a persistent volume for the public deposit-wallet configuration and
operator token. MySQL does not provision a wallet, replace a signer, or enable
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

The local preparation connection pins the CA observed at the supplied endpoint
on first contact. Its authenticity has not been independently verified against
the Railway database container. Do not confuse first-contact pinning with that
verification. Check the CA against the server's `ca.pem` through an authenticated
Railway session before continuing to rely on the public proxy. The agent did not
send a database password during certificate inspection. Credentials and the
observed CA stay in ignored local files; the credential file has a restricted
Windows ACL.

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
