# Running the indexer on PostgreSQL

By default `scripts/indexer.ts` writes to an embedded SQLite file
(`DATA_DIR/events.db`). SQLite allows only one writer and limits concurrent
readers, so for production you can index into PostgreSQL instead (#1484).

## Selecting the backend

| `DATABASE_URL` | Backend |
|---|---|
| unset | SQLite at `DB_FILE` / `DATA_DIR/events.db` (unchanged behaviour) |
| `postgres://user:pass@host:5432/db` or `postgresql://…` | PostgreSQL |
| anything else | startup error |

```bash
cd scripts
DATABASE_URL=postgres://payflow:secret@db.internal:5432/payflow \
CONTRACT_ID=C... npm run indexer
```

The startup log shows `backend` and the URL with the password redacted.

## Schema and migrations

Both backends use the same tables, columns, indexes, upsert key and
`meta.schema_version`, implemented in [`scripts/db/store.ts`](../../scripts/db/store.ts):

- `events`: one row per event, keyed by `stableEventKey` (`<tx_hash>:<op>:<event>`), upserted with `ON CONFLICT(id) DO UPDATE`
- `meta`: `last_ledger` cursor and `schema_version`

Differences on PostgreSQL:

- `ledger` and `timestamp` are `BIGINT`. SQLite's `INTEGER` is also 64-bit, so the values are the same.
- Amounts stay `TEXT` because they are `i128`.
- Migrations run in one transaction under an advisory lock, so two indexers starting at once can't race.
- The v1 → v2 migration uses `ADD COLUMN IF NOT EXISTS`, so it is safe to re-run.

**Adding a migration:** bump `SCHEMA_VERSION` in `indexer.ts`, add the SQLite step
in `initSchema()`, and add the matching statement to `PG_MIGRATIONS` in
`db/store.ts` under the new version number. The `pollOnce` suite runs on both
backends (see below), so a migration missing on one side fails tests.

## Migrating an existing SQLite deployment

The cursor and upserts are idempotent, so the simplest path is to **re-index**:

1. Stop the SQLite indexer and note `last_ledger`:
   `sqlite3 data/events.db "SELECT value FROM meta WHERE key='last_ledger'"`.
2. Start the indexer with `DATABASE_URL` set and `START_LEDGER` set to the first
   ledger you need history from. It creates the schema and backfills. Re-polling
   a range never creates duplicates.

Soroban RPC only keeps a limited window of events. If you need history older
than that window, copy the rows across instead:

```bash
sqlite3 -header -csv data/events.db "SELECT * FROM events" > events.csv
sqlite3 -header -csv data/events.db "SELECT * FROM meta"   > meta.csv
# Start the Postgres indexer once (or run it briefly) so the schema exists, then stop it:
psql "$DATABASE_URL" -c "\copy events FROM 'events.csv' CSV HEADER"
psql "$DATABASE_URL" -c "DELETE FROM meta" -c "\copy meta FROM 'meta.csv' CSV HEADER"
```

Then start the indexer with `DATABASE_URL`. It resumes from the copied `last_ledger`.

## Current limitations

- Only the **indexer write path** uses `DATABASE_URL`. Read-side scripts
  (`query-events.ts`, `merchant-queries.ts`, `alert-*.ts`, `backup-indexer-db.ts`, …)
  still open the SQLite file. Point them at Postgres with your own SQL, or keep
  a SQLite indexer running alongside for them.
- `backup-indexer-db.ts` is SQLite-only. For Postgres, use `pg_dump`.

## Running the tests against PostgreSQL

The indexer suite (`scripts/__tests__/indexer.test.ts`) always runs on SQLite. It
also runs on PostgreSQL when `TEST_DATABASE_URL` is set. Each test uses its own
throwaway schema, which is dropped afterwards.

```bash
cd scripts
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
```
