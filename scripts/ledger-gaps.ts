/**
 * ledger-gaps.ts — Detect and persist ledger gaps in the event indexer.
 *
 * Soroban RPC only retains a limited window of ledgers. If the indexer is down
 * for longer than that window, the ledgers between its last processed ledger
 * and the RPC's oldest available ledger can never be fetched via getEvents, and
 * the events in them would be lost silently. This module:
 *
 *   - detects that situation (`detectGap` / `checkForGap`),
 *   - persists each gap in the `ledger_gaps` table (`recordGap`),
 *   - exposes it through logs and Prometheus metrics, and
 *   - tracks backfill progress (`updateGapProgress` / `resolveGap`) for
 *     horizon-backfill.ts.
 *
 * Cursor semantics: `meta.last_ledger` is the NEXT ledger to fetch, so the last
 * fully processed ledger is `last_ledger - 1` (also stored as
 * `meta.last_processed_ledger`).
 */
import type { DatabaseSync } from "node:sqlite";
import { logger as rootLogger } from "./logger.js";
import { recordLedgerGap, setOpenLedgerGaps, setIndexerLedgerPosition } from "./metrics-server.js";

const logger = rootLogger.child({ script: "ledger-gaps" });

export type GapStatus = "open" | "backfilled" | "unrecoverable";

export interface LedgerGap {
  id: number;
  start_ledger: number;
  end_ledger: number;
  detected_at: number;
  status: GapStatus;
  backfilled_through: number | null;
  events_recovered: number;
  resolved_at: number | null;
  detail: string | null;
}

/** Inclusive range of ledgers the RPC currently serves. */
export interface LedgerRange {
  oldestLedger: number;
  latestLedger: number;
}

/** Source of the RPC retention window (injectable for tests). */
export interface LedgerRangeSource {
  getHealth(): Promise<unknown>;
}

/**
 * Read the RPC retention window from `getHealth`. Soroban RPC returns
 * `oldestLedger` / `latestLedger` there (the SDK's typings omit them).
 * Returns null when the provider does not report them.
 */
export async function fetchLedgerRange(source: LedgerRangeSource): Promise<LedgerRange | null> {
  const health = (await source.getHealth()) as Partial<LedgerRange> | null;
  const oldest = Number(health?.oldestLedger);
  const latest = Number(health?.latestLedger);
  if (!Number.isInteger(oldest) || oldest <= 0 || !Number.isInteger(latest)) return null;
  return { oldestLedger: oldest, latestLedger: latest };
}

/**
 * Pure gap test. `nextLedger` is the next ledger the indexer needs. If the RPC's
 * oldest available ledger is newer than that, ledgers
 * `[nextLedger, oldestLedger - 1]` are unreachable.
 */
export function detectGap(
  nextLedger: number,
  oldestLedger: number,
): { start: number; end: number } | null {
  if (!(nextLedger > 0) || !(oldestLedger > nextLedger)) return null;
  return { start: nextLedger, end: oldestLedger - 1 };
}

/** Persist a gap. Idempotent on (start, end): returns the existing row if present. */
export function recordGap(
  db: DatabaseSync,
  start: number,
  end: number,
  now: number = Math.floor(Date.now() / 1000),
): { gap: LedgerGap; created: boolean } {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error(`Invalid ledger gap range ${start}-${end}`);
  }
  const res = db
    .prepare("INSERT OR IGNORE INTO ledger_gaps(start_ledger, end_ledger, detected_at) VALUES(?, ?, ?)")
    .run(start, end, now);
  const gap = db
    .prepare("SELECT * FROM ledger_gaps WHERE start_ledger = ? AND end_ledger = ?")
    .get(start, end) as unknown as LedgerGap;
  refreshOpenGapMetric(db);
  return { gap, created: Number(res.changes) > 0 };
}

export function listGaps(db: DatabaseSync, status?: GapStatus): LedgerGap[] {
  const rows = status
    ? db.prepare("SELECT * FROM ledger_gaps WHERE status = ? ORDER BY start_ledger").all(status)
    : db.prepare("SELECT * FROM ledger_gaps ORDER BY start_ledger").all();
  return rows as unknown as LedgerGap[];
}

/** Persist backfill progress so an interrupted run resumes after `through`. */
export function updateGapProgress(
  db: DatabaseSync,
  id: number,
  through: number,
  eventsRecoveredDelta: number,
): void {
  db.prepare(
    "UPDATE ledger_gaps SET backfilled_through = ?, events_recovered = events_recovered + ? WHERE id = ?",
  ).run(through, eventsRecoveredDelta, id);
}

export function resolveGap(
  db: DatabaseSync,
  id: number,
  status: Exclude<GapStatus, "open">,
  detail: string | null = null,
  now: number = Math.floor(Date.now() / 1000),
): void {
  db.prepare("UPDATE ledger_gaps SET status = ?, resolved_at = ?, detail = ? WHERE id = ?").run(
    status,
    now,
    detail,
    id,
  );
  refreshOpenGapMetric(db);
}

export function refreshOpenGapMetric(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS c FROM ledger_gaps WHERE status = 'open'").get() as {
    c: number;
  };
  setOpenLedgerGaps(Number(row.c));
}

/**
 * Check whether `nextLedger` is still within RPC retention. On a gap, persist
 * it, log it, bump metrics and return the ledger the indexer should resume from
 * (the RPC's oldest ledger). Otherwise returns `nextLedger` unchanged.
 *
 * Pass `db = null` when the indexer runs on a backend without the SQLite
 * `ledger_gaps` table (PostgreSQL, #1484): the gap is still detected, logged,
 * counted and skipped, but not persisted for horizon-backfill.ts.
 *
 * Never throws: if the retention window cannot be read the indexer carries on
 * as before (pollOnce will surface any RPC error).
 */
export async function checkForGap(
  db: DatabaseSync | null,
  nextLedger: number,
  source: LedgerRangeSource,
): Promise<number> {
  let range: LedgerRange | null;
  try {
    range = await fetchLedgerRange(source);
  } catch (err) {
    logger.warn("Could not read RPC retention window; skipping gap check", {
      error: err instanceof Error ? err.message : String(err),
    });
    return nextLedger;
  }
  if (!range) return nextLedger;

  setIndexerLedgerPosition({ oldestAvailable: range.oldestLedger });
  const gap = detectGap(nextLedger, range.oldestLedger);
  if (!gap) return nextLedger;

  const recorded = db ? recordGap(db, gap.start, gap.end) : null;
  const created = recorded?.created ?? true;
  const missed = gap.end - gap.start + 1;
  if (created) recordLedgerGap(missed);
  logger.error("Ledger gap detected: events in these ledgers are no longer available from RPC", {
    gap_id: recorded?.gap.id ?? null,
    start_ledger: gap.start,
    end_ledger: gap.end,
    missed_ledgers: missed,
    rpc_oldest_ledger: range.oldestLedger,
    rpc_latest_ledger: range.latestLedger,
    new: created,
    remedy: "run horizon-backfill.ts to recover events from Horizon",
  });
  return range.oldestLedger;
}
