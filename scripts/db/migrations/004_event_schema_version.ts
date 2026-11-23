/**
 * Migration 004 — persist the contract event schema version (schema_version 4).
 * Existing rows are historical v1 events; new versioned contract events carry
 * a `v2` topic and are stored with schema_version=2.
 */
import type { Migration } from "./types.js";

export const migration004: Migration = {
  version: 4,
  name: "event_schema_version",
  up: (db) => {
    const existing = new Set(
      (db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    if (!existing.has("schema_version")) {
      db.exec("ALTER TABLE events ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1");
    }
  },
};
