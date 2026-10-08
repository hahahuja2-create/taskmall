# Payment Operations

Updated: 2026-10-08. Code is implemented and tested with isolated fixtures; real Mainnet settlement has not been rehearsed. Do not promise error-free processing or enable public customer funding before the launch gates are satisfied.

## No Keys In Chat

- Never send a seed, private key, backup password or encrypted recovery file to the coding agent.
- The main treasury wallet stays in your TronLink. This application does not need its private key because you sign withdrawals manually.
- The dedicated deposit wallet is already protected locally by Windows DPAPI. The collection worker reads it locally, checks that it matches the public HD configuration, and never prints recovery data.
- Only public configuration and the financial database belong on the web host. Do not deploy the vault, signer journal or recovery exports there. The current local Windows web process shares your user profile; DPAPI does not protect against malicious code running as you.

## Money Flow

Deposits: customer -> allocated TRC20 address -> solidified official USDT receipt -> customer VIP balance. Collection: that allocated address -> configured treasury. Collection does not credit the customer again.

Withdrawals: customer request with account-password confirmation -> exact gross amount reserved -> operator review/approval -> pinned unsigned transaction -> operator confirmation in TronLink -> validated signed bytes recorded before broadcast -> verified official USDT transfer from treasury to that customer -> confirmed payout and totals. No key is requested in the web interface.

The minimum new withdrawal request is 10 USDT gross, enforced by the API and transactional ledger and supplied to the customer form by payment configuration. The application withdrawal fee is 10%, rounded to a micro-unit: a 10 USDT request pays 9 USDT net. Network resource costs are separate. A txid or a successful broadcast is not a confirmed payment. A transaction cannot pay two requests in this implementation; batching withdrawals is intentionally not supported. Existing requests are not rewritten when the minimum changes.

## Local Operator Access

`TASKMALL_OPERATOR_ENABLED=1` creates a separate random credential file outside public assets. The local file is `data/operator.token`, ignored by version control. Commands read it without printing it. Operator APIs require both this credential and a loopback peer; a customer session never grants operator authority.

Block BOTH `/api/operator/*` and `/operator/*` (including the bare `/operator` path) at the public reverse proxy and expose the Node port only privately. On a remote host, use a private SSH loopback tunnel for operator access. Never put the long-term operator token in a browser, URL, screenshot or chat.

Open the private payment workspace from your own interactive Windows terminal:

```powershell
npm run payments:desk
```

The launcher reads the local credential without printing it, opens your default browser using a one-use 60-second grant in the URL fragment, immediately removes that fragment and exchanges the grant for a host-bound 15-minute HttpOnly, SameSite=Strict cookie. Cookies are scoped to `/operator/`; mutation requests also require an Origin check and a CSRF token. Restarting the server invalidates operator sessions. The long-term credential never reaches the browser. Use a dedicated trusted browser profile with TronLink installed; a malicious extension or same-origin script can still attack an active operator session.

```powershell
npm run payments:operator -- withdrawals list
npm run payments:operator -- collections list
npm run collections
```

The last command is read-only: no vault decryption, signing, funding or broadcast.

## Manual Withdrawals

Local request admission has been enabled at the operator's explicit request with `TRON_MANUAL_WITHDRAWALS_ENABLED=1`. This only opens the request and manually signed payout workflow; there is no automatic payout sender. Storage, operator authentication and deposit-monitor readiness still gate admission, and preparation checks the treasury's confirmed USDT and TRX reserve. Public hosting defaults to disabled in `.env.example`: reconcile existing balances and rehearse a small operator-owned withdrawal before opening public financial service. The collection worker and its recovery flags remain disabled and unchanged.

### TronLink Confirmation Flow

