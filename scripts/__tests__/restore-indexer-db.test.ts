/**
 * Backup → restore verification for scripts/restore-indexer-db.ts, using real
 * SQLite files (no mocks): roundtrip equality, corrupted/incomplete backup
 * rejection, and destination safeguards.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBackup, openDatabase as openBackupDb } from "../backup-indexer-db.js";
import { initSchema, openDatabase, parseEvent, setMeta, upsertEvents } from "../indexer.js";
import {
  checksumPath,
  parseRestoreArgs,
  restoreIndexerDb,
  sha256File,
  type RestoreCliOptions,
} from "../restore-indexer-db.js";

let dir: string;
const p = (name: string): string => path.join(dir, name);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "payflow-restore-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Fixtures ────────────────────────────────────────────────────────────────

function rpcEvent(i: number, name: string, address: string, value: Record<string, unknown>) {
  const toid = ((BigInt(5000 + i) << 32n) | (1n << 12n)).toString().padStart(19, "0");
  const id = `${toid}-0000000000`;
  return {
    id,
    pagingToken: id,
    txHash: `tx-${i}`,
    ledger: 5000 + i,
    ledgerClosedAt: new Date((1_760_000_000 + i * 5) * 1000).toISOString(),
    topic: [name, address],
    value,
  };
}

/** A representative indexer DB: all event kinds, nulls, unicode, bigint-size amounts, meta rows. */
function createSourceDb(file: string): void {
  const db = openDatabase(file);
  initSchema(db);
  const events = [
    rpcEvent(1, "subscribed", "GUSER1", { merchant: "GMERCH1", subscriber: "GUSER1", amount: 1000 }),
    rpcEvent(2, "charged", "GUSER1", { merchant: "GMERCH1", amount: "9007199254740993", fee: 10 }),
    rpcEvent(3, "charged", "GUSER2", { merchant: "GMERCH2", amount: 500, fee: 5, token: "CTOKEN" }),
    rpcEvent(4, "paused", "GUSER2", {}),
    rpcEvent(5, "cancelled", "GUSER1", { merchant: "GMERCH1", note: "héllo ✓ 日本語" }),
  ].map((e) => parseEvent(e)!);
  for (let i = 0; i < 200; i++) {
    events.push(parseEvent(rpcEvent(100 + i, "charged", `GBULK${i % 7}`, { merchant: "GMERCH1", amount: 100 + i, fee: 1 }))!);
  }
  upsertEvents(db, events);
  setMeta(db, "last_ledger", "5301");
  db.close();
}

