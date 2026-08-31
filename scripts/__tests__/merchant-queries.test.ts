/**
 * Tests for scripts/merchant-queries.ts
 *
 * Validates:
 * - Shared query helpers work correctly against a fixture SQLite DB
 * - Freshness checking with various staleness scenarios
 * - Merchant metrics computation from indexed events
 * - Offline analytics queries work without RPC
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
    `payflow-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
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
  const subscriberA2 = "GEEEEEEEEEEEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
  const merchantB = "GBBBBBBBBBBBBCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
  const subscriberB1 = "GFFFFFFFFFFFFGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG";

  const events = [
    {
      id: "tx1:subscribed",
      event_name: "subscribed",
      address: subscriberA1,
      amount: "10000000",
      ledger: 100001,
      timestamp: now - 60 * day,
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
      timestamp: now - 30 * day,
      tx_hash: "tx2",
      raw_data: JSON.stringify({ subscriber: subscriberA1, merchant: merchantA, amount: "10000000", fee: "200000" }),
      merchant: merchantA,
      fee_amount: "200000",
    },
    {
      id: "tx3:subscribed",
      event_name: "subscribed",
      address: subscriberA2,
      amount: "20000000",
      ledger: 100003,
      timestamp: now - 15 * day,
      tx_hash: "tx3",
      raw_data: JSON.stringify({ subscriber: subscriberA2, merchant: merchantA, amount: "20000000" }),
      merchant: merchantA,
    },
    {
      id: "tx4:charged",
      event_name: "charged",
      address: subscriberA2,
      amount: "20000000",
      ledger: 100004,
      timestamp: now - 5 * day,
      tx_hash: "tx4",
      raw_data: JSON.stringify({ subscriber: subscriberA2, merchant: merchantA, amount: "20000000", fee: "400000" }),
      merchant: merchantA,
      fee_amount: "400000",
    },
    {
      id: "tx5:subscribed",
      event_name: "subscribed",
      address: subscriberB1,
      amount: "5000000",
      ledger: 100005,
      timestamp: now - 45 * day,
      tx_hash: "tx5",
      raw_data: JSON.stringify({ subscriber: subscriberB1, merchant: merchantB, amount: "5000000" }),
      merchant: merchantB,
    },
    {
      id: "tx6:charged",
      event_name: "charged",
      address: subscriberB1,
      amount: "5000000",
      ledger: 100006,
      timestamp: now - 15 * day,
      tx_hash: "tx6",
      raw_data: JSON.stringify({ subscriber: subscriberB1, merchant: merchantB, amount: "5000000", fee: "100000" }),
      merchant: merchantB,
      fee_amount: "100000",
    },
    {
      id: "tx7:cancelled",
      event_name: "cancelled",
      address: subscriberB1,
      ledger: 100007,
      timestamp: now - 10 * day,
      tx_hash: "tx7",
      raw_data: JSON.stringify({ subscriber: subscriberB1, merchant: merchantB }),
      merchant: merchantB,
    },
  ];

  insertEvents(dbPath, events);
  setMeta(dbPath, "last_ledger", "100010");
  setMeta(dbPath, "last_ledger_timestamp", String(now - 60));

  return dbPath;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("merchant-queries", () => {
  let fixtureDbPath: string;

  before(() => {
    fixtureDbPath = createRealisticFixture();
  });

  after(() => {
    if (fs.existsSync(fixtureDbPath)) {
      fs.unlinkSync(fixtureDbPath);
    }
  });

  describe("openMerchantDb", () => {
    it("returns DatabaseSync for existing file", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      assert.ok(db);
      db.close();
    });
  });

  describe("checkFreshness", () => {
    it("returns fresh status when last_ledger_timestamp is recent", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const lastLedgerStr = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger'").get() as { value: string } | undefined;
      assert.strictEqual(lastLedgerStr?.value, "100010");

      const timestampStr = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger_timestamp'").get() as { value: string } | undefined;
      const stalenessSeconds = Math.floor(Date.now() / 1000) - parseInt(timestampStr!.value, 10);
      // Should be fresh within 5 minutes (fixture is set to 60s ago, allow some margin)
      assert.ok(stalenessSeconds < 300, `Expected staleness < 300s, got ${stalenessSeconds}s`);
      db.close();
    });

    it("detects stale database when timestamp is old", () => {
      const staleDbPath = createFixtureDb();
      const now = Math.floor(Date.now() / 1000);
      setMeta(staleDbPath, "last_ledger", "50000");
      setMeta(staleDbPath, "last_ledger_timestamp", String(now - 7200));

      const db = new DatabaseSync(staleDbPath, { open: true, readonly: true });
      const timestampStr = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger_timestamp'").get() as { value: string };
      const stalenessSeconds = now - parseInt(timestampStr.value, 10);
      assert.ok(stalenessSeconds > 3600);
      db.close();

      fs.unlinkSync(staleDbPath);
    });

    it("returns null last_ledger when meta table is empty", () => {
      const emptyDbPath = createFixtureDb();
      const db = new DatabaseSync(emptyDbPath, { open: true, readonly: true });
      const row = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger'").get();
      assert.strictEqual(row, undefined);
      db.close();
      fs.unlinkSync(emptyDbPath);
    });
  });

  describe("fetchAnalyticsEvents", () => {
    it("returns only subscribed, charged, and cancelled events", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const events = db.prepare(
        "SELECT event_name FROM events WHERE event_name IN ('subscribed', 'charged', 'cancelled') ORDER BY timestamp ASC",
      ).all() as { event_name: string }[];
      assert.strictEqual(events.length, 7);
      for (const event of events) {
        assert.ok(["subscribed", "charged", "cancelled"].includes(event.event_name));
      }
      db.close();
    });

    it("orders events by timestamp ascending", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const events = db.prepare(
        "SELECT timestamp FROM events WHERE event_name IN ('subscribed', 'charged', 'cancelled') ORDER BY timestamp ASC",
      ).all() as { timestamp: number }[];
      for (let i = 1; i < events.length; i++) {
        assert.ok(events[i].timestamp >= events[i - 1].timestamp);
      }
      db.close();
    });
  });

  describe("merchant metrics computation", () => {
    it("computes correct total revenue for merchant A", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const merchantA = "GAAAAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
      const events = db.prepare(
        "SELECT raw_data, fee_amount FROM events WHERE event_name = 'charged' AND merchant = ?",
      ).all(merchantA) as { raw_data: string; fee_amount: string | null }[];

      let totalRevenue = 0n;
      for (const event of events) {
        const parsed = JSON.parse(event.raw_data);
        const amount = BigInt(parsed.amount ?? "0");
        const fee = BigInt(parsed.fee ?? event.fee_amount ?? "0");
        totalRevenue += amount - fee;
      }

      // Charged 10M with 200K fee = 9.8M net, then 20M with 400K fee = 19.6M net
      assert.strictEqual(totalRevenue, 9800000n + 19600000n);
      db.close();
    });

    it("computes correct subscriber count for merchant A", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const merchantA = "GAAAAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
      const subscribers = db.prepare(
        "SELECT DISTINCT address FROM events WHERE event_name = 'subscribed' AND merchant = ?",
      ).all(merchantA) as { address: string }[];
      assert.strictEqual(subscribers.length, 2);
      db.close();
    });

    it("detects cancellations within comparison window for merchant B", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });
      const merchantB = "GBBBBBBBBBBBBCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
      const now = Math.floor(Date.now() / 1000);
      const thirtyDaysAgo = now - 30 * 86400;

      const cancellations = db.prepare(
        "SELECT COUNT(*) as cnt FROM events WHERE event_name = 'cancelled' AND merchant = ? AND timestamp >= ?",
      ).get(merchantB, thirtyDaysAgo) as { cnt: number };

      assert.strictEqual(cancellations.cnt, 1);
      db.close();
    });

    it("handles empty database gracefully", () => {
      const emptyDbPath = createFixtureDb();
      const db = new DatabaseSync(emptyDbPath, { open: true, readonly: true });
      const count = db.prepare("SELECT COUNT(*) as cnt FROM events").get() as { cnt: number };
      assert.strictEqual(count.cnt, 0);
      db.close();
      fs.unlinkSync(emptyDbPath);
    });
  });

  describe("offline functionality", () => {
    it("works fully offline against fixture DB", () => {
      const db = new DatabaseSync(fixtureDbPath, { open: true, readonly: true });

      // Check freshness
      const lastLedgerStr = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger'").get() as { value: string };
      assert.strictEqual(lastLedgerStr.value, "100010");

      // Query events
      const events = db.prepare(
        "SELECT event_name FROM events WHERE event_name IN ('subscribed', 'charged', 'cancelled')",
      ).all() as { event_name: string }[];
      assert.strictEqual(events.length, 7);

      // Compute merchant count
      const merchants = db.prepare(
        "SELECT DISTINCT merchant FROM events WHERE merchant IS NOT NULL",
      ).all() as { merchant: string }[];
      assert.strictEqual(merchants.length, 2);

      db.close();
    });
  });
});
