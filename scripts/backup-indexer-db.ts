#!/usr/bin/env ts-node
/**
 * backup-indexer-db.ts
 *
 * Online-safe backup and restore helper for the FlowPay indexer SQLite
 * database (`data/events.db`).
 *
 * Strategy
 * ────────
 * SQLite's built-in `VACUUM INTO` (or `backup` API via better-sqlite3) gives
 * a consistent, hot-copy snapshot without locking writes on the source.  This
 * means the indexer can keep running during backup.
 *
 * After the backup is written, an integrity check (`PRAGMA integrity_check`)
 * is run on the backup file to verify it is not corrupt before the script
 * exits successfully.
 *
 * Usage
 * ─────
 *   # Create a backup
 *   npx ts-node scripts/backup-indexer-db.ts backup [options]
 *
 *   # Restore from a backup
 *   npx ts-node scripts/backup-indexer-db.ts restore --from <backup-path> [options]
 *
 * Options (backup):
 *   --db <path>       Source database path (default: data/events.db)
 *   --out <path>      Backup destination (default: data/backups/events-<timestamp>.db)
 *   --force           Overwrite destination if it already exists
 *   --dry-run         Print what would happen without touching files
 *
 * Options (restore):
 *   --from <path>     Backup file to restore from (required)
 *   --db <path>       Destination database path (default: data/events.db)
 *   --force           Overwrite destination if it already exists
 *   --dry-run         Print what would happen without touching files
 *
 * Environment variables:
 *   INDEXER_DB_PATH   Overrides --db default
 *   BACKUP_DIR        Overrides backup output directory default
 *
 * Closes: https://github.com/SiLioLabs/PayFlow/issues/898
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Command = "backup" | "restore";

export interface BackupOptions {
  dbPath: string;
  outPath: string;
  force: boolean;
  dryRun: boolean;
}

export interface RestoreOptions {
  fromPath: string;
  dbPath: string;
  force: boolean;
  dryRun: boolean;
}

export interface BackupResult {
  success: boolean;
  command: Command;
  sourcePath: string;
  destPath: string;
  rowCount: number | null;
  integrityOk: boolean;
  message: string;
  timestamp: string;
}

// ── SQLite abstraction ────────────────────────────────────────────────────────
// We isolate the better-sqlite3 import so tests can mock it easily.

export interface SqliteDb {
  /** Run a VACUUM INTO backup to destPath */
  backup(destPath: string): void;
  /** Run PRAGMA integrity_check; returns "ok" on success */
  pragmaIntegrity(): string;
  /** Count total rows in the events table */
  countEvents(): number;
  /** Close the database */
  close(): void;
}

/**
 * Opens a better-sqlite3 database and wraps it with our SqliteDb interface.
 * This is the production implementation.  Tests inject a mock.
 */
export function openDatabase(dbPath: string): SqliteDb {
  // Dynamic import so the module can be tree-shaken or mocked in tests
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(dbPath, { readonly: false });

  return {
    backup(destPath: string) {
      // better-sqlite3 v9+ ships a synchronous backup() method.
      // VACUUM INTO is an equally valid online-safe strategy; we use backup()
      // for its progress callback support.
      (db as any).backup(destPath);
    },
    pragmaIntegrity(): string {
      const rows = db.pragma("integrity_check") as { integrity_check: string }[];
      return rows[0]?.integrity_check ?? "error";
    },
    countEvents(): number {
      try {
        const row = db
          .prepare("SELECT COUNT(*) AS cnt FROM events")
          .get() as { cnt: number };
        return row.cnt;
      } catch {
        return -1;
      }
    },
    close() {
      db.close();
    },
  };
}

// ── Argument parsing ──────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): {
  command: Command;
  backup: BackupOptions;
  restore: RestoreOptions;
} {
  const command: Command =
    argv[0] === "restore" ? "restore" : "backup";

  const rest = argv.slice(command === "restore" || argv[0] === "backup" ? 1 : 0);

  const get = (flag: string): string | undefined => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const has = (flag: string) => rest.includes(flag);

  const defaultDb =
    process.env.INDEXER_DB_PATH ?? path.join("data", "events.db");

  const backupDir =
    process.env.BACKUP_DIR ?? path.join("data", "backups");

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  const backup: BackupOptions = {
    dbPath: get("--db") ?? defaultDb,
    outPath: get("--out") ?? path.join(backupDir, `events-${timestamp}.db`),
    force: has("--force"),
    dryRun: has("--dry-run"),
  };

  const restore: RestoreOptions = {
    fromPath: get("--from") ?? "",
    dbPath: get("--db") ?? defaultDb,
    force: has("--force"),
    dryRun: has("--dry-run"),
  };

  return { command, backup, restore };
}

// ── Backup ────────────────────────────────────────────────────────────────────

