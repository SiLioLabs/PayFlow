/**
 * db/schema.ts — Read-only schema helpers and a stable import path for tests
 * and tooling.
 *
 * This module does NOT define any tables. The schema is defined exclusively by
 * the numbered migrations in `db/migrations/` and applied by `db/migrate.ts`
 * (via `initSchema` in indexer.ts). Everything here either reports on the
 * schema or re-exports the indexer's DB helpers:
 *
 *   - `SCHEMA_VERSION`  — latest version, derived from the migration list
 *   - `getSchemaVersion`— schema version recorded in a database
 *   - `getTableColumns` / `listIndexes` — introspection for tests and tooling
 *   - `openDatabase`, `initSchema`, `getMeta`, `setMeta`, `upsertEvents`,
 *     `parseEvent`, `stableEventKey`, `indexEvents` — from indexer.ts
 */
import type { DatabaseSync } from "node:sqlite";
import { readSchemaVersion } from "./migrate.js";

export { SCHEMA_VERSION, migrations } from "./migrations/index.js";
export { runMigrations } from "./migrate.js";

/** Schema version recorded in `db` (0 when the database is uninitialised). */
export function getSchemaVersion(db: DatabaseSync): number {
  return readSchemaVersion(db);
}

/** Column names of `table`, in declaration order. */
export function getTableColumns(db: DatabaseSync, table: string): string[] {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

/** Names of user-defined indexes on `table`, sorted. */
export function listIndexes(db: DatabaseSync, table: string): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all(table) as Array<{ name: string }>
  ).map((r) => r.name);
}

export {
  openDatabase,
  initSchema,
  getMeta,
  setMeta,
  upsertEvents,
  parseEvent,
  stableEventKey,
  indexEvents,
  type DedupIndexResult,
} from "../indexer.js";
