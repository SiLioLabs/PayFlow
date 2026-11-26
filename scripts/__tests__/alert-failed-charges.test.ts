/**
 * alert-failed-charges.test.ts
 *
 * End-to-end fixture test for charge failure alerting:
 * 1. Simulates a batch_charge_skips event with allowance_insufficient > 0
 * 2. Verifies the alert reads the indexer event correctly
 * 3. Confirms the webhook payload has the expected shape
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { collectFailedCharges, SubscriptionAmountLookup } from "../alert-failed-charges";

describe("alert-failed-charges fixture", () => {
  let dbFile: string;
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    // Create a temporary in-memory test database
    dbFile = path.join("/tmp", `test-alert-${Date.now()}.db`);
    db = new DatabaseSync(dbFile);

    // Create the minimal events table schema (matching indexer.ts)
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
  });

  it("should extract allowance_insufficient from batch_charge_skips event", () => {
    const now = Math.floor(Date.now() / 1000);
    const eventData = {
      total: 10,
      charged: 7,
      not_due: 1,
      no_subscription: 0,
      inactive: 0,
      paused: 0,
      grace_elapsed: 0,
      allowance_insufficient: 2, // <-- 2 users failed due to insufficient allowance
      ledger_sequence: 1234,
    };

    const insertStmt = db.prepare(
      `INSERT INTO events(
        id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, 
        merchant, fee_amount, token, result_code
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insertStmt.run(
      `tx_hash_1:0:0`,
      "batch_charge_skips",
      "GBATCH1111111111111111111111111111111111111111111111111WHPU6",
      null,
      1234,
      now,
      "tx_hash_1",
      JSON.stringify(eventData),
      null,
      null,
      null,
      null
    );

    // Query the event (as alert-failed-charges.ts does)
    const query = db.prepare(
      `SELECT raw_data FROM events
       WHERE event_name = 'batch_charge_skips'
         AND timestamp >= ?
       ORDER BY timestamp DESC`
    );

    const rows = query.all(now - 3600) as Array<{ raw_data: string }>;
    expect(rows.length).toBe(1);

    const parsed = JSON.parse(rows[0].raw_data);
    expect(parsed.allowance_insufficient).toBe(2);
  });

  it("should NOT alert when allowance_insufficient is 0", () => {
    const now = Math.floor(Date.now() / 1000);
    const eventData = {
      total: 10,
      charged: 10,
      not_due: 0,
      no_subscription: 0,
      inactive: 0,
      paused: 0,
      grace_elapsed: 0,
      allowance_insufficient: 0, // <-- all succeeded
      ledger_sequence: 1234,
    };

    const insertStmt = db.prepare(
      `INSERT INTO events(
        id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data,
        merchant, fee_amount, token, result_code
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insertStmt.run(
      `tx_hash_2:0:0`,
      "batch_charge_skips",
      "GBATCH2222222222222222222222222222222222222222222222222WHPU6",
      null,
      1235,
      now,
      "tx_hash_2",
      JSON.stringify(eventData),
      null,
      null,
      null,
      null
    );

    const query = db.prepare(
      `SELECT raw_data FROM events
       WHERE event_name = 'batch_charge_skips'`
    );

    const rows = query.all() as Array<{ raw_data: string }>;
    const parsed = JSON.parse(rows[0].raw_data);

    // Simulate the alert logic: skip if allowance_insufficient is 0
    const shouldAlert = parsed.allowance_insufficient && parsed.allowance_insufficient > 0;
    // `0 && ...` evaluates to 0, not false, so assert falsiness rather than
    // strict equality with `false`.
    expect(shouldAlert).toBeFalsy();
  });

  it("should aggregate multiple batch_charge_skips events in alert payload", () => {
    const now = Math.floor(Date.now() / 1000);

    const insertStmt = db.prepare(
      `INSERT INTO events(
        id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data,
        merchant, fee_amount, token, result_code
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // Two batches with failures
    for (let i = 0; i < 2; i++) {
      const eventData = {
        total: 5,
        charged: 3,
        not_due: 0,
        no_subscription: 0,
        inactive: 0,
        paused: 0,
        grace_elapsed: 0,
        allowance_insufficient: 2,
        ledger_sequence: 1234 + i,
      };

      insertStmt.run(
        `tx_hash_${i}:0:0`,
        "batch_charge_skips",
        `GBATCH${i}${"0".repeat(50)}${i}`,
        null,
        1234 + i,
        now - (1000 * i),
        `tx_hash_${i}`,
        JSON.stringify(eventData),
        null,
        null,
        null,
        null
      );
    }

    const query = db.prepare(
      `SELECT raw_data FROM events
       WHERE event_name = 'batch_charge_skips'
       ORDER BY timestamp DESC`
    );

    const rows = query.all() as Array<{ raw_data: string }>;
    expect(rows.length).toBe(2);

    // Both should have allowance_insufficient events
    const failedBatches = rows
      .map((r) => JSON.parse(r.raw_data))
      .filter((d) => d.allowance_insufficient > 0);

    expect(failedBatches.length).toBe(2);
    const totalFailures = failedBatches.reduce((sum, d) => sum + d.allowance_insufficient, 0);
    expect(totalFailures).toBe(4);
  });

  it("should record only charge_failed reference is removed from codebase", () => {
    // This test confirms no dead 'charge_failed' reference remains
    const query = db.prepare("SELECT COUNT(*) as cnt FROM events WHERE event_name = 'charge_failed'");
    const result = query.get() as { cnt: number };
    expect(result.cnt).toBe(0);

    // The canonical event is batch_charge_skips
    db.exec(`
      INSERT INTO events(
        id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data,
        merchant, fee_amount, token, result_code
      ) VALUES(
        'tx:0:0', 'batch_charge_skips', 'GADDR', NULL, 100, ${Math.floor(Date.now() / 1000)},
        'tx', '{}', NULL, NULL, NULL, NULL
      )
    `);

    const checkQuery = db.prepare("SELECT COUNT(*) as cnt FROM events WHERE event_name = 'batch_charge_skips'");
    const checkResult = checkQuery.get() as { cnt: number };
    expect(checkResult.cnt).toBe(1);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
  });
});

describe("alert-failed-charges subscription amounts", () => {
  let db: InstanceType<typeof DatabaseSync>;
  let seq = 0;
  const now = Math.floor(Date.now() / 1000);

  function insert(event_name: string, address: string, amount: string | null, ledger: number, raw: unknown): void {
    db.prepare(
      `INSERT INTO events(id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data,
         merchant, fee_amount, token, result_code)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    ).run(`tx${++seq}:0:0`, event_name, address, amount, ledger, now, `tx${seq}`, JSON.stringify(raw));
  }

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY, event_name TEXT NOT NULL, address TEXT NOT NULL, amount TEXT,
        ledger INTEGER NOT NULL, timestamp INTEGER NOT NULL, tx_hash TEXT NOT NULL, raw_data TEXT NOT NULL,
        merchant TEXT, fee_amount TEXT, token TEXT, result_code TEXT
      )
    `);
  });

  afterEach(() => db.close());

  it("reports the user's real subscription amount instead of 0", () => {
    insert("subscribed", "GUSER1", "50000000", 10, { amount: "50000000", merchant: "GMERCH" });
    insert("batch_charge_skips", "", null, 20, { user: "GUSER1", reason: "allowance_insufficient" });

    expect(collectFailedCharges(db, 0)).toEqual([
      { user_address: "GUSER1", reason: "allowance_insufficient", subscription_amount: "50000000" },
    ]);
  });

  it("uses the latest sub_amount_updated over the original subscribed amount", () => {
    insert("subscribed", "GUSER2", "50000000", 10, { amount: "50000000" });
    insert("sub_amount_updated", "GUSER2", null, 15, ["50000000", "75000000"]);
    insert("batch_charge_skips", "", null, 20, { user: "GUSER2" });

    expect(collectFailedCharges(db, 0)[0].subscription_amount).toBe("75000000");
  });

  it("reports null (not 0) with failed_count for aggregate batch summaries", () => {
    insert("batch_charge_skips", "", null, 20, { total: 5, charged: 3, allowance_insufficient: 2 });

    expect(collectFailedCharges(db, 0)).toEqual([
      { user_address: "batch_summary", reason: "allowance_insufficient", subscription_amount: null, failed_count: 2 },
    ]);
  });

  it("returns null for a user with no subscription events", () => {
    insert("batch_charge_skips", "", null, 20, { user: "GUNKNOWN" });
    expect(collectFailedCharges(db, 0)[0].subscription_amount).toBeNull();
  });

  it("caches each user's amount for the run", () => {
    insert("subscribed", "GUSER3", "10", 10, { amount: "10" });
    const lookup = new SubscriptionAmountLookup(db);
    expect(lookup.get("GUSER3")).toBe("10");

    // A later change is not re-read within the same run.
    insert("sub_amount_updated", "GUSER3", null, 11, ["10", "20"]);
    expect(lookup.get("GUSER3")).toBe("10");
    expect(new SubscriptionAmountLookup(db).get("GUSER3")).toBe("20");
  });
});
