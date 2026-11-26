# Indexer backup and restore runbook

Covers the indexer SQLite database (`data/events.db`, or `$DB_FILE` / `$INDEXER_DB_PATH`).
Scripts: `scripts/backup-indexer-db.ts`, `scripts/restore-indexer-db.ts`.

## What a backup is

- A consistent snapshot made with SQLite `VACUUM INTO`; the indexer may keep running.
- Rollback-mode single file (no `-wal`/`-shm` needed).
- `PRAGMA integrity_check` is run on it after it is written.
- A checksum file `<backup>.sha256` (`sha256sum` format) is written next to it. **Always keep the two together.**

It contains everything the indexer needs: the `events` and `meta` tables (including
`last_ledger`, so a restored indexer resumes from where the backup was taken).

## Prerequisites

- Node 22+ and `npm ci` in `scripts/` (uses `node:sqlite`).
- Read access to the database and write access to the backup/destination directories.
- Enough free disk for the database plus a safety copy of the one being replaced.
- For restores: the ability to stop the indexer and any API/reader processes (`indexer-api.ts`, dashboards).

## Taking a backup

```bash
cd scripts
npx tsx backup-indexer-db.ts backup --db data/events.db --out /mnt/backups/events-$(date -u +%F).db
```

Expected output ends with `✓ Integrity check passed`, `✓ Checksum written` and
`✓ Backup completed successfully`. Schedule it (cron/systemd timer) and copy both
files off the host. Test backups by restoring them (below) — an untested backup is not a backup.

## Verifying a backup without restoring

```bash
npx tsx restore-indexer-db.ts --from /mnt/backups/events-2026-11-20.db --dry-run
```

This checks the file header, the checksum, `integrity_check`, that it is an indexer
database (`meta` + `events`, expected columns, `schema_version`), and prints the row
count — and writes nothing.

## Restoring

1. **Stop** the indexer (and `indexer-api.ts`/other readers). The restore detects a database that is locked by a
   writer, but an idle indexer holds no lock and cannot be detected — if it is still running it will keep appending
   to the file you are replacing.
2. **Dry-run** the backup (above). Do not continue if it reports an error.
3. **Restore**:
   - To a new location (e.g. to inspect or compare first):
     ```bash
     npx tsx restore-indexer-db.ts --from <backup> --db data/events-restored.db
     ```
   - Over the live database:
     ```bash
     npx tsx restore-indexer-db.ts --from <backup> --db data/events.db --force
     ```
     The database being replaced is first saved as `data/events.db.pre-restore-<timestamp>` (including any
     data still in its WAL). The backup is installed with an atomic rename, stale `-wal`/`-shm` files are removed, and the
     result is re-verified by hash and row count.
4. **Verify**:
   ```bash
   sqlite3 data/events.db "PRAGMA integrity_check; SELECT COUNT(*) FROM events; SELECT value FROM meta WHERE key='last_ledger';"
   npx tsx query-events.ts --recent 5 --pretty
   ```
   The row count and `last_ledger` should match the dry-run output.
5. **Start** the indexer. It applies any pending schema migrations and resumes from `meta.last_ledger`. Events from
   ledgers after the backup are fetched again from RPC; they are keyed by their on-chain position, so nothing is duplicated.
6. Keep `*.pre-restore-*` until you are satisfied, then delete it.

## When the restore refuses

| Message | Meaning / action |
|---|---|
| `Backup file not found` / `empty` / `not a SQLite database` | Wrong path, or the file was not fully copied. Re-copy from storage. |
| `Checksum mismatch` | The backup is corrupt or incomplete (or the `.sha256` belongs to another file). Use an older backup. |
| `failed integrity_check` / `is damaged` | Internal corruption. Use an older backup. |
| `not an indexer database` / `incompatible events table` / `no valid schema_version` | The file is not an indexer backup. |
| `Checksum file not found` | Only an error with `--require-checksum`; otherwise a warning and `integrity_check` alone is relied on. |
| `Destination exists … Use --force` | You are about to replace a database; re-run with `--force` if intended. |
| `in use by another process` | Something has the destination open for writing. Stop it and retry. |

On any refusal or failure the existing database is left untouched and temporary files are removed.

## Recovery scenarios

- **Corrupt or lost `events.db`**: stop the indexer → restore the newest verified backup with `--force` (the
  corrupt file is kept as `.pre-restore-*`) → start the indexer. It catches up from RPC.
- **Backup older than the RPC retention window**: events between the backup's `last_ledger` and the RPC's oldest
  ledger can no longer be read from RPC. The indexer records this as a ledger gap and you can recover it with
  `horizon-backfill.ts` (see "Ledger gaps and backfill" in `scripts/README.md`, if available in your version).
- **Restoring on a new host**: install, `npm ci`, copy the backup + `.sha256`, restore with `--db` pointing at the new
  data directory (it is created if missing).
- **Rolling back a bad restore**: stop the indexer and restore the `*.pre-restore-*` file with
  `restore-indexer-db.ts --from <that file> --force` (no checksum file → a warning, which is expected).

## Limitations

- Restore cannot know whether the indexer is idle; stopping it is a manual step.
- A backup is a point-in-time copy. Anything indexed after it is re-read from RPC (or recovered via backfill).
- Checksums detect accidental corruption, not tampering; protect backups with storage-level access control.
- The `meta.schema_version` of a restored older backup is upgraded by the indexer on startup, not by the restore.

## Automated test

`scripts/__tests__/restore-indexer-db.test.ts` creates a database with representative data, backs it up, restores
it to a separate path and asserts schema + content hashes and byte hash equal; it also covers truncated, bit-flipped,
empty, non-SQLite and wrong-schema backups, `--force`/dry-run behaviour, active-lock refusal, stale WAL handling and
recovery over a corrupted live database.