1. Open `npm run payments:desk`. Connect TronLink to the configured treasury account on TRON Mainnet. The initial wallet authorization is separate from approving a transfer; no transfer prompt is sent merely because a customer requested a withdrawal.
2. Review the recipient and exact NET amount. Approve the request only after checking the reserved balance and underlying funding.
3. Enter an explicit maximum network fee in TRX and prepare the transaction. The interface accepts a cap of 1 to 200 TRX, not an estimate or recommendation. Preparation conservatively checks confirmed USDT and the cap plus 1 TRX as a fallback reserve; delegated resources are not estimated. The browser's wallet node must be `https://api.trongrid.io`, with its genesis chain ID verified as Mainnet. Other custom nodes fail closed.
4. Review the fixed recipient, amount, network fee cap and transaction hash, then click **Sign and send with TronLink**. TronLink opens its own confirmation window. Only you confirm there. This is an official USDT `transfer`, not a token allowance, account permission change or seed import.
5. The server validates the exact prepared bytes, hash, treasury signature, contract, destination, amount, fee and lifetime, then stores the signed transaction before any broadcast. Only the user-driven send endpoint broadcasts it. There is no automatic payout signer or background payout sender.
6. A successful broadcast is shown as awaiting confirmation. The settlement watcher verifies a solidified official USDT transfer before releasing the reservation and recording a confirmed payment.

The unsigned intent is persisted before it is exposed to the wallet and cannot be replaced automatically. Wallet rejection can retry the same unexpired transaction. A lost acknowledgement can retry only the already stored signed bytes, never a new transfer. A failed signature upload is retained in browser memory for a retry while that page remains open. If the browser closes, the original intent still fixes the transaction identity; check TronLink history before further action. Expired intents or unresolved signed outcomes are held for incident review, not automatically refunded or replaced. There is no automatic expired-intent recovery workflow yet.

The workspace lists the latest 200 requests; its metrics cover that list, not lifetime accounting. High-volume queue pagination and independent reserve reports remain deployment work. Never also send a manually entered transfer for a request that already has a prepared intent: the server refuses a different transaction identity for that request.

### Separate Manual Entry

The old terminal workflow remains available for requests that have NOT been prepared through the browser:

```powershell
npm run payments:operator -- withdrawals approve REQUEST_ID
# In TronLink, check the exact destination and NET amount displayed above. Send once.
npm run payments:operator -- withdrawals record REQUEST_ID TXID
npm run payments:operator -- withdrawals list
```

Approve/record/reject commands require your private interactive terminal and explicit confirmation. They never sign or send withdrawals. A requested withdrawal can be rejected once, restoring its reservation. An approved or submitted withdrawal cannot be blindly rejected because it may already have been sent outside this app.

If the recorded transfer has definitively FAILED in a solidified block, this command rechecks the chain before releasing the reservation:

```powershell
npm run payments:operator -- withdrawals release-failed REQUEST_ID
```

An absent, expired, successful, mismatched or merely unconfirmed transaction cannot release funds this way. Wrong hashes, incorrect amounts and unknown signing outcomes require an incident review, not another blind payment. Check TronLink history for any unrecorded transfer before acting.

## Automatic Collection

Collection uses a separate operator-computer worker, not the public web server. It can send official USDT only from an allocated address derived from the verified public wallet, only to the configured treasury, and only for the amount already credited and not yet collected.

The worker validates the protobuf bytes, transaction hash, owner, official token contract, transfer destination, amount, fee cap, lifetime and signature. Signed bytes are saved in the financial database before broadcast; retries resend the same transaction instead of creating another.

### Guided Local Startup

### iPhone Instead Of USB

A USB flash drive is a backup option, not a protocol requirement. A separate trusted, passcode-protected iPhone may hold the encrypted file locally. A phone in everyday network use is not a cold hardware wallet; independently review this backup arrangement before public launch. Keep the password separately and do not upload the backup into chat, email or a message service.

Double-click the local **TaskMall iPhone Backup** shortcut or `scripts/payments-backup-iphone.cmd`:

```powershell
npm run wallet:iphone
```

The preparation-only command requires your private Windows terminal and existing backup password. It verifies that the encrypted file restores the current deposit branch before staging a byte-identical copy under the local vault's `iphone-transfer` directory, outside the website and repository. No plaintext seed, private key, password or application API credential reaches the native copy helper. Conflicting export files are never overwritten. The command does not read the DPAPI root, call payment APIs, start a signer or change sending/recovery flags.

Connect and unlock the iPhone using a data cable and confirm Trust if prompted. Apple's current Windows guidance uses **Apple Devices > Files**; existing iTunes also has **File Sharing**. Select a trusted compatible phone app that can store `.json` files locally; apps limited to media/documents may not accept the keystore. Do not erase or restore the iPhone, enable unrelated sync operations, or install arbitrary file-sharing apps just to satisfy this check. If no compatible app is listed, stop and choose a trusted transfer method first. Apple documents both [Apple Devices](https://support.apple.com/en-us/120402) and [iTunes File Sharing](https://support.apple.com/en-us/120403). Apple recommends [Microsoft Store](https://support.apple.com/guide/devices-windows/install-the-apple-devices-app-mchl5ded2763/windows) for installing Apple Devices on current Windows systems; the helper does not install or update software.

