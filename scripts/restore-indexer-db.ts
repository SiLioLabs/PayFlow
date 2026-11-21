#!/usr/bin/env tsx
/**
 * restore-indexer-db.ts — Verified, safe restore of an indexer backup.
 *
 * Restores a backup produced by `backup-indexer-db.ts backup` (a consistent
 * `VACUUM INTO` snapshot, plus a `<backup>.sha256` checksum sidecar) to the
 * indexer database path. Nothing is written until the backup has been verified,
 * and the live path is only ever replaced by an atomic rename.
 *
 * Verification before restore (any failure aborts, destination untouched):
 *   1. file exists, is a regular non-empty file with the SQLite header;
 *   2. SHA-256 matches `<backup>.sha256` (warns if the sidecar is missing,
 *      unless --require-checksum, which makes that an error);
 *   3. `PRAGMA integrity_check` returns ok;
 *   4. it is an indexer database: `meta` + `events` tables with the expected
 *      columns and a numeric `schema_version`.
 *
 * Safeguards for the destination:
 *   - an existing database is never overwritten without --force;
 *   - with --force the destination must not be in use: an exclusive lock is
 *     attempted and the restore is refused if another process holds the DB
 *     (STOP THE INDEXER FIRST — an idle indexer holds no lock and cannot be
 *     detected);
 *   - the current database is copied to `<db>.pre-restore-<timestamp>` first;
 *   - the backup is copied to a temp file next to the destination, re-verified,
 *     stale `-wal`/`-shm` files are removed, then it is renamed into place.
 *
 * After the swap the restored file is re-opened, integrity-checked and its
 * SHA-256 compared to the backup's.
 *
 * Usage:
 *   tsx restore-indexer-db.ts --from <backup> [--db <path>] [--force] [--dry-run] [--require-checksum]
 *
 * Environment: INDEXER_DB_PATH overrides the --db default (data/events.db).
 * Exit codes: 0 restored (or dry-run OK); 1 refused or failed.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SQLITE_HEADER = "SQLite format 3\0";
const REQUIRED_EVENT_COLUMNS = ["id", "event_name", "address", "ledger", "timestamp", "tx_hash", "raw_data"];

export interface RestoreCliOptions {
  fromPath: string;
  dbPath: string;
  force: boolean;
  dryRun: boolean;
  requireChecksum: boolean;
}

export interface RestoreOutcome {
  success: boolean;
  message: string;
  fromPath: string;
  dbPath: string;
  rowCount: number | null;
  schemaVersion: number | null;
  sha256: string | null;
  checksumVerified: boolean;
  /** Where the previous database was saved, if one existed. */
  safetyCopy: string | null;
  dryRun: boolean;
}

/** Thrown for any refusal; the message is shown to the operator. */
class RestoreError extends Error {}

export function sha256File(file: string): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Path of the checksum sidecar written next to a backup. */
export const checksumPath = (backup: string): string => `${backup}.sha256`;

/** Parse `<hex>  <name>` (sha256sum format). Returns null when malformed. */
function readChecksumFile(file: string): string | null {
  const m = /^([0-9a-f]{64})\b/i.exec(fs.readFileSync(file, "utf8").trim());
  return m ? m[1].toLowerCase() : null;
}

export function writeChecksumFile(backup: string): string {
  const digest = sha256File(backup);
  fs.writeFileSync(checksumPath(backup), `${digest}  ${path.basename(backup)}\n`);
  return digest;
}

interface Inspection {
  rowCount: number;
  schemaVersion: number;
}

