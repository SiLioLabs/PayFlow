# FlowPay Scripts

Operational and analytics scripts for the FlowPay contract.  All scripts are written in TypeScript and run with `ts-node`.

---

## Setup

```bash
cd scripts
npm install
```

All scripts read configuration from environment variables.  Copy `.env.example` at the repo root and fill in the required values:

```bash
cp .env.example .env
# edit .env with your CONTRACT_ID, RPC_URL, SOROBAN_SOURCE_ACCOUNT, etc.
```

---

## Scripts Reference

### top-merchants.ts

Fetches the top merchants by subscriber count using the on-chain `get_top_merchants_by_subs` getter.

**Contract limit:** The contract enforces a hard cap of **20** per call (`BatchTooLarge` panic if exceeded).  Use `--limit` and `--page-size` to stay within this boundary.

```bash
# Show top 10 merchants (default)
npx ts-node scripts/top-merchants.ts

# Show top 20 (contract maximum)
npx ts-node scripts/top-merchants.ts --limit 20

# Paginate: page 2, 5 per page
npx ts-node scripts/top-merchants.ts --limit 20 --page 2 --page-size 5

# JSON output
npx ts-node scripts/top-merchants.ts --json

# Dry-run (validate config without RPC call)
npx ts-node scripts/top-merchants.ts --dry-run
```

**Options:**

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `10` | Merchants to fetch from contract (1–20) |
| `--page <n>` | `1` | Page number (1-based) |
| `--page-size <n>` | `10` | Results per page (1–20) |
| `--contract <id>` | `$CONTRACT_ID` | Contract address |
| `--rpc-url <url>` | `$RPC_URL` | Soroban RPC endpoint |
| `--json` | `false` | Emit machine-readable JSON |
| `--dry-run` | `false` | Print config without calling RPC |

