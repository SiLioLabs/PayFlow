/**
 * Migration 002 — add merchant / fee_amount / token / result_code columns
 * (schema_version 2).
 *
 * Idempotent: each column is only added when it is missing, so databases that
 * were created by an older indexer build with the columns already present
 * (but no recorded schema_version) upgrade cleanly.
 */
import type { Migration } from "./types.js";

const COLUMNS = ["merchant", "fee_amount", "token", "result_code"] as const;

export const migration002: Migration = {
  version: 2,
  name: "add_event_columns",
  up: (db) => {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    for (const column of COLUMNS) {
      if (!existing.has(column)) {
        db.exec(`ALTER TABLE events ADD COLUMN ${column} TEXT`);
      }
    }
  },
};
