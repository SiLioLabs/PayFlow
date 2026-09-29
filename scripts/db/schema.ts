/**
 * db/schema.ts — Re-exports the canonical SQLite schema helpers from indexer.ts
 * so that tests and tooling can import them from a stable, dedicated path.
 *
 * The single source of truth for the DB schema stays in indexer.ts:
 *   - `openDatabase`  — open (or create) the SQLite file with the right PRAGMAs
 *   - `initSchema`    — CREATE TABLE / migration logic (schema_version gate)
 *   - `getMeta`       — read a key from the meta table
 *   - `setMeta`       — upsert a key in the meta table
 *   - `upsertEvents`  — write a batch of IndexedEvent rows
 *   - `parseEvent`    — parse a raw RPC event object into an IndexedEvent
 *   - `stableEventKey`— derive the dedup id from an RPC event
 *   - `indexEvents`   — layered-dedup write path (EventDedupCache + upsert)
 */

export {
  openDatabase,
  initSchema,
  getMeta,
  setMeta,
  upsertEvents,
  parseEvent,
  stableEventKey,
  indexEvents,
  type DedupIndexResult,
} from "../indexer.js";
