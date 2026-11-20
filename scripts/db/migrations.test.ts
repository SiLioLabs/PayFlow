/**
 * db/migrations.test.ts — the numbered migrations are the single schema
 * definition. Verifies fresh initialisation, upgrades of legacy databases
 * (with data preservation), idempotency, and that every path converges on the
 * same schema.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SCHEMA_VERSION,
  getSchemaVersion,
  getTableColumns,
  listIndexes,
  initSchema,
  runMigrations,
  getMeta,
  setMeta,
} from "./schema.js";

const V2_COLUMNS = [
  "id", "event_name", "address", "amount", "ledger", "timestamp", "tx_hash", "raw_data",
  "merchant", "fee_amount", "token", "result_code",
];
const INDEXES = [
  "idx_events_address", "idx_events_event_name", "idx_events_ledger", "idx_events_timestamp",
];

let dir: string;
let n = 0;
const open = (): DatabaseSync => new DatabaseSync(join(dir, `db-${n++}.sqlite`));

/** Legacy v1 database exactly as the pre-migration indexer created it. */
function createLegacyV1(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE events (
      id TEXT PRIMARY KEY, event_name TEXT NOT NULL, address TEXT NOT NULL, amount TEXT,
      ledger INTEGER NOT NULL, timestamp INTEGER NOT NULL, tx_hash TEXT NOT NULL, raw_data TEXT NOT NULL
    );
    CREATE INDEX idx_events_address ON events(address);
    CREATE INDEX idx_events_event_name ON events(event_name);
    CREATE INDEX idx_events_ledger ON events(ledger);
    CREATE INDEX idx_events_timestamp ON events(timestamp);
    INSERT INTO meta VALUES ('schema_version', '1'), ('last_ledger', '4242');
    INSERT INTO events VALUES ('a:0:0', 'charged', 'GUSER', '100', 10, 1000, 'a', '{"amount":"100"}');
    INSERT INTO events VALUES ('b:0:0', 'subscribed', 'GUSER2', NULL, 11, 1100, 'b', '{}');
  `);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "schema-migrations-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("fresh database", () => {
  it("is built entirely by the migrations", () => {
    const db = open();
    expect(getSchemaVersion(db)).toBe(0);
    expect(runMigrations(db)).toEqual([1, 2, 3]);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(getTableColumns(db, "events")).toEqual(V2_COLUMNS);
    expect(listIndexes(db, "events")).toEqual(INDEXES);
    expect(getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
  });

  it("does not create tables from the removed duplicate definition", () => {
    const db = open();
    initSchema(db);
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names).not.toContain("indexer_state");
    expect(listIndexes(db, "events")).not.toContain("idx_events_type");
  });

  it("is idempotent", () => {
    const db = open();
    initSchema(db);
    expect(runMigrations(db)).toEqual([]);
    initSchema(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
  });
});

describe("legacy databases", () => {
  it("upgrades a v1 database without losing data", () => {
    const db = open();
    createLegacyV1(db);
    expect(runMigrations(db)).toEqual([2, 3]);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(getTableColumns(db, "events")).toEqual(V2_COLUMNS);
    expect(getMeta(db, "last_ledger")).toBe("4242");
    const rows = db.prepare("SELECT * FROM events ORDER BY id").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "a:0:0", address: "GUSER", amount: "100", merchant: null });
    expect(rows[1]).toMatchObject({ id: "b:0:0", amount: null, token: null });
  });

  it("upgrades an unversioned legacy database that already has every column", () => {
    const db = open();
    createLegacyV1(db);
    for (const c of ["merchant", "fee_amount", "token", "result_code"]) {
      db.exec(`ALTER TABLE events ADD COLUMN ${c} TEXT`);
    }
    db.exec("DELETE FROM meta WHERE key = 'schema_version'");

    expect(runMigrations(db)).toEqual([1, 2, 3]);
    expect(getTableColumns(db, "events")).toEqual(V2_COLUMNS);
    expect((db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c).toBe(2);
  });

  it("upgrades through initSchema (the indexer startup path)", () => {
    const db = open();
    createLegacyV1(db);
    initSchema(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(getMeta(db, "last_ledger")).toBe("4242");
  });

  it("upgraded and fresh databases have identical schemas", () => {
    const fresh = open();
    initSchema(fresh);
    const upgraded = open();
    createLegacyV1(upgraded);
    initSchema(upgraded);
    expect(getTableColumns(upgraded, "events")).toEqual(getTableColumns(fresh, "events"));
    expect(listIndexes(upgraded, "events")).toEqual(listIndexes(fresh, "events"));
  });
});

describe("safety", () => {
  it("refuses a database newer than this indexer supports", () => {
    const db = open();
    initSchema(db);
    setMeta(db, "schema_version", String(SCHEMA_VERSION + 1));
    expect(() => runMigrations(db)).toThrow(/newer than this indexer supports/);
  });
});