/** Verify `file` is an intact indexer database. Throws RestoreError otherwise. */
export function inspectIndexerDb(file: string, label: string): Inspection {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { open: true, readOnly: true });
  } catch (err) {
    throw new RestoreError(`${label} cannot be opened as a SQLite database: ${(err as Error).message}`);
  }
  try {
    const integrity = (db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>)
      .map((r) => r.integrity_check)
      .join("; ");
    if (integrity !== "ok") throw new RestoreError(`${label} failed integrity_check: ${integrity.slice(0, 200)}`);

    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (r) => r.name,
      ),
    );
    for (const t of ["meta", "events"]) {
      if (!tables.has(t)) throw new RestoreError(`${label} is not an indexer database (missing table '${t}')`);
    }
    const columns = new Set(
      (db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>).map((c) => c.name),
    );
    const missing = REQUIRED_EVENT_COLUMNS.filter((c) => !columns.has(c));
    if (missing.length) throw new RestoreError(`${label} has an incompatible events table (missing: ${missing.join(", ")})`);

    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    const schemaVersion = version ? parseInt(version.value, 10) : NaN;
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw new RestoreError(`${label} has no valid schema_version in meta`);
    }
    const rowCount = Number((db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c);
    return { rowCount, schemaVersion };
  } catch (err) {
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(`${label} is damaged: ${(err as Error).message}`);
  } finally {
    db.close();
  }
}

