#!/usr/bin/env tsx
/**
 * horizon-backfill.ts — Recover events from ledger gaps via Horizon.
 *
 * When the indexer was down longer than Soroban RPC retention, `ledger-gaps.ts`
 * records the unreachable ledger range in `ledger_gaps`. getEvents cannot serve
 * those ledgers any more, but a Horizon instance with full history can: this
 * script walks each ledger in an open gap, decodes the Soroban contract events
 * from every successful transaction's result meta, and feeds them through the
 * normal indexer write path (`indexEvents`), which upserts on the chain-derived
 * event id — so re-running, overlapping ranges, or events the indexer already
 * has can never create duplicates.
 *
 * Usage:
 *   CONTRACT_ID=<id> HORIZON_URL=<url> tsx horizon-backfill.ts            # all open gaps
 *   CONTRACT_ID=<id> tsx horizon-backfill.ts --gap-id 3                    # one gap
 *   tsx horizon-backfill.ts --list                                         # show gaps, no network
 *
 * Environment variables:
 *   CONTRACT_ID   Required (except --list). Contract whose events are recovered.
 *   HORIZON_URL   Horizon base URL (default: https://horizon-testnet.stellar.org).
 *   DATA_DIR / DB_FILE   Same as indexer.ts.
 *
 * Exit codes: 0 all processed gaps backfilled; 1 usage error or a gap failed /
 * is unrecoverable (see logs).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";
import { logger as rootLogger } from "./logger.js";
import { EventDedupCache } from "./event-dedup.js";
import { initSchema, indexEvents, openDatabase } from "./indexer.js";
import { listGaps, resolveGap, updateGapProgress, type LedgerGap } from "./ledger-gaps.js";

const logger = rootLogger.child({ script: "horizon-backfill" });

const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
const PAGE_LIMIT = 200;

// ── Horizon access ───────────────────────────────────────────────────────────

/** Subset of a Horizon transaction record used here. */
export interface HorizonTransaction {
  hash: string;
  ledger: number;
  successful: boolean;
  created_at: string;
  /** TOID of the transaction: ledger << 32 | application order << 12. */
  paging_token: string;
  result_meta_xdr?: string;
}

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Thrown when Horizon does not hold the requested ledger (history pruned). */
export class HorizonHistoryUnavailableError extends Error {}

/** Fetch every transaction of `ledger`, following Horizon pagination. */
export async function fetchLedgerTransactions(
  horizonUrl: string,
  ledger: number,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<HorizonTransaction[]> {
  const base = horizonUrl.replace(/\/+$/, "");
  let url: string | undefined = `${base}/ledgers/${ledger}/transactions?limit=${PAGE_LIMIT}&order=asc&include_failed=false`;
  const out: HorizonTransaction[] = [];
  const seen = new Set<string>();

  while (url && !seen.has(url)) {
    seen.add(url);
    const res = await fetchFn(url);
    if (res.status === 404) {
      throw new HorizonHistoryUnavailableError(`Horizon has no data for ledger ${ledger}`);
    }
    if (!res.ok) throw new Error(`Horizon returned HTTP ${res.status} for ledger ${ledger}`);
    const body = (await res.json()) as {
      _embedded?: { records?: HorizonTransaction[] };
      _links?: { next?: { href?: string } };
    };
    const records = body._embedded?.records ?? [];
    out.push(...records);
    url = records.length === PAGE_LIMIT ? body._links?.next?.href : undefined;
  }
  return out;
}

// ── Decoding ─────────────────────────────────────────────────────────────────

/** Convert a decoded ScVal into plain JSON (bigint → string, bytes → hex). */
export function toJsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), toJsonSafe(x)]));
  if (Array.isArray(v)) return v.map(toJsonSafe);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJsonSafe(x)]));
  }
  return v;
}

function topicToString(v: xdr.ScVal): string {
  const native = toJsonSafe(scValToNative(v));
  return typeof native === "string" ? native : JSON.stringify(native);
}

/**
 * Decode the contract events emitted by `contractId` in one transaction into the
 * raw shape `parseEvent` consumes (the same shape Soroban RPC returns), with an
 * `id` of `<TOID>-<event index>` so `stableEventKey` yields the key RPC would
 * have produced for the same event. Returns [] for failed / non-Soroban txs.
 */