export function runBackup(
  opts: BackupOptions,
  openDb: (p: string) => SqliteDb = openDatabase
): BackupResult {
  const result: BackupResult = {
    success: false,
    command: "backup",
    sourcePath: opts.dbPath,
    destPath: opts.outPath,
    rowCount: null,
    integrityOk: false,
    message: "",
    timestamp: new Date().toISOString(),
  };

  console.log(`\n  FlowPay Indexer Backup`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Source : ${opts.dbPath}`);
  console.log(`  Dest   : ${opts.outPath}`);
  console.log(`  Force  : ${opts.force}`);
  console.log(`  Dry-run: ${opts.dryRun}\n`);

  // Validate source exists
  if (!fs.existsSync(opts.dbPath)) {
    result.message = `Source database not found: ${opts.dbPath}`;
    console.error(`  ✗ ${result.message}`);
    return result;
  }

  // Check destination
  if (fs.existsSync(opts.outPath)) {
    if (!opts.force) {
      result.message = `Destination already exists: ${opts.outPath}. Use --force to overwrite.`;
      console.error(`  ✗ ${result.message}`);
      return result;
    }
    console.log(`  ⚠ Destination exists — overwriting (--force)`);
  }

  if (opts.dryRun) {
    result.success = true;
    result.message = `Dry-run: would backup '${opts.dbPath}' → '${opts.outPath}'`;
    console.log(`  – ${result.message}`);
    return result;
  }

  // Ensure output directory exists
  const outDir = path.dirname(opts.outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Open source DB and create backup
  let sourceDb: SqliteDb | null = null;
  let backupDb: SqliteDb | null = null;

  try {
    sourceDb = openDb(opts.dbPath);
    result.rowCount = sourceDb.countEvents();

    // better-sqlite3 backup() copies atomically to destPath
    sourceDb.backup(opts.outPath);
    console.log(`  ✓ Backup written (${result.rowCount} event rows)`);
  } catch (err: unknown) {
    result.message = `Backup failed: ${(err as Error).message}`;
    console.error(`  ✗ ${result.message}`);
    return result;
  } finally {
    sourceDb?.close();
  }

  // Integrity check on the backup file
  try {
    backupDb = openDb(opts.outPath);
    const integrity = backupDb.pragmaIntegrity();
    result.integrityOk = integrity === "ok";

    if (!result.integrityOk) {
      result.message = `Integrity check failed on backup: ${integrity}`;
      console.error(`  ✗ ${result.message}`);
      return result;
    }

    console.log(`  ✓ Integrity check passed`);
  } catch (err: unknown) {
    result.message = `Integrity check error: ${(err as Error).message}`;
    console.error(`  ✗ ${result.message}`);
    return result;
  } finally {
    backupDb?.close();
  }

  result.success = true;
  result.message = `Backup completed successfully → ${opts.outPath}`;
  console.log(`  ✓ ${result.message}\n`);
  return result;
}

// ── Restore ───────────────────────────────────────────────────────────────────

export function runRestore(
  opts: RestoreOptions,
  openDb: (p: string) => SqliteDb = openDatabase
): BackupResult {
  const result: BackupResult = {
    success: false,
    command: "restore",
    sourcePath: opts.fromPath,
    destPath: opts.dbPath,
    rowCount: null,
    integrityOk: false,
    message: "",
    timestamp: new Date().toISOString(),
  };

  console.log(`\n  FlowPay Indexer Restore`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  From   : ${opts.fromPath}`);
  console.log(`  To     : ${opts.dbPath}`);
  console.log(`  Force  : ${opts.force}`);
  console.log(`  Dry-run: ${opts.dryRun}\n`);

  if (!opts.fromPath) {
    result.message = "--from <backup-path> is required for restore";
    console.error(`  ✗ ${result.message}`);
    return result;
  }

  if (!fs.existsSync(opts.fromPath)) {
    result.message = `Backup file not found: ${opts.fromPath}`;
    console.error(`  ✗ ${result.message}`);
    return result;
  }

  // Verify backup integrity before touching the live DB
  let backupDb: SqliteDb | null = null;
  try {
    backupDb = openDb(opts.fromPath);
    const integrity = backupDb.pragmaIntegrity();
    result.integrityOk = integrity === "ok";

    if (!result.integrityOk) {
      result.message = `Backup file integrity check failed: ${integrity}. Refusing to restore.`;
      console.error(`  ✗ ${result.message}`);
      return result;
    }

    result.rowCount = backupDb.countEvents();
    console.log(
      `  ✓ Backup integrity OK (${result.rowCount} event rows)`
    );
  } catch (err: unknown) {
    result.message = `Could not open backup file: ${(err as Error).message}`;
    console.error(`  ✗ ${result.message}`);
    return result;
  } finally {
    backupDb?.close();
  }

  // Guard against accidental overwrite
  if (fs.existsSync(opts.dbPath)) {
    if (!opts.force) {
      result.message = `Destination exists: ${opts.dbPath}. Use --force to overwrite.`;
      console.error(`  ✗ ${result.message}`);
      return result;
    }
    console.log(`  ⚠ Overwriting existing database (--force)`);
  }

  if (opts.dryRun) {
    result.success = true;
    result.message = `Dry-run: would restore '${opts.fromPath}' → '${opts.dbPath}'`;
    console.log(`  – ${result.message}`);
    return result;
  }

  // Ensure destination directory exists
  const destDir = path.dirname(opts.dbPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Copy backup to live path
  try {
    fs.copyFileSync(opts.fromPath, opts.dbPath);
    console.log(`  ✓ Restored ${opts.fromPath} → ${opts.dbPath}`);
  } catch (err: unknown) {
    result.message = `Restore copy failed: ${(err as Error).message}`;
    console.error(`  ✗ ${result.message}`);
    return result;
  }

  result.success = true;
  result.message = `Restore completed successfully. ${result.rowCount} rows.`;
  console.log(`  ✓ ${result.message}\n`);
  return result;
}

// ── Entry point ───────────────────────────────────────────────────────────────

function main() {
  const { command, backup, restore } = parseArgs(process.argv.slice(2));

  let result: BackupResult;

  if (command === "restore") {
    result = runRestore(restore);
  } else {
    result = runBackup(backup);
  }

  if (!result.success) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
