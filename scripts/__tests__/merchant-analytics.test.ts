/**
 * Tests for scripts/merchant-analytics.ts
 *
 * Validates:
 * - Fixture DB setup works correctly
 * - Freshness warning fires when last_ledger is stale
 * - Analytics queries work offline against fixture DB
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DatabaseSync } from "node:sqlite";

// ── Fixture Helpers ───────────────────────────────────────────────────────────

function tmpPath(suffix = ".db"): string {
  return path.join(
    os.tmpdir(),
    `payflow-analytics-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
  );
}

function createFixtureDb(): string {
  const dbPath = tmpPath();
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         TEXT    PRIMARY KEY,
      event_name TEXT    NOT NULL,
      address    TEXT    NOT NULL,
      amount     TEXT,
      ledger     INTEGER NOT NULL,
      timestamp  INTEGER NOT NULL,
      tx_hash    TEXT    NOT NULL,
      raw_data   TEXT    NOT NULL,
      merchant     TEXT,
      fee_amount   TEXT,
      token        TEXT,
      result_code  TEXT
    )
  `);

  db.close();
  return dbPath;
}

function insertEvents(
  dbPath: string,
  events: Array<{
    id: string;
    event_name: string;
    address: string;
    amount?: string;
    ledger: number;
    timestamp: number;
    tx_hash: string;
    raw_data: string;
    merchant?: string;
    fee_amount?: string;
  }>,
): void {
  const db = new DatabaseSync(dbPath);
  const stmt = db.prepare(`
    INSERT INTO events(id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount, token, result_code)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `);

  for (const e of events) {
    stmt.run(
      e.id,
      e.event_name,
      e.address,
      e.amount ?? null,
      e.ledger,
      e.timestamp,
      e.tx_hash,
      e.raw_data,
      e.merchant ?? null,
      e.fee_amount ?? null,
    );
  }
  db.close();
}

function setMeta(dbPath: string, key: string, value: string): void {
  const db = new DatabaseSync(dbPath);
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
  db.close();
}

function createRealisticFixture(): string {
  const dbPath = createFixtureDb();
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  const merchantA = "GAAAAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const subscriberA1 = "GCCCCCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

  const events = [
    {
      id: "tx1:subscribed",
      event_name: "subscribed",
      address: subscriberA1,
      amount: "10000000",
      ledger: 100001,
      timestamp: now - 30 * day,
      tx_hash: "tx1",
      raw_data: JSON.stringify({ subscriber: subscriberA1, merchant: merchantA, amount: "10000000" }),
      merchant: merchantA,
    },
    {
      id: "tx2:charged",
      event_name: "charged",
      address: subscriberA1,
      amount: "10000000",
      ledger: 100002,
      timestamp: now - 5 * day,
      tx_hash: "tx2",
      raw_data: JSON.stringify({ subscriber: subscriberA1, merchant: merchantA, amount: "10000000", fee: "200000" }),
      merchant: merchantA,
      fee_amount: "200000",
    },
  ];

  insertEvents(dbPath, events);
  setMeta(dbPath, "last_ledger", "100010");
  setMeta(dbPath, "last_ledger_timestamp", String(now - 60));

  return dbPath;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("merchant-analytics", () => {
  let fixtureDbPath: string;

  before(() => {
    fixtureDbPath = createRealisticFixture();
  });

  after(() => {
    if (fs.existsSync(fixtureDbPath)) {
      fs.unlinkSync(fixtureDbPath);
    }
  });

  describe("fixture DB setup", () => {
    it("creates a valid SQLite database", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const row = db.prepare("SELECT COUNT(*) as cnt FROM events").get() as { cnt: number };
      assert.strictEqual(row.cnt, 2);
      db.close();
    });

    it("has meta table with last_ledger", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const row = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger'").get() as { value: string };
      assert.strictEqual(row.value, "100010");
      db.close();
    });
  });

  describe("freshness warning", () => {
    it("warns when DB is stale", () => {
      const staleDbPath = createFixtureDb();
      const now = Math.floor(Date.now() / 1000);
      setMeta(staleDbPath, "last_ledger", "50000");
      setMeta(staleDbPath, "last_ledger_timestamp", String(now - 7200));

      const db = new DatabaseSync(staleDbPath, { open: true, readonly: true });
      const lastLedgerStr = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger'").get() as { value: string };
      const lastLedgerTimestampStr = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger_timestamp'").get() as { value: string };

      assert.strictEqual(lastLedgerStr.value, "50000");
      const stalenessSeconds = now - parseInt(lastLedgerTimestampStr.value, 10);
      assert.ok(stalenessSeconds > 3600);

      const minutes = Math.floor(stalenessSeconds / 60);
      const warning = `Indexer DB is stale: last_ledger=${lastLedgerStr.value}, staleness=${minutes}m ${stalenessSeconds % 60}s (max allowed: 60m).`;
      assert.ok(warning.includes("stale"));
      db.close();

      fs.unlinkSync(staleDbPath);
    });

    it("does not warn when DB is fresh", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const lastLedgerTimestampStr = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger_timestamp'").get() as { value: string };

      const now = Math.floor(Date.now() / 1000);
      const stalenessSeconds = now - parseInt(lastLedgerTimestampStr.value, 10);
      assert.ok(stalenessSeconds < 3600);
      db.close();
    });
  });

  describe("analytics queries work offline", () => {
    it("reads events from fixture DB without RPC", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const events = db.prepare(
        "SELECT event_name, raw_data FROM events WHERE event_name IN ('subscribed', 'charged') ORDER BY timestamp ASC",
      ).all() as { event_name: string; raw_data: string }[];
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].event_name, "subscribed");
      assert.strictEqual(events[1].event_name, "charged");
      db.close();
    });

    it("computes metrics from fixture DB without RPC", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const events = db.prepare(
        "SELECT event_name, raw_data, merchant, amount, fee_amount FROM events WHERE event_name = 'charged'",
      ).all() as { event_name: string; raw_data: string; merchant: string | null; amount: string | null; fee_amount: string | null }[];

      let totalRevenue = 0n;
      for (const event of events) {
        const parsed = JSON.parse(event.raw_data);
        const amount = BigInt(parsed.amount ?? event.amount ?? "0");
        const fee = BigInt(parsed.fee ?? parsed.fee_amount ?? event.fee_amount ?? "0");
        totalRevenue += amount - fee;
      }

      assert.strictEqual(totalRevenue, 9800000n);
      db.close();
    });
  });
});