export function decodeTransactionEvents(
  tx: HorizonTransaction,
  contractId: string,
): Record<string, unknown>[] {
  if (!tx.successful || !tx.result_meta_xdr) return [];

  let events: xdr.ContractEvent[];
  try {
    const meta = xdr.TransactionMeta.fromXDR(tx.result_meta_xdr, "base64");
    if (meta.switch() !== 3) return [];
    events = meta.v3().sorobanMeta()?.events() ?? [];
  } catch (err) {
    logger.warn("Could not decode transaction meta", {
      tx_hash: tx.hash,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const toid = BigInt(tx.paging_token).toString().padStart(19, "0");
  const closedAt = tx.created_at;
  const out: Record<string, unknown>[] = [];

  events.forEach((ev, index) => {
    const id = ev.contractId();
    if (!id || StrKey.encodeContract(id) !== contractId) return;
    if (ev.type().name !== "contract") return;
    const body = ev.body().v0();
    const eventId = `${toid}-${String(index).padStart(10, "0")}`;
    out.push({
      id: eventId,
      pagingToken: eventId,
      txHash: tx.hash,
      ledger: Number(tx.ledger),
      ledgerClosedAt: closedAt,
      topic: body.topics().map(topicToString),
      value: toJsonSafe(scValToNative(body.data())),
    });
  });
  return out;
}

// ── Backfill ─────────────────────────────────────────────────────────────────

export interface BackfillOptions {
  contractId: string;
  horizonUrl: string;
  fetchFn?: FetchLike;
  /** Called after each ledger (for progress output). */
  onProgress?: (ledger: number) => void;
}

export interface BackfillResult {
  gapId: number;
  status: "backfilled" | "unrecoverable" | "interrupted";
  ledgersScanned: number;
  eventsWritten: number;
  detail?: string;
}

/**
 * Backfill one gap. Resumes after `backfilled_through` when a previous run was
 * interrupted. Progress is persisted after every ledger; the gap is only marked
 * `backfilled` once its last ledger was read. A transient Horizon error leaves
 * the gap `open` (status "interrupted") so it can simply be re-run; a 404 marks
 * it `unrecoverable`.
 */
export async function backfillGap(
  db: DatabaseSync,
  gap: LedgerGap,
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const dedup = new EventDedupCache();
  const first = gap.backfilled_through !== null ? gap.backfilled_through + 1 : gap.start_ledger;
  let scanned = 0;
  let written = 0;

  for (let ledger = first; ledger <= gap.end_ledger; ledger++) {
    let txs: HorizonTransaction[];
    try {
      txs = await fetchLedgerTransactions(opts.horizonUrl, ledger, opts.fetchFn);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (err instanceof HorizonHistoryUnavailableError) {
        resolveGap(db, gap.id, "unrecoverable", detail);
        logger.error("Gap is unrecoverable from this Horizon", { gap_id: gap.id, ledger, detail });
        return { gapId: gap.id, status: "unrecoverable", ledgersScanned: scanned, eventsWritten: written, detail };
      }
      logger.error("Backfill interrupted; re-run to resume", { gap_id: gap.id, ledger, detail });
      return { gapId: gap.id, status: "interrupted", ledgersScanned: scanned, eventsWritten: written, detail };
    }

    const raw = txs.flatMap((tx) => decodeTransactionEvents(tx, opts.contractId));
    const result = indexEvents(db, dedup, raw);
    written += result.written;
    scanned++;
    updateGapProgress(db, gap.id, ledger, result.written);
    opts.onProgress?.(ledger);
  }

  resolveGap(db, gap.id, "backfilled");
  logger.info("Gap backfilled", {
    gap_id: gap.id,
    start_ledger: gap.start_ledger,
    end_ledger: gap.end_ledger,
    events_written: written,
  });
  return { gapId: gap.id, status: "backfilled", ledgersScanned: scanned, eventsWritten: written };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function formatGap(g: LedgerGap): string {
  const progress = g.backfilled_through !== null ? ` through=${g.backfilled_through}` : "";
  return `#${g.id} ledgers ${g.start_ledger}-${g.end_ledger} [${g.status}]${progress} recovered=${g.events_recovered}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbFile = process.env.DB_FILE ?? resolve(process.env.DATA_DIR ?? "data", "events.db");
  const gapIdArg = args.indexOf("--gap-id");
  const gapId = gapIdArg >= 0 ? parseInt(args[gapIdArg + 1] ?? "", 10) : undefined;
  if (gapIdArg >= 0 && !Number.isInteger(gapId)) {
    console.error("Error: --gap-id requires an integer");
    process.exit(1);
  }

  const db = openDatabase(dbFile);
  initSchema(db);

  if (args.includes("--list")) {
    const gaps = listGaps(db);
    console.log(gaps.length ? gaps.map(formatGap).join("\n") : "No ledger gaps recorded.");
    db.close();
    return;
  }

  const contractId = process.env.CONTRACT_ID ?? "";
  if (!contractId) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    process.exit(1);
  }
  const horizonUrl = process.env.HORIZON_URL ?? DEFAULT_HORIZON_URL;

  const gaps = listGaps(db, "open").filter((g) => gapId === undefined || g.id === gapId);
  if (gaps.length === 0) {
    console.log("No open ledger gaps to backfill.");
    db.close();
    return;
  }

  let failed = false;
  for (const gap of gaps) {
    console.log(`Backfilling ${formatGap(gap)} from ${horizonUrl}`);
    const r = await backfillGap(db, gap, { contractId, horizonUrl });
    console.log(`  → ${r.status}: ${r.ledgersScanned} ledgers scanned, ${r.eventsWritten} events written`);
    if (r.status !== "backfilled") failed = true;
  }
  db.close();
  process.exit(failed ? 1 : 0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
