#!/usr/bin/env tsx
/**
 * indexer.ts — Persistent event indexer for FlowPay
 *
 * Polls the Soroban RPC for contract events every POLL_INTERVAL_MS (default 10s)
 * and upserts them into a local SQLite database. On restart the indexer resumes
 * from the last indexed ledger stored in the `meta` table — no events are
 * re-fetched or duplicated.
 *
 * Database file: DATA_DIR/events.db  (default: data/events.db)
 *
 * Schema
 * ──────
 *   events     — one row per event occurrence (upsert on tx_hash + event_name)
 *   meta       — key/value store for indexer state (last_ledger, schema_version)
 *
 * Usage:
 *   CONTRACT_ID=<id> tsx indexer.ts
 *
 * Environment variables:
 *   CONTRACT_ID        Required. Deployed FlowPay contract ID.
 *   RPC_URL            Optional. Soroban RPC endpoint (default: testnet).
 *   NETWORK_PASSPHRASE Optional. Network passphrase (default: testnet).
 *   DATA_DIR           Optional. Directory for the SQLite DB file (default: data).
 *   DB_FILE            Optional. Full path override for the SQLite DB file.
 *   POLL_INTERVAL_MS   Optional. Polling interval in ms (default: 10000).
 *   START_LEDGER       Optional. Ledger to start from on first run (default: latest).
 *   LOG_LEVEL          Optional. "debug" | "info" | "error" (default: info).
 *   EVENT_DEDUP_CACHE_SIZE  Optional. Max EventDedupCache entries (default: 1000).
 *   EVENT_DEDUP_TTL_MS      Optional. EventDedupCache entry TTL in ms (default: 0 = no TTL).
 *
 * Deduplication
 * ─────────────
 * Events are deduplicated with a two-layer strategy (see event-dedup.ts):
 *   1. In-memory EventDedupCache — skips redundant DB writes for events seen
 *      earlier in the same process's uptime (cheap, but lost on restart).
 *   2. SQLite `ON CONFLICT(id)` upsert, keyed on tx_hash+event_name — the
 *      durable guarantee. Restart safety comes from this layer plus the
 *      `last_ledger` cursor in the `meta` table, not from the in-memory cache.
 * Dedup stats (hits/misses/evictions) are logged periodically and, when
 * metrics-server.ts is wired in by the caller, exported as Prometheus counters.
 *
 * Exit codes:
 *   0 — graceful shutdown (SIGINT / SIGTERM)
 *   1 — fatal error (bad config, DB failure)
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MultiEndpointServer } from "./rpc-client.js";
import { EventDedupCache, type DedupStats } from "./event-dedup.js";
import { recordIndexerDedupStats } from "./metrics-server.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "10000", 10);
const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info") as
  "debug" | "info" | "error";

const DATA_DIR = process.env.DATA_DIR ?? "data";
const DB_FILE = process.env.DB_FILE ?? resolve(DATA_DIR, "events.db");

/** Schema version — increment when adding columns or new tables. */
const SCHEMA_VERSION = 2;

/**
 * Number of unique events processed between periodic dedup-stats log lines
 * and metrics-server snapshots.
 */
const DEDUP_STATS_LOG_INTERVAL = 100;

// CONTRACT_ID is read here but only validated inside main() — this lets the
// module be imported (e.g. by tests) without requiring the env var or
// exiting the process.
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";

// ── Logging ───────────────────────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, error: 2 } as const;
const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