Add the encrypted file from `To-iPhone`. Confirm that it remains available locally on the phone, not only in a cloud account or message. Save the phone's file BACK into `From-iPhone`, leave the original phone copy in place, and select the returned file in the private picker. The tool rejects the source file, staged original and hard-link aliases, compares SHA-256 against both the source and export, then verifies a fresh password-based recovery of the returned bytes. Changes to either original fail closed.

Finally confirm the phone storage yourself with the literal `IPHONE`. A byte comparison cannot prove which physical device a file visited; this step is an operator attestation, not automatic device verification. Ensure the file is accessible without the PC or cloud (after disconnecting, with the phone offline), protect the phone, and do not delete its storage app. Apple warns that deleting a file-sharing app can also remove its shared files. An iCloud-only listing is not an offline backup. Success prints `IPHONE_RETURNED_BACKUP_VERIFIED`; it does NOT enable collection or replace the private collection startup checks. A real phone round trip, separate financial-database/signer-journal restoration, fuel and Mainnet settlement still require human verification.

If the dialog was cancelled, timed out or the staged `To-iPhone` copy was moved, use **TaskMall Verify iPhone Backup** / `scripts/payments-verify-iphone.cmd` or `npm run wallet:iphone-verify`. This requires the private terminal and the existing password again, revalidates recovery, recreates a missing encrypted staging copy without replacing conflicting files, and opens the picker directly at the existing returned copies. It does not repeat the phone transfer or modify the source/returned file. Verification still rejects altered bytes, aliases and the staged original, and still requires the operator to confirm actual independent phone storage. A local file move alone is NOT a phone backup. Cancel/timeout/dialog failures now have separate sanitized statuses rather than all being reported as a bad file. This tool never authorizes financial sending.

The iPhone-only password dialog is masked by default. Its optional visibility checkbox reveals input only locally; never share a screenshot with it enabled. Use the original encrypted backup password, not any account password or phone passcode. A private child-process pipe returns input to the local verifier; command arguments, environment variables, files and logs do not contain the password. `BACKUP_PASSWORD_NOT_ACCEPTED` means the entered password did not unlock the file (an incorrect password or damaged encrypted data); `BACKUP_WALLET_MISMATCH` means decrypted recovery data does not match the existing deposit wallet. No new root or backup is created to bypass either failure. Up to three attempts require explicit user input; the tool does not guess passwords. Close any Windows "Open with" dialog: the keystore is selected in the verifier's own file picker, not opened in an editor.

### Shared Backup Password

Treat any chat-shared password as exposed. **TaskMall Secure Backup** (`scripts/payments-secure-backup.cmd` / `npm run wallet:secure-backup`) requires a private Windows terminal, offers a single masked new-password/confirmation form, and accepts at least 20 characters including letters. It uses the existing DPAPI-protected root, checks its treasury and deposit branch against the existing public configuration, encrypts a separate pending candidate, and rehearses recovery before exporting it. The secret stays in the user-controlled process: the old shared password is not requested, used or stored.

The candidate must be copied to the phone and returned through the existing strict byte/recovery verifier. Actual phone storage still requires operator confirmation. The active backup remains unchanged on cancellation, wrong copies, recovery failure or a changed public configuration/source. Only after these checks does a locked replacement preserve a byte-identical rollback archive, flush the new ciphertext and rename it over the active encrypted backup. Pending/previous backups are not silently deleted. No wallet root, customer address, treasury, `.env` setting, recovery authorization or payment worker is changed. Old encrypted copies are not revoked by changing the password; keep them private and securely retire them only after independently verifying the new recovery arrangement. If recovery data itself was exposed, password rotation alone is insufficient.

