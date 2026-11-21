/**
 * db/migrate.ts — the only code that creates or alters indexer tables.
 *
 * Applies the numbered migrations from `db/migrations/` in order. Each
 * migration runs in its own transaction together with the `schema_version`
 * bump, so a crash cannot leave a half-applied migration.
 */
import type { DatabaseSync } from "node:sqlite";
import { migrations, SCHEMA_VERSION } from "./migrations/index.js";

/** Read the recorded schema version (0 when unset / no meta table yet). */
export function readSchemaVersion(db: DatabaseSync): number {
  const hasMeta = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get();
  if (!hasMeta) return 0;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  const parsed = row ? parseInt(row.value, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Apply all pending migrations. Returns the versions that were applied
 * (empty when the database was already up to date).
 */
export function runMigrations(db: DatabaseSync): number[] {
  const current = readSchemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema_version ${current} is newer than this indexer supports (${SCHEMA_VERSION}). ` +
        "Upgrade the indexer before opening this database.",
    );
  }

  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      migration.up(db);
      db.prepare(
        "INSERT INTO meta(key, value) VALUES('schema_version', ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(migration.version));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    applied.push(migration.version);
  }
  return applied;
}
