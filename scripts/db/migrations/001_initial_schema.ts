/**
 * Migration 001 — initial indexer schema (schema_version 1).
 *
 * This is the canonical definition of the `meta` and `events` tables and the
 * indexes used by query-events.ts / merchant-queries.ts. Forward-only and
 * idempotent: every statement uses IF NOT EXISTS so a re-run (or an upgrade of
 * a legacy database that already has these objects) is safe.
 */
import type { Migration } from "./types.js";

export const migration001: Migration = {
  version: 1,
  name: "initial_schema",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id         TEXT    PRIMARY KEY,
        event_name TEXT    NOT NULL,
        address    TEXT    NOT NULL,
        amount     TEXT,
        ledger     INTEGER NOT NULL,
        timestamp  INTEGER NOT NULL,
        tx_hash    TEXT    NOT NULL,
        raw_data   TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_address    ON events(address);
      CREATE INDEX IF NOT EXISTS idx_events_event_name ON events(event_name);
      CREATE INDEX IF NOT EXISTS idx_events_ledger     ON events(ledger);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
    `);
  },
};
