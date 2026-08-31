#!/usr/bin/env tsx
/**
 * query-events.ts — CLI for querying the FlowPay event indexer database
 *
 * Provides four query modes against the SQLite database written by indexer.ts:
 *
 *   --address  <G...>          All events for a subscriber/actor address
 *   --type     <event_name>    All events of a given type (e.g. "charged")
 *   --ledger   <n> [--to <n>] Events in a ledger range (single or from–to)
 *   --recent   [n]             Most recent N events (default 20)
 *
 * Output is JSON by default; add --pretty for formatted JSON.
 *
 * Usage:
 *   tsx query-events.ts --address GXYZ...
 *   tsx query-events.ts --type charged --pretty
 *   tsx query-events.ts --ledger 500000 --to 510000
 *   tsx query-events.ts --recent 50 --pretty
 *
 * Environment variables:
 *   DATA_DIR   Directory containing events.db (default: data).
 *   DB_FILE    Full path override for the SQLite DB file.
 *
 * Exit codes:
 *   0 — query completed (even if zero results)
 *   1 — bad arguments or DB error
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ── Configuration ─────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? "data";
const DB_FILE = process.env.DB_FILE ?? resolve(DATA_DIR, "events.db");

/** Maximum rows returned by any single query (safety cap). */
const MAX_ROWS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  event_name: string;
  address: string;
  amount: string | null;
  ledger: number;
  timestamp: number;
  tx_hash: string;
  raw_data: string;
  merchant: string | null;
  fee_amount: string | null;
  token: string | null;
  result_code: string | null;
}

interface QueryResult {
  query: string;
  params: Record<string, unknown>;
  count: number;
  events: EventRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showHelp(): never {
  console.log(`
Usage: tsx query-events.ts <mode> [options]

Query modes (exactly one required):
  --address  <G...>          Events for a specific address
  --type     <event_name>    Events of a specific type  (e.g. charged, subscribed)
  --ledger   <n>             Events in a single ledger
  --ledger   <n> --to <n>   Events in a ledger range (inclusive)
  --recent   [n]             Most recent N events (default: 20, max: ${MAX_ROWS})

Options:
  --limit    <n>             Cap the number of rows returned (default: ${MAX_ROWS})
  --pretty                   Pretty-print JSON output
  --help, -h                 Show this help

Environment variables:
  DATA_DIR   Directory containing events.db (default: data)
  DB_FILE    Full path to the SQLite DB file (overrides DATA_DIR)

Examples:
  tsx query-events.ts --address GXYZ...
  tsx query-events.ts --type charged --pretty
  tsx query-events.ts --ledger 500000 --to 510000 --limit 100
  tsx query-events.ts --recent 50 --pretty
  `);
  process.exit(0);
}

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  console.error("Run with --help for usage.");
  process.exit(1);
}

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

// ── Query Functions ───────────────────────────────────────────────────────────

/**
 * Returns events where `address` matches the given G-address.
 */
function queryByAddress(
  db: DatabaseSync,
  address: string,
  limit: number,
): EventRow[] {
  return db
    .prepare(
      `SELECT id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount, token, result_code
       FROM events
       WHERE address = ?
       ORDER BY ledger DESC, rowid DESC
       LIMIT ?`,
    )
    .all(address, limit) as unknown as EventRow[];
}

/**
 * Returns events of a specific event_name (e.g. "charged", "subscribed").
 */
function queryByType(
  db: DatabaseSync,
  eventName: string,
  limit: number,
): EventRow[] {
  return db
    .prepare(
      `SELECT id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount, token, result_code
       FROM events
       WHERE event_name = ?
       ORDER BY ledger DESC, rowid DESC
       LIMIT ?`,
    )
    .all(eventName, limit) as unknown as EventRow[];
}

/**
 * Returns events within an inclusive ledger range [fromLedger, toLedger].
 */
function queryByLedgerRange(
  db: DatabaseSync,
  fromLedger: number,
  toLedger: number,
  limit: number,
): EventRow[] {
  return db
    .prepare(
      `SELECT id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount, token, result_code
       FROM events
       WHERE ledger >= ? AND ledger <= ?
       ORDER BY ledger ASC, rowid ASC
       LIMIT ?`,
    )
    .all(fromLedger, toLedger, limit) as unknown as EventRow[];
}

/**
 * Returns the most recent N events ordered by ledger descending.
 */
function queryRecent(db: DatabaseSync, n: number): EventRow[] {
  return db
    .prepare(
      `SELECT id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount, token, result_code
       FROM events
       ORDER BY ledger DESC, rowid DESC
       LIMIT ?`,
    )
    .all(n) as unknown as EventRow[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    showHelp();
  }

  // Validate DB exists.
  if (!existsSync(DB_FILE)) {
    fail(
      `Database not found at "${DB_FILE}". ` +
        `Run the indexer first, or set DATA_DIR / DB_FILE to the correct path.`,
    );
  }

  const db = new DatabaseSync(DB_FILE, { open: true });

  const pretty = hasFlag(argv, "--pretty");
  const limitArg = getArg(argv, "--limit");
  const limit = limitArg
    ? Math.min(parseInt(limitArg, 10), MAX_ROWS)
    : MAX_ROWS;

  let result: QueryResult;

  if (hasFlag(argv, "--address")) {
    const address = getArg(argv, "--address");
    if (!address) fail("--address requires a value (e.g. --address GXYZ...)");
    const events = queryByAddress(db, address, limit);
    result = {
      query: "by_address",
      params: { address, limit },
      count: events.length,
      events,
    };
  } else if (hasFlag(argv, "--type")) {
    const type = getArg(argv, "--type");
    if (!type) fail("--type requires a value (e.g. --type charged)");
    const events = queryByType(db, type, limit);
    result = {
      query: "by_type",
      params: { type, limit },
      count: events.length,
      events,
    };
  } else if (hasFlag(argv, "--ledger")) {
    const fromStr = getArg(argv, "--ledger");
    if (!fromStr) fail("--ledger requires a numeric value");
    const fromLedger = parseInt(fromStr, 10);
    if (isNaN(fromLedger) || fromLedger < 0)
      fail("--ledger must be a non-negative integer");

    const toStr = getArg(argv, "--to");
    const toLedger = toStr !== undefined ? parseInt(toStr, 10) : fromLedger;
    if (isNaN(toLedger) || toLedger < fromLedger) {
      fail("--to must be an integer >= --ledger");
    }

    const events = queryByLedgerRange(db, fromLedger, toLedger, limit);
    result = {
      query: "by_ledger_range",
      params: { from_ledger: fromLedger, to_ledger: toLedger, limit },
      count: events.length,
      events,
    };
  } else if (hasFlag(argv, "--recent")) {
    const nStr = getArg(argv, "--recent");
    const n = nStr ? Math.min(parseInt(nStr, 10), MAX_ROWS) : 20;
    if (isNaN(n) || n <= 0) fail("--recent requires a positive integer");
    const events = queryRecent(db, n);
    result = { query: "recent", params: { n }, count: events.length, events };
  } else {
    fail(
      "No query mode specified. Use --address, --type, --ledger, or --recent.",
    );
  }

  db.close();

  const output = pretty
    ? JSON.stringify(result, null, 2)
    : JSON.stringify(result);

  process.stdout.write(output + "\n");
}

main();
