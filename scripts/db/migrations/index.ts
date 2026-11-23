/**
 * Ordered list of every indexer schema migration. This list — and nothing
 * else — defines the database schema. To change the schema, add a new
 * numbered file and append it here; SCHEMA_VERSION follows automatically.
 */
import type { Migration } from "./types.js";
import { migration001 } from "./001_initial_schema.js";
import { migration002 } from "./002_add_event_columns.js";
import { migration003 } from "./003_ledger_gaps.js";
import { migration004 } from "./004_event_schema_version.js";

export type { Migration } from "./types.js";

export const migrations: readonly Migration[] = [migration001, migration002, migration003, migration004];

/** Latest schema version, derived from the migration list. */
export const SCHEMA_VERSION: number = migrations[migrations.length - 1].version;
