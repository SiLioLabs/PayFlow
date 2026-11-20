/**
 * Migration 003 — ledger_gaps table (schema_version 3).
 *
 * One row per contiguous range of ledgers the indexer could not read because
 * the RPC provider had already pruned them. Backfill progress is persisted so
 * an interrupted backfill resumes where it stopped.
 */
import type { Migration } from "./types.js";

export const migration003: Migration = {
  version: 3,
  name: "ledger_gaps",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_gaps (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        start_ledger      INTEGER NOT NULL,
        end_ledger        INTEGER NOT NULL,
        detected_at       INTEGER NOT NULL,
        status            TEXT    NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'backfilled', 'unrecoverable')),
        backfilled_through INTEGER,
        events_recovered  INTEGER NOT NULL DEFAULT 0,
        resolved_at       INTEGER,
        detail            TEXT,
        UNIQUE (start_ledger, end_ledger)
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_gaps_status ON ledger_gaps(status);
    `);
  },
};