function log(level: "debug" | "info" | "error", msg: string): void {
  if (LEVELS[level] >= currentLevel) {
    const ts = new Date().toISOString();
    const out = `${ts} [${level.toUpperCase()}] ${msg}`;
    if (level === "error") {
      console.error(out);
    } else {
      console.log(out);
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** A fully parsed event ready for database insertion. */
interface IndexedEvent {
  /** Stable dedup key: "<tx_hash>:<event_name>" */
  id: string;
  event_name: string;
  /** Primary address from topic[1] (subscriber or actor). */
  address: string;
  /** Numeric amount in stroops, if present in the event value. */
  amount: string | null;
  ledger: number;
  /** Unix seconds from ledgerClosedAt. */
  timestamp: number;
  tx_hash: string;
  /** Full JSON-serialised raw event value for ad-hoc queries. */
  raw_data: string;
  merchant: string | null;
  fee_amount: string | null;
  token: string | null;
  result_code: string | null;
}

// ── Database Setup ────────────────────────────────────────────────────────────

export function openDatabase(filePath: string): DatabaseSync {
  // Ensure the parent directory exists.
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);

  // WAL mode: safe for concurrent readers while the indexer writes.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");

  return db;
}

/**
 * Create tables and apply migrations if the schema version has changed.
 * Adding new columns/tables here is the only required migration step.
 */
export function initSchema(db: DatabaseSync): void {
  // meta table — key/value pairs for indexer state.
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // events table — one row per unique (tx_hash, event_name) pair.
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

  // Indexes for the query-events.ts access patterns.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_address    ON events(address);
    CREATE INDEX IF NOT EXISTS idx_events_event_name ON events(event_name);
    CREATE INDEX IF NOT EXISTS idx_events_ledger     ON events(ledger);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp)
  `);

  // Store the schema version so future migrations can guard on it.
  const existingVersion = getMeta(db, "schema_version");
  if (existingVersion === null) {
    setMeta(db, "schema_version", String(SCHEMA_VERSION));
    log("info", `Database schema initialised at version ${SCHEMA_VERSION}.`);
  } else if (parseInt(existingVersion, 10) < SCHEMA_VERSION) {
    if (parseInt(existingVersion, 10) === 1) {
      db.exec(`
        ALTER TABLE events ADD COLUMN merchant TEXT;
        ALTER TABLE events ADD COLUMN fee_amount TEXT;
        ALTER TABLE events ADD COLUMN token TEXT;
        ALTER TABLE events ADD COLUMN result_code TEXT;
      `);
    }
    // Future migrations would go here, guarded by the version number.
    setMeta(db, "schema_version", String(SCHEMA_VERSION));
    log("info", `Database schema migrated to version ${SCHEMA_VERSION}.`);
  }
}

// ── Meta Key/Value Helpers ────────────────────────────────────────────────────

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

// ── Event Parsing ─────────────────────────────────────────────────────────────

/**
 * Extract a string field from a raw event value object, trying common field
 * names used by the FlowPay contract events.
 */
function extractField(value: unknown, fields: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  for (const field of fields) {
    const candidate =
      v[field] ?? (v["_value"] as Record<string, unknown> | undefined)?.[field];
    if (candidate !== undefined && candidate !== null) {
      return String(candidate);
    }
  }
  return null;
}

/**
 * Extract a numeric string from a raw event value object, trying common field
 * names used by the FlowPay contract events.
 */
function extractAmount(value: unknown): string | null {
  return extractField(value, ["amount", "gross", "net", "fee"]);
}

/**
 * Parse the ledger close timestamp from a raw RPC event.
 * The SDK field is `ledgerClosedAt` (ISO string) as of @stellar/stellar-sdk ^12.
 */
function parseTimestamp(event: Record<string, unknown>): number {
  const raw = event["ledgerClosedAt"];
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    if (!isNaN(ms)) return Math.floor(ms / 1000);
  }
  // Fallback for older SDK shapes
  const legacy = event["ledgerCloseTime"];
  if (typeof legacy === "number") return legacy;
  if (typeof legacy === "string") return parseInt(legacy, 10) || 0;
  return 0;
}

/**
 * Convert a raw RPC event object into an IndexedEvent.
 * Returns null if the event cannot be meaningfully parsed (malformed topic).
 */
export function parseEvent(raw: Record<string, unknown>): IndexedEvent | null {
  const topic = raw["topic"] as unknown[] | undefined;
  if (!Array.isArray(topic) || topic.length < 1) return null;

  const event_name = topic[0]?.toString() ?? "";
  if (!event_name) return null;

  const address = topic[1]?.toString() ?? "";
  const ledger = typeof raw["ledger"] === "number" ? raw["ledger"] : 0;
  const tx_hash = (raw["txHash"] ?? raw["id"] ?? "") as string;
  const timestamp = parseTimestamp(raw);
  const amount = extractAmount(raw["value"]);

  const merchant = extractField(raw["value"], ["merchant", "merchant_id"]);
  const fee_amount = extractField(raw["value"], ["fee_amount", "fee"]);
  const token = extractField(raw["value"], ["token", "asset"]);
  const result_code = extractField(raw["value"], ["result_code", "error", "error_code", "status"]);

  // Stable dedup key: same tx + same event name = same row.
  const id = `${tx_hash}:${event_name}`;

  let raw_data: string;
  try {
    raw_data = JSON.stringify(raw["value"] ?? null);
  } catch {
    raw_data = "null";
  }

  return {
    id,
    event_name,
    address,
    amount,
    ledger,
    timestamp,
    tx_hash,
    raw_data,
    merchant,
    fee_amount,
    token,
    result_code,
  };
}

// ── Database Writes ───────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO events(id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount, token, result_code)
  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    address   = excluded.address,
    amount    = excluded.amount,
    ledger    = excluded.ledger,
    timestamp = excluded.timestamp,
    tx_hash   = excluded.tx_hash,
    raw_data  = excluded.raw_data,
    merchant  = excluded.merchant,
    fee_amount = excluded.fee_amount,
    token     = excluded.token,
    result_code = excluded.result_code
`;

/**
 * Upsert a batch of events inside a single transaction for throughput.
 * Returns the number of rows actually written (new inserts + updates).
 */
export function upsertEvents(db: DatabaseSync, events: IndexedEvent[]): number {
  if (events.length === 0) return 0;
  const stmt = db.prepare(INSERT_SQL);
  db.exec("BEGIN");
  try {
    for (const e of events) {
      stmt.run(
        e.id,
        e.event_name,
        e.address,
        e.amount,
        e.ledger,
        e.timestamp,
        e.tx_hash,
        e.raw_data,
        e.merchant,
        e.fee_amount,
        e.token,
        e.result_code,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return events.length;
}

// ── Deduplication ────────────────────────────────────────────────────────────

/** Result of running a batch of raw events through the layered dedup pipeline. */
export interface DedupIndexResult {
  /** Rows actually written to the DB (new inserts + updates to changed rows). */
  written: number;
  /** Events skipped because the in-memory EventDedupCache had already seen them. */
  duplicatesSkipped: number;
  /** Events that failed to parse (malformed topic) and were dropped. */
  unparsed: number;
}

/**
 * Parse raw RPC events, filter out duplicates via the in-memory
 * EventDedupCache, and upsert the remaining unique events into the DB.
 *
 * This is the layered dedup strategy from issue #078:
 *   - Layer 1 (in-memory): `dedup.checkAndRecord` skips a DB write entirely
 *     for events already seen earlier in this process's uptime.
 *   - Layer 2 (DB): `upsertEvents`'s `ON CONFLICT(id)` still guards against
 *     duplicates that layer 1 misses — e.g. right after a restart, when the
 *     in-memory cache is empty but the DB already has the row.
 *
 * Kept separate from `pollOnce` so it can be exercised directly in tests
 * without going through the RPC client.
 */
export function indexEvents(
  db: DatabaseSync,
  dedup: EventDedupCache,
  rawEvents: Record<string, unknown>[],
): DedupIndexResult {
  const parsed: IndexedEvent[] = [];
  let duplicatesSkipped = 0;
  let unparsed = 0;

  for (const raw of rawEvents) {
    const event = parseEvent(raw);
    if (!event) {
      unparsed++;
      continue;
    }

    // checkAndRecord returns true when this (tx_hash, event_name, ledger)
    // combination is already in the cache — skip the redundant DB write.
    if (dedup.checkAndRecord(event.tx_hash, event.event_name, event.ledger)) {
      duplicatesSkipped++;
      continue;
    }

    parsed.push(event);
  }

  const written = upsertEvents(db, parsed);
  return { written, duplicatesSkipped, unparsed };
}

// ── Polling Loop ──────────────────────────────────────────────────────────────

const server = new MultiEndpointServer();

/** Unique events processed since the last dedup-stats log/metrics snapshot. */
let eventsSinceLastStatsLog = 0;

/**
 * Log a periodic dedup-stats line and push a snapshot to metrics-server,
 * throttled to roughly every `DEDUP_STATS_LOG_INTERVAL` unique events.
 */
function maybeReportDedupStats(dedup: EventDedupCache, forceLog = false): void {
  const stats: DedupStats = dedup.stats;

  // metrics-server counters are cheap in-memory updates — safe to call
  // every poll regardless of the log throttle below.
  recordIndexerDedupStats(stats);

  if (!forceLog && eventsSinceLastStatsLog < DEDUP_STATS_LOG_INTERVAL) return;
  eventsSinceLastStatsLog = 0;

  log(
    "info",
    `[dedup] ${stats.deduplicatedTotal} duplicates skipped, ` +
      `${stats.totalProcessed} unique processed, ` +
      `${stats.size}/${stats.maxSize} cache entries, ` +
      `${stats.evictions} evictions`,
  );
}

/**
 * Fetch one page of events starting from `fromLedger`, deduplicate and
 * upsert them into the DB, and return the new cursor ledger to resume from
 * next time.
 */
async function pollOnce(
  db: DatabaseSync,
  fromLedger: number,
  dedup: EventDedupCache,
): Promise<number> {
  log("debug", `Polling from ledger ${fromLedger}...`);

  let response: Awaited<ReturnType<typeof server.getEvents>>;
  try {
    response = await server.getEvents({
      startLedger: fromLedger,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 200,
    });
  } catch (err) {
    log(
      "error",
      `RPC getEvents failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Return the same ledger so we retry next tick rather than skipping ahead.
    return fromLedger;
  }

  const rawEvents = response.events as unknown as Record<string, unknown>[];
  const { written, duplicatesSkipped, unparsed } = indexEvents(db, dedup, rawEvents);

  if (written > 0 || duplicatesSkipped > 0) {
    log(
      "info",
      `Ledger ${fromLedger}: upserted ${written} event(s), ` +
        `skipped ${duplicatesSkipped} duplicate(s)` +
        (unparsed > 0 ? `, dropped ${unparsed} unparsable` : "") +
        ".",
    );
  }

  eventsSinceLastStatsLog += written + duplicatesSkipped;
  maybeReportDedupStats(dedup);

  // Advance cursor to latestLedger + 1 so the next poll only sees new ledgers.
  // If the RPC returned no events it still advances, preventing stuck cursors.
  const nextLedger =
    response.latestLedger > 0 ? response.latestLedger + 1 : fromLedger + 1;

  return nextLedger;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function resolveStartLedger(): Promise<number> {
  // If the env var is set, use it directly (useful for backfill).
  if (process.env.START_LEDGER) {
    const n = parseInt(process.env.START_LEDGER, 10);
    if (n > 0) return n;
  }
  // Default: start from the current tip so we don't replay the entire chain.
  const latest = await server.getLatestLedger();
  return latest.sequence;
}

async function main(): Promise<void> {
  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    console.error("Usage: CONTRACT_ID=<id> tsx indexer.ts");
    process.exit(1);
  }

  log("info", "FlowPay Event Indexer starting.");
  log("info", `RPC:      ${RPC_URL}`);
  log("info", `Contract: ${CONTRACT_ID}`);
  log("info", `DB:       ${DB_FILE}`);
  log("info", `Interval: ${POLL_INTERVAL_MS}ms`);

  const db = openDatabase(DB_FILE);
  initSchema(db);

  const dedup = new EventDedupCache();
  log(
    "info",
    `Dedup cache: ${dedup.stats.maxSize} entries` +
      (process.env.EVENT_DEDUP_TTL_MS ? `, TTL: ${process.env.EVENT_DEDUP_TTL_MS}ms` : ""),
  );

  // Determine the ledger to resume from.
  const savedLedger = getMeta(db, "last_ledger");
  let currentLedger: number;
  if (savedLedger !== null) {
    currentLedger = parseInt(savedLedger, 10);
    log("info", `Resuming from ledger ${currentLedger} (stored in DB).`);
  } else {
    currentLedger = await resolveStartLedger();
    log("info", `First run — starting from ledger ${currentLedger}.`);
    setMeta(db, "last_ledger", String(currentLedger));
  }

  // Graceful shutdown on SIGINT (Ctrl-C) and SIGTERM.
  let shutdown = false;
  const handleSignal = (): void => {
    log(
      "info",
      "Shutdown signal received. Finishing current poll then exiting.",
    );
    shutdown = true;
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  log("info", "Indexer running. Press Ctrl-C to stop.");

  while (!shutdown) {
    const nextLedger = await pollOnce(db, currentLedger, dedup);

    if (nextLedger !== currentLedger) {
      currentLedger = nextLedger;
      setMeta(db, "last_ledger", String(currentLedger));
    }

    if (!shutdown) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }
  }

  // Final stats line so the last stretch of activity (< DEDUP_STATS_LOG_INTERVAL
  // events) still gets reported before the process exits.
  maybeReportDedupStats(dedup, /* forceLog */ true);

  db.close();
  log("info", `Indexer stopped. Last indexed ledger: ${currentLedger}.`);
  process.exit(0);
}

// ESM entrypoint guard: only auto-run main() when this file is executed
// directly (`tsx indexer.ts`), not when it's imported — e.g. by tests, which
// import parseEvent/upsertEvents/indexEvents/etc. without wanting a live
// RPC-polling process or a CONTRACT_ID requirement.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(
      `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