/** Deterministic hash of the logical content: schema + every row of every table. */
function contentHash(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  const h = createHash("sha256");
  const schema = db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all();
  h.update(JSON.stringify(schema));
  for (const t of ["meta", "events"]) {
    const rows = db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all();
    h.update(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  }
  db.close();
  return h.digest("hex");
}

function makeBackup(src: string): string {
  const out = p("backup.db");
  const r = runBackup({ dbPath: src, outPath: out, force: false, dryRun: false });
  expect(r.success).toBe(true);
  return out;
}

const opts = (over: Partial<RestoreCliOptions>): RestoreCliOptions => ({
  fromPath: p("backup.db"),
  dbPath: p("restored.db"),
  force: false,
  dryRun: false,
  requireChecksum: false,
  ...over,
});

// ── Roundtrip ───────────────────────────────────────────────────────────────

describe("backup → restore roundtrip", () => {
  it("restores a database identical to the original", () => {
    createSourceDb(p("source.db"));
    const backup = makeBackup(p("source.db"));

    const r = restoreIndexerDb(opts({ fromPath: backup, dbPath: p("restored.db") }));
    expect(r).toMatchObject({ success: true, rowCount: 205, checksumVerified: true, safetyCopy: null });

    // Logical equality with the original (schema + all rows + meta)…
    expect(contentHash(p("restored.db"))).toBe(contentHash(p("source.db")));
    // …and byte equality with the backup it came from.
    expect(sha256File(p("restored.db"))).toBe(sha256File(backup));

    const db = new DatabaseSync(p("restored.db"), { readOnly: true });
    expect((db.prepare("SELECT value FROM meta WHERE key='last_ledger'").get() as { value: string }).value).toBe("5301");
    expect(
      (db.prepare("SELECT amount FROM events WHERE tx_hash='tx-2'").get() as { amount: string }).amount,
    ).toBe("9007199254740993");
    expect(
      (db.prepare("SELECT raw_data FROM events WHERE tx_hash='tx-5'").get() as { raw_data: string }).raw_data,
    ).toContain("héllo ✓ 日本語");
    db.close();
  });

  it("restored database is usable by the indexer (accepts further writes)", () => {
    createSourceDb(p("source.db"));
    makeBackup(p("source.db"));
    expect(restoreIndexerDb(opts({})).success).toBe(true);

    const db = openDatabase(p("restored.db"));
    initSchema(db);
    upsertEvents(db, [parseEvent(rpcEvent(999, "charged", "GNEW", { merchant: "GMERCH1", amount: 1 }))!]);
    expect((db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c).toBe(206);
    db.close();
  });

  it("backup writes a sha256sum-format checksum file", () => {
    createSourceDb(p("source.db"));
    const backup = makeBackup(p("source.db"));
    expect(fs.readFileSync(checksumPath(backup), "utf8")).toBe(`${sha256File(backup)}  backup.db\n`);
  });

  it("the backup-indexer-db.ts real SQLite adapter produces a restorable file", () => {
    createSourceDb(p("source.db"));
    const db = openBackupDb(p("source.db"));
    expect(db.countEvents()).toBe(205);
    db.close();
  });
});

// ── Corrupted / invalid backups ─────────────────────────────────────────────

describe("rejects bad backups and leaves the destination untouched", () => {
  const expectRefused = (r: ReturnType<typeof restoreIndexerDb>, message: RegExp) => {
    expect(r.success).toBe(false);
    expect(r.message).toMatch(message);
    expect(fs.existsSync(p("restored.db"))).toBe(false);
    expect(fs.readdirSync(dir).filter((f) => f.includes("restore-tmp"))).toEqual([]);
  };

  beforeEach(() => createSourceDb(p("source.db")));

  it("missing --from", () => expectRefused(restoreIndexerDb(opts({ fromPath: "" })), /--from/));
  it("missing file", () => expectRefused(restoreIndexerDb(opts({ fromPath: p("nope.db") })), /not found/));
  it("a directory", () => expectRefused(restoreIndexerDb(opts({ fromPath: dir })), /not a regular file/));

  it("an empty file", () => {
    fs.writeFileSync(p("backup.db"), "");
    expectRefused(restoreIndexerDb(opts({})), /empty/);
  });

  it("a non-SQLite file", () => {
    fs.writeFileSync(p("backup.db"), "this is definitely not a database".repeat(50));
    expectRefused(restoreIndexerDb(opts({})), /not a SQLite database/);
  });

  it("a checksum mismatch (bit flip in the middle of the file)", () => {
    const backup = makeBackup(p("source.db"));
    const bytes = fs.readFileSync(backup);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(backup, bytes);
    expectRefused(restoreIndexerDb(opts({})), /Checksum mismatch/);
  });

  it("a truncated backup (checksum present)", () => {
    const backup = makeBackup(p("source.db"));
    fs.truncateSync(backup, Math.floor(fs.statSync(backup).size / 2));
    expectRefused(restoreIndexerDb(opts({})), /Checksum mismatch/);
  });

  it("a truncated backup even without a checksum file (integrity_check catches it)", () => {
    const backup = makeBackup(p("source.db"));
    fs.rmSync(checksumPath(backup));
    fs.truncateSync(backup, Math.floor(fs.statSync(backup).size / 2));
    expectRefused(restoreIndexerDb(opts({})), /integrity_check|damaged|cannot be opened/);
  });

  it("a malformed checksum file", () => {
    const backup = makeBackup(p("source.db"));
    fs.writeFileSync(checksumPath(backup), "garbage\n");
    expectRefused(restoreIndexerDb(opts({})), /malformed/);
  });

  it("a missing checksum file when --require-checksum is set (but only warns otherwise)", () => {
    const backup = makeBackup(p("source.db"));
    fs.rmSync(checksumPath(backup));
    expectRefused(restoreIndexerDb(opts({ requireChecksum: true })), /--require-checksum/);
    const ok = restoreIndexerDb(opts({}));
    expect(ok).toMatchObject({ success: true, checksumVerified: false });
  });

  it("a valid SQLite database that is not an indexer database", () => {
    const other = new DatabaseSync(p("backup.db"));
    other.exec("CREATE TABLE unrelated(x)");
    other.close();
    expectRefused(restoreIndexerDb(opts({})), /not an indexer database/);
  });

  it("an indexer database with an incompatible events table", () => {
    const other = new DatabaseSync(p("backup.db"));
    other.exec("CREATE TABLE meta(key TEXT, value TEXT); CREATE TABLE events(id TEXT)");
    other.close();
    expectRefused(restoreIndexerDb(opts({})), /incompatible events table/);
  });

  it("an indexer database without a schema_version", () => {
    createSourceDb(p("nov.db"));
    const d = new DatabaseSync(p("nov.db"));
    d.exec("DELETE FROM meta WHERE key='schema_version'");
    d.close();
    fs.copyFileSync(p("nov.db"), p("backup.db"));
    expectRefused(restoreIndexerDb(opts({})), /schema_version/);
  });

  it("restoring a file onto itself", () => {
    const backup = makeBackup(p("source.db"));
    const r = restoreIndexerDb(opts({ dbPath: backup, force: true }));
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/same file/);
    expect(sha256File(backup)).toBe(fs.readFileSync(checksumPath(backup), "utf8").slice(0, 64));
  });
});

// ── Destination safeguards ──────────────────────────────────────────────────

describe("destination safeguards", () => {
  beforeEach(() => {
    createSourceDb(p("source.db"));
    makeBackup(p("source.db"));
    // An existing, different live database.
    const live = openDatabase(p("restored.db"));
    initSchema(live);
    upsertEvents(live, [parseEvent(rpcEvent(7, "charged", "GLIVE", { merchant: "GM", amount: 1 }))!]);
    setMeta(live, "last_ledger", "42");
    live.close();
  });

  it("refuses to overwrite an existing database without --force", () => {
    const before = sha256File(p("restored.db"));
    const r = restoreIndexerDb(opts({}));
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/--force/);
    expect(sha256File(p("restored.db"))).toBe(before);
  });

  it("dry-run verifies but changes nothing (with or without an existing destination)", () => {
    const before = sha256File(p("restored.db"));
    const r = restoreIndexerDb(opts({ force: true, dryRun: true }));
    expect(r).toMatchObject({ success: true, dryRun: true, rowCount: 205 });
    expect(sha256File(p("restored.db"))).toBe(before);
    expect(fs.readdirSync(dir).filter((f) => f.includes("pre-restore"))).toEqual([]);

    fs.rmSync(p("restored.db"));
    expect(restoreIndexerDb(opts({ dryRun: true })).success).toBe(true);
    expect(fs.existsSync(p("restored.db"))).toBe(false);
  });

  it("with --force: keeps a safety copy of the old database, then installs the backup", () => {
    const oldHash = contentHash(p("restored.db"));
    const r = restoreIndexerDb(opts({ force: true }));
    expect(r.success).toBe(true);
    expect(r.safetyCopy).toMatch(/restored\.db\.pre-restore-/);
    expect(contentHash(r.safetyCopy!)).toBe(oldHash);
    expect(contentHash(p("restored.db"))).toBe(contentHash(p("source.db")));
  });

  it("safety copy includes data that only exists in the old database's WAL", () => {
    // A process that is SIGKILLed after committing leaves the write in -wal, un-checkpointed.
    const script = `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(p("restored.db"))});
      db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
      db.exec("INSERT INTO meta(key,value) VALUES('only_in_wal','yes')");
      process.kill(process.pid, "SIGKILL");
    `;
    expect(() => execFileSync(process.execPath, ["-e", script], { stdio: "ignore" })).toThrow();
    expect(fs.statSync(p("restored.db-wal")).size).toBeGreaterThan(0);

    const r = restoreIndexerDb(opts({ force: true }));
    expect(r.success).toBe(true);
    const copy = new DatabaseSync(r.safetyCopy!, { readOnly: true });
    expect((copy.prepare("SELECT value FROM meta WHERE key='only_in_wal'").get() as { value: string }).value).toBe("yes");
    copy.close();
    expect(fs.existsSync(p("restored.db-wal"))).toBe(false);
    expect(contentHash(p("restored.db"))).toBe(contentHash(p("source.db")));
  });

  it("refuses when another connection holds a write lock, leaving the destination intact", () => {
    const before = sha256File(p("restored.db"));
    const holder = new DatabaseSync(p("restored.db"));
    holder.exec("BEGIN IMMEDIATE");
    try {
      const r = restoreIndexerDb(opts({ force: true }));
      expect(r.success).toBe(false);
      expect(r.message).toMatch(/in use by another process/);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(sha256File(p("restored.db"))).toBe(before);
    expect(fs.readdirSync(dir).filter((f) => f.includes("pre-restore") || f.includes("restore-tmp"))).toEqual([]);
  });

  it("removes stale -wal/-shm/-journal files so they cannot be replayed onto the restored DB", () => {
    for (const ext of ["-wal", "-shm", "-journal"]) fs.writeFileSync(p(`restored.db${ext}`), "stale junk");
    const r = restoreIndexerDb(opts({ force: true }));
    expect(r.success).toBe(true);
    for (const ext of ["-wal", "-shm", "-journal"]) expect(fs.existsSync(p(`restored.db${ext}`))).toBe(false);
    expect(contentHash(p("restored.db"))).toBe(contentHash(p("source.db")));
  });

  it("can replace a corrupted live database (the main recovery case), keeping its bytes", () => {
    fs.writeFileSync(p("restored.db"), Buffer.alloc(4096, 0xab));
    const r = restoreIndexerDb(opts({ force: true }));
    expect(r.success).toBe(true);
    expect(fs.readFileSync(r.safetyCopy!).equals(Buffer.alloc(4096, 0xab))).toBe(true);
    expect(contentHash(p("restored.db"))).toBe(contentHash(p("source.db")));
  });

  it("creates the destination directory when restoring to a fresh host", () => {
    const r = restoreIndexerDb(opts({ dbPath: p("new/nested/events.db") }));
    expect(r.success).toBe(true);
    expect(contentHash(p("new/nested/events.db"))).toBe(contentHash(p("source.db")));
  });
});

// ── CLI args ────────────────────────────────────────────────────────────────

describe("parseRestoreArgs", () => {
  it("parses flags and defaults", () => {
    expect(parseRestoreArgs(["--from", "b.db", "--db", "x.db", "--force", "--dry-run", "--require-checksum"], {})).toEqual({
      fromPath: "b.db", dbPath: "x.db", force: true, dryRun: true, requireChecksum: true,
    });
    expect(parseRestoreArgs([], {})).toMatchObject({ fromPath: "", dbPath: path.join("data", "events.db"), force: false });
    expect(parseRestoreArgs(["--from", "b"], { INDEXER_DB_PATH: "/env/e.db" }).dbPath).toBe("/env/e.db");
  });
});