/** Refuse if another connection holds a lock on the destination database. */
function assertNotInUse(dbPath: string): void {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { open: true, timeout: 0 });
    db.exec("BEGIN EXCLUSIVE");
    db.exec("ROLLBACK");
  } catch (err) {
    const msg = (err as Error).message;
    if (/locked|busy/i.test(msg)) {
      throw new RestoreError(
        `Destination ${dbPath} is in use by another process (${msg}). Stop the indexer and any readers, then retry.`,
      );
    }
    // A damaged destination is exactly what a restore is for: proceed.
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Save the current database (including unflushed WAL content) before replacing it. */
function makeSafetyCopy(dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  let target = `${dbPath}.pre-restore-${stamp}`;
  for (let i = 1; fs.existsSync(target); i++) target = `${dbPath}.pre-restore-${stamp}-${i}`;
  try {
    const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
    try {
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
  } catch {
    // Destination is unreadable: keep the raw bytes (and WAL) for forensics.
    fs.copyFileSync(dbPath, target);
    for (const ext of ["-wal", "-shm"]) {
      if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, target + ext);
    }
  }
  return target;
}

export function restoreIndexerDb(opts: RestoreCliOptions): RestoreOutcome {
  const out: RestoreOutcome = {
    success: false,
    message: "",
    fromPath: opts.fromPath,
    dbPath: opts.dbPath,
    rowCount: null,
    schemaVersion: null,
    sha256: null,
    checksumVerified: false,
    safetyCopy: null,
    dryRun: opts.dryRun,
  };
  let tmp: string | null = null;

  try {
    // 1. Backup file sanity
    if (!opts.fromPath) throw new RestoreError("--from <backup-path> is required");
    if (!fs.existsSync(opts.fromPath)) throw new RestoreError(`Backup file not found: ${opts.fromPath}`);
    const st = fs.statSync(opts.fromPath);
    if (!st.isFile()) throw new RestoreError(`Backup path is not a regular file: ${opts.fromPath}`);
    if (st.size === 0) throw new RestoreError(`Backup file is empty: ${opts.fromPath}`);
    const header = Buffer.alloc(16);
    const fd = fs.openSync(opts.fromPath, "r");
    try {
      fs.readSync(fd, header, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (header.toString("latin1") !== SQLITE_HEADER) {
      throw new RestoreError(`Backup is not a SQLite database (bad header): ${opts.fromPath}`);
    }
    if (path.resolve(opts.fromPath) === path.resolve(opts.dbPath)) {
      throw new RestoreError("Backup and destination are the same file");
    }

    // 2. Checksum
    const digest = sha256File(opts.fromPath);
    out.sha256 = digest;
    const sidecar = checksumPath(opts.fromPath);
    if (fs.existsSync(sidecar)) {
      const expected = readChecksumFile(sidecar);
      if (!expected) throw new RestoreError(`Checksum file is malformed: ${sidecar}`);
      if (expected !== digest) {
        throw new RestoreError(`Checksum mismatch: backup is corrupted or incomplete (expected ${expected}, got ${digest})`);
      }
      out.checksumVerified = true;
    } else if (opts.requireChecksum) {
      throw new RestoreError(`Checksum file not found: ${sidecar} (required by --require-checksum)`);
    } else {
      console.warn(`  ⚠ No checksum file (${path.basename(sidecar)}); relying on integrity_check only`);
    }

    // 3 + 4. Integrity and indexer-schema checks
    const info = inspectIndexerDb(opts.fromPath, "Backup");
    out.rowCount = info.rowCount;
    out.schemaVersion = info.schemaVersion;

    // Destination safeguards
    const destExists = fs.existsSync(opts.dbPath);
    if (destExists) {
      if (!fs.statSync(opts.dbPath).isFile()) throw new RestoreError(`Destination is not a regular file: ${opts.dbPath}`);
      if (!opts.force) {
        throw new RestoreError(`Destination exists: ${opts.dbPath}. Use --force to replace it (a safety copy is kept).`);
      }
      assertNotInUse(opts.dbPath);
    }

    if (opts.dryRun) {
      out.success = true;
      out.message = `Dry-run OK: backup verified (${info.rowCount} events, schema v${info.schemaVersion}); would restore to ${opts.dbPath}`;
      return out;
    }

    // Install: safety copy → temp copy → verify → drop stale sidecars → atomic rename
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
    if (destExists) out.safetyCopy = makeSafetyCopy(opts.dbPath);

    tmp = `${opts.dbPath}.restore-tmp-${process.pid}`;
    fs.copyFileSync(opts.fromPath, tmp, fs.constants.COPYFILE_EXCL);
    const tfd = fs.openSync(tmp, "r+");
    try {
      fs.fsyncSync(tfd);
    } finally {
      fs.closeSync(tfd);
    }
    if (sha256File(tmp) !== digest) throw new RestoreError("Copied file does not match the backup; aborting");

    for (const ext of ["-wal", "-shm", "-journal"]) fs.rmSync(opts.dbPath + ext, { force: true });
    fs.renameSync(tmp, opts.dbPath);
    tmp = null;

    // Post-restore verification
    if (sha256File(opts.dbPath) !== digest) throw new RestoreError("Restored file hash differs from the backup");
    const after = inspectIndexerDb(opts.dbPath, "Restored database");
    if (after.rowCount !== info.rowCount) {
      throw new RestoreError(`Restored row count ${after.rowCount} != backup ${info.rowCount}`);
    }

    out.success = true;
    out.message = `Restored ${info.rowCount} events (schema v${info.schemaVersion}) to ${opts.dbPath}`;
    return out;
  } catch (err) {
    out.success = false;
    out.message = err instanceof RestoreError ? err.message : `Restore failed: ${(err as Error).message}`;
    return out;
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}

export function parseRestoreArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): RestoreCliOptions {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    fromPath: get("--from") ?? "",
    dbPath: get("--db") ?? env.INDEXER_DB_PATH ?? path.join("data", "events.db"),
    force: argv.includes("--force"),
    dryRun: argv.includes("--dry-run"),
    requireChecksum: argv.includes("--require-checksum"),
  };
}

function main(): void {
  const opts = parseRestoreArgs(process.argv.slice(2));
  console.log(`\n  FlowPay Indexer Restore`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  From   : ${opts.fromPath || "(missing)"}`);
  console.log(`  To     : ${opts.dbPath}`);
  console.log(`  Force  : ${opts.force}   Dry-run: ${opts.dryRun}\n`);
  const r = restoreIndexerDb(opts);
  if (r.success) {
    if (r.checksumVerified) console.log("  ✓ Checksum verified");
    if (r.safetyCopy) console.log(`  ✓ Previous database saved to ${r.safetyCopy}`);
    console.log(`  ✓ ${r.message}\n`);
  } else {
    console.error(`  ✗ ${r.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