After interruption, **TaskMall Finish Phone Backup** (`scripts/payments-finish-backup.cmd` / `npm run wallet:finish-backup`) preserves and reuses the single existing pending ciphertext. Zero or multiple candidates stop rather than guessing. The same new password is entered once in the separate masked form; no DPAPI root read, new encryption or repeat transfer is performed in resume mode. A single matching independent file already in that candidate's `From-iPhone` folder can be selected automatically; otherwise a private file picker opens. Exact bytes and fresh wallet recovery still precede any replacement. Phone custody is explicitly attested in a separate GUI with two unchecked statements plus the exact `IPHONE` keyword; fields are never prefilled or confirmed by the agent. The returned/source bytes are checked again after attestation, and the active backup and public configuration are checked for changes before commit. This local backup operation never authorizes financial sending.

All private password/phone dialogs allow 30 minutes before timeout, with cancellation available. Their shared modal GUI wrapper starts a timer that checks only the intended title and current helper process and restores a hidden dialog after its message loop starts. Passwords still travel only through the local private pipe. Tests check actual modal OS visibility under hidden child-process launch and require both phone-storage attestations plus the exact keyword. No agent tool reads live input fields or screenshots a populated private dialog.

### Local And USB Preparation

For preparation without any signing or transfer, double-click `scripts/payments-prepare.cmd` (or the local **TaskMall Payment Setup** desktop shortcut). The coding agent may open this preparation-only window, but never enters your password or starts the financial worker. Press a key when you are ready, enter a new password twice in the hidden local input, then enter the password again for recovery verification. This first step requires no USB: it creates and verifies ONLY the local encrypted backup. It explicitly leaves offline-copy verification pending, does not authorize sending, and can never be combined with `--run`. It does not substitute for a separate offline backup or protect against loss of this disk.

```powershell
npm run collections:prepare-local
```

When separate removable storage is available, double-click `scripts/payments-backup-usb.cmd` (or the local **TaskMall USB Backup** shortcut), choose a folder on an inserted USB flash drive, then enter the password for recovery verification. The USB helper accepts only ready removable storage, rejects directory links, writes a new file without overwriting an existing backup, and compares SHA-256. Node independently verifies the copy and checks recovery from those copied bytes. The helper receives only the encrypted-file path, not its password or plaintext keys. It does not receive the web application's API credentials. Disconnect the USB after verification and keep it secure, separately from the password.

```powershell
npm run collections:prepare
```

This command is preparation-only: it may create an encrypted backup, copy it to your selected USB and read confirmed balances. It never signs, plans, funds, broadcasts or starts collection, even if all checks pass. Without a USB flash drive, the USB shortcut cannot complete offline recovery; local preparation remains available. Some external drives report as fixed disks; use a removable USB flash drive or the existing private manual-copy workflow instead. Missing fuel stops the USB/full preparation with `GAS_WALLET_REQUIRES_TRX`, without any financial activity. Local-only preparation reports the balance but keeps offline recovery and funding as unresolved gates. Cancelled or failed copies do not enable sending; any incomplete encrypted copy should be investigated privately, never sent in chat. A CLI flag typo also fails closed before credentials are read.

```powershell
npm run collections:enable
```

Run this yourself in a private Windows terminal, never through the coding agent. It is not a read-only command: after your treasury confirmation it starts automatic signing and transfers. It does not add any customer-facing setup page or ask for the main TronLink key.

The command checks the backend treasury and fee cap, creates a portable encrypted backup when missing, asks you to store an offline copy and verifies a fresh decrypt of the saved file. The recovered deposit branch must match the current public configuration; the recovered TRX fuel account must match the protected local wallet. Password entry is hidden. Verification does not send the seed, password or file anywhere, and never substitutes a new wallet.

The local rehearsal caps are 20 TRX of Energy per collection, 40 TRX of daily Energy reservations and 50 TRX of daily TRX funding reservations. These are limited startup settings, not a fee estimate, universal recommendation, or guarantee that a transfer will succeed. Actual USDT costs depend on the network and account resources. Energy caps do not include Bandwidth; conservative local fuel reserves are separate. With the default caps, a newly empty allocated address has a 21 TRX fallback target and the funding budget reserves a further 2 TRX. Unused TRX remains controlled by the protected wallet. The two budgets overlap economically and must not be summed as an actual expense report.

The dedicated fuel account needs at least the selected cap plus 3 TRX (23 TRX with these defaults) for initial conservative funding. This is a startup reserve, not an instruction to pay a fixed network fee. If it is empty, the tool prints its public TRX-only address and stops before any signature or transfer. After recovery verification, fund it yourself using TronLink, then rerun the command. The tool still requires your full treasury address to approve the displayed caps and automatic transfers.