Closes [issue #896](https://github.com/SiLioLabs/PayFlow/issues/896).

---

### deploy-pipeline.ts

Hardened deployment pipeline with preflight checklist.  Run before any `upgrade()` call.

```bash
# Full preflight with WASM hash verification
npx ts-node scripts/deploy-pipeline.ts \
  --wasm target/wasm32-unknown-unknown/release/flowpay.wasm \
  --contract $CONTRACT_ID \
  --source $SOROBAN_SOURCE_ACCOUNT

# Dry-run (validate config, skip all network calls)
npx ts-node scripts/deploy-pipeline.ts --dry-run

# Custom summary output path
npx ts-node scripts/deploy-pipeline.ts --summary-out ci-artifacts/deploy-summary.json
```

**Preflight gates:**

| Gate | Failure behaviour |
| --- | --- |
| RPC health | Aborts pipeline |
| WASM hash (local vs on-chain) | Aborts on mismatch; warns if on-chain hash unavailable |
| Schema version | Warns if migration pending (does not abort) |

**Options:**

| Flag | Default | Description |
| --- | --- | --- |
| `--wasm <path>` | — | Path to compiled `.wasm` file |
| `--contract <id>` | `$CONTRACT_ID` | Deployed contract address |
| `--rpc-url <url>` | `$RPC_URL` | Soroban RPC endpoint |
| `--source <addr>` | `$SOROBAN_SOURCE_ACCOUNT` | Source account for read queries |
| `--summary-out <path>` | `deploy-summary.json` | Machine-readable JSON summary |
| `--dry-run` | `false` | Skip all network calls |

The summary artifact is always written, even on failure, so CI can archive it as a build artefact.

Closes [issue #897](https://github.com/SiLioLabs/PayFlow/issues/897).

---

### pre-upgrade-check.ts

Standalone pre-upgrade validator (also called internally by `deploy-pipeline.ts`).  Run this as a lightweight gate in CI before building a release.

```bash
npx ts-node scripts/pre-upgrade-check.ts \
  --wasm path/to/flowpay.wasm \
  --contract $CONTRACT_ID \
  --source $SOROBAN_SOURCE_ACCOUNT
```

Checks: WASM file exists & non-empty, contract ID format, RPC reachable, source account funded, schema version readable.

Closes [issue #897](https://github.com/SiLioLabs/PayFlow/issues/897).

---

### backup-indexer-db.ts

Online-safe backup and restore helper for the indexer SQLite database (`data/events.db`).

The backup uses SQLite's `backup()` API (hot copy — no write lock on source).  After writing, an integrity check (`PRAGMA integrity_check`) is run on the backup file.  Restore verifies integrity of the backup before touching the live database.

#### Backup

```bash
# Default: backup to data/backups/events-<timestamp>.db
npx ts-node scripts/backup-indexer-db.ts backup

# Custom paths
npx ts-node scripts/backup-indexer-db.ts backup \
  --db data/events.db \
  --out /mnt/backups/events-2026-08-29.db

# Overwrite if destination exists
npx ts-node scripts/backup-indexer-db.ts backup --force

# Dry-run
npx ts-node scripts/backup-indexer-db.ts backup --dry-run
```

#### Restore

```bash
# Restore from a backup
npx ts-node scripts/backup-indexer-db.ts restore \
  --from data/backups/events-2026-08-29.db

# Overwrite live DB
npx ts-node scripts/backup-indexer-db.ts restore \
  --from data/backups/events-2026-08-29.db \
  --force

# Dry-run (verify backup integrity, print plan, do not overwrite)
npx ts-node scripts/backup-indexer-db.ts restore \
  --from data/backups/events-2026-08-29.db \
  --dry-run
```

**Restore safety rules:**
1. Backup integrity check (`PRAGMA integrity_check`) must return `ok`.
2. If destination exists, `--force` is required.
3. Destination directory is created if it does not exist.

**Options (backup):**

| Flag | Default | Description |
| --- | --- | --- |
| `--db <path>` | `$INDEXER_DB_PATH` or `data/events.db` | Source database |
| `--out <path>` | `data/backups/events-<ts>.db` | Backup destination |
| `--force` | `false` | Overwrite destination if it exists |
| `--dry-run` | `false` | Print plan without writing files |

**Options (restore):**

| Flag | Default | Description |
| --- | --- | --- |
| `--from <path>` | — (required) | Backup file to restore from |
| `--db <path>` | `$INDEXER_DB_PATH` or `data/events.db` | Restore destination |
| `--force` | `false` | Overwrite destination if it exists |
| `--dry-run` | `false` | Verify + print plan without writing |

**Optional: S3 lifecycle policies**

For production deployments you may want to ship backups to S3 and apply lifecycle rules to expire old backups automatically.  This is not implemented in the script but can be added by piping the backup output to `aws s3 cp`:

```bash
npx ts-node scripts/backup-indexer-db.ts backup --out /tmp/events-backup.db
aws s3 cp /tmp/events-backup.db s3://my-bucket/flowpay-backups/
```

Closes [issue #898](https://github.com/SiLioLabs/PayFlow/issues/898).

---

## Running Tests

```bash
cd scripts
npm test
```

Tests use [Vitest](https://vitest.dev/) with Node environment.  All tests mock file I/O and SQLite — no running database or network connection is needed.

```bash
# Typecheck only
npm run typecheck
```

---

## Environment Variables

| Variable | Used by | Description |
| --- | --- | --- |
| `CONTRACT_ID` / `VITE_CONTRACT_ID` | all | Deployed FlowPay contract ID |
| `RPC_URL` / `VITE_RPC_URL` | all | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` / `VITE_NETWORK_PASSPHRASE` | all | Stellar network passphrase |
| `SOROBAN_SOURCE_ACCOUNT` | deploy-pipeline, top-merchants | Source account for read-only RPC queries |
| `SOROBAN_SECRET_KEY` | keeper (not in this dir) | Keeper signing key |
| `INDEXER_DB_PATH` | backup-indexer-db | Override default `data/events.db` |
| `BACKUP_DIR` | backup-indexer-db | Override default `data/backups/` |
| `PAGE_SIZE` | keeper | Batch size for `batch_charge` (max **20**) |

---

## See Also

- [`docs/KEEPER.md`](../docs/KEEPER.md) — Full keeper runbook (env vars, DLQ, dry-run, ChargeResult table)
- [`docs/API.md`](../docs/API.md) — Contract function reference
- [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) — Contract deployment and migration guide