The guided command authorizes only that interactive worker session; it does not persist `TRON_COLLECTION_SEND=1` or silently claim `TRON_RECOVERY_VERIFIED=1` in `.env`. `npm run payments:check` reports an active worker separately using a local heartbeat plus a process check, and identifies whether recovery was verified for that run. The heartbeat is informational, not an authorization gate. Ctrl+C stops new broadcasts; already broadcast transactions cannot be undone. Keep this private terminal and the web server running. Windows startup/service automation is not configured.

Before enabling sending:

1. Run `npm run wallet:backup` yourself in a private terminal. Store the portable encrypted backup offline, separately from its password; rehearse recovery of an allocated address.
2. Back up and rehearse restoration of SQLite user-address mappings AND the separate local signer journal. A seed does not restore customer mappings or pending transaction identities.
3. Review and confirm the per-collection and daily caps displayed during private startup. The local caps are rehearsal settings, not estimates or authorization by themselves. Change them when needed and restart the server so its accepted fee cap matches the worker. One TRX is 1,000,000 sun.
4. Verify all imported balances and a small operator-owned deposit, collection and withdrawal before admitting customers.

Automatic TRX fuel funding uses a separate derived account at `m/44'/195'/1'/0/0`, controlled by the existing protected deposit wallet. Its public address can be shown locally without exposing any key:

```powershell
npm run collections -- --fuel-address
```

This address is for operator TRX fuel only, not customer USDT. The main TronLink seed is still unnecessary. Fund it only after recovery and limits are verified. The worker can fund only verified allocated deposit addresses, never arbitrary recipients. Funding intentions and signed bytes persist before broadcast; it waits for confirmation before signing USDT collection.

Explicit settings required for sending:

```text
TRON_COLLECTION_SEND=1
TRON_RECOVERY_VERIFIED=1
TRON_COLLECTION_FEE_LIMIT_SUN=<reviewed per-transfer maximum>
TRON_COLLECTION_DAILY_FEE_LIMIT_SUN=<reviewed daily token-fee maximum>
TRON_GAS_FUNDING_ENABLED=1
TRON_GAS_DAILY_LIMIT_SUN=<reviewed daily TRX-funding maximum>
```

The daily budgets are separate, UTC-based conservative reservations, not actual fee reports. Pending transfers carried into a new UTC day must reserve that day's budget again before broadcast; same-day retries of the same job are idempotent. Historical reservations are preserved, including migration from the previous journal format. Expired signed transactions are held without broadcast and without creating a fresh daily reservation. Funding includes a 2 TRX reserve in its budget, and each deposit address conservatively needs the token Energy cap plus 1 TRX before sending. Disabling automatic funding prevents rebroadcasting an unconfirmed funding transaction. Unused funded TRX stays at those addresses; no automatic TRX refund is implemented. Delegated Energy/Bandwidth can reduce actual costs, but this worker uses the conservative TRX fallback and does not calculate delegated-resource savings.

Start privately only after completing these steps:

```powershell
npm run collections -- --run
```

The worker displays the limits and requires typing the full treasury address before enabling transfers. Do not run this command through the coding agent. Keep the operator machine available; no domain is needed for local preparation. Running unattended after authorization still needs supervised operation, secure credentials, backups, monitoring and security review.

Confirmed failed collections can be released for a new collection plan only after a fresh chain check:

```powershell
npm run payments:operator -- collections release-failed JOB_ID
```

Unknown or expired signed transactions remain held for review. Limits are reservations, not actual expense reports; an unsuccessful attempt can consume a budget even without broadcast. Fail-safe blocking is deliberate, not a guarantee of instant settlement.

## Verification

```powershell
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

Fixture screenshots show public test addresses. Never fund them. No real transfer was performed by this agent. Independent security review, real settlement, portable recovery, reconciliation, monitored infrastructure and the financial/legal launch gates remain outstanding.

References: [TronLink confirmation and authorization](https://docs.tronlink.org/dapp/getting-started/), [TronWeb wallet/network checks](https://tronweb.network/docu/docs/dapp/connect-wallet), [TRON integration](https://developers.tron.network/docs/exchangewallet-integrate-with-the-tron-network), [TRON resources](https://developers.tron.network/docs/resource-model).
