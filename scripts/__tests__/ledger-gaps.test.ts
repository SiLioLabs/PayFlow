/**
 * Ledger gap detection, persistence, metrics and Horizon backfill.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema, openDatabase, getMeta } from "../indexer.js";
import {
  checkForGap,
  detectGap,
  fetchLedgerRange,
  listGaps,
  recordGap,
} from "../ledger-gaps.js";
import {
  backfillGap,
  decodeTransactionEvents,
  fetchLedgerTransactions,
  type FetchLike,
  type HorizonTransaction,
} from "../horizon-backfill.js";
import { metricsText } from "../metrics-server.js";
import type { DatabaseSync } from "node:sqlite";

const CONTRACT_BYTES = Buffer.alloc(32, 7);
const CONTRACT_ID = StrKey.encodeContract(CONTRACT_BYTES);
const OTHER_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));
const USER = Keypair.random().publicKey();

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "payflow-gaps-"));
  db = openDatabase(join(dir, "events.db"));
  initSchema(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── Fixtures ────────────────────────────────────────────────────────────────

function contractEvent(contract: Buffer, name: string, amount: bigint): xdr.ContractEvent {
  return new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: contract,
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({
        topics: [
          nativeToScVal(name, { type: "symbol" }),
          nativeToScVal(USER, { type: "address" }),
        ],
        data: nativeToScVal({ amount }, { type: { amount: ["symbol", "i128"] } }),
      }),
    ),
  });
}

function metaXdr(events: xdr.ContractEvent[]): string {
  const sorobanMeta = new xdr.SorobanTransactionMeta({
    ext: new xdr.SorobanTransactionMetaExt(0),
    events,
    returnValue: xdr.ScVal.scvVoid(),
    diagnosticEvents: [],
  });
  const v3 = new xdr.TransactionMetaV3({
    ext: new xdr.ExtensionPoint(0),
    txChangesBefore: [],
    operations: [],
    txChangesAfter: [],
    sorobanMeta,
  });
  return new xdr.TransactionMeta(3, v3).toXDR("base64");
}

function tx(ledger: number, order: number, events: xdr.ContractEvent[], successful = true): HorizonTransaction {
  return {
    hash: `hash-${ledger}-${order}`,
    ledger,
    successful,
    created_at: new Date(ledger * 5000).toISOString(),
    paging_token: ((BigInt(ledger) << 32n) | (BigInt(order) << 12n)).toString(),
    result_meta_xdr: metaXdr(events),
  };
}

/** Horizon fake: ledger -> transactions. Missing ledgers 404. */
function fakeHorizon(
  ledgers: Record<number, HorizonTransaction[]>,
  opts: { failAt?: number } = {},
): FetchLike & { requested: number[] } {
  const fn = (async (url: string) => {
    const ledger = Number(/\/ledgers\/(\d+)\/transactions/.exec(url)![1]);
    fn.requested.push(ledger);
    if (opts.failAt === ledger) return { ok: false, status: 503, json: async () => ({}) };
    if (!(ledger in ledgers)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ _embedded: { records: ledgers[ledger] } }) };
  }) as FetchLike & { requested: number[] };
  fn.requested = [];
  return fn;
}

const eventCount = (): number =>
  Number((db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c);

// ── Detection ───────────────────────────────────────────────────────────────

describe("detectGap", () => {
  it("reports the unreachable range when RPC oldest is newer than the cursor", () => {
    expect(detectGap(100, 150)).toEqual({ start: 100, end: 149 });
  });
  it("is not a gap exactly at the retention boundary", () => {
    expect(detectGap(150, 150)).toBeNull();
  });
  it("is not a gap when the cursor is inside the window", () => {
    expect(detectGap(200, 150)).toBeNull();
  });
  it("is not a gap for an invalid cursor", () => {
    expect(detectGap(0, 150)).toBeNull();
  });
});

describe("fetchLedgerRange", () => {
  it("reads oldest/latest from getHealth", async () => {
    const r = await fetchLedgerRange({ getHealth: async () => ({ status: "healthy", oldestLedger: 10, latestLedger: 99 }) });
    expect(r).toEqual({ oldestLedger: 10, latestLedger: 99 });
  });
  it("returns null when the provider does not report them", async () => {
    expect(await fetchLedgerRange({ getHealth: async () => ({ status: "healthy" }) })).toBeNull();
  });
});

describe("checkForGap", () => {
  const source = (oldestLedger: number) => ({
    getHealth: async () => ({ status: "healthy", oldestLedger, latestLedger: oldestLedger + 1000 }),
  });

  it("persists the gap, resumes from the oldest ledger and exports metrics", async () => {
    const resume = await checkForGap(db, 100, source(150));
    expect(resume).toBe(150);

    const gaps = listGaps(db);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ start_ledger: 100, end_ledger: 149, status: "open", events_recovered: 0 });

    const metrics = await metricsText();
    expect(metrics).toMatch(/indexer_ledger_gaps_total 1/);
    expect(metrics).toMatch(/indexer_ledger_gap_ledgers_total 50/);
    expect(metrics).toMatch(/indexer_open_ledger_gaps 1/);
    expect(metrics).toMatch(/indexer_oldest_available_ledger 150/);
  });

  it("does nothing when the cursor is within retention", async () => {
    expect(await checkForGap(db, 200, source(150))).toBe(200);
    expect(listGaps(db)).toHaveLength(0);
  });

  it("does not duplicate a gap that is detected twice", async () => {
    await checkForGap(db, 100, source(150));
    await checkForGap(db, 100, source(150));
    expect(listGaps(db)).toHaveLength(1);
  });

  it("carries on when the retention window cannot be read", async () => {
    const broken = { getHealth: async () => { throw new Error("rpc down"); } };
    expect(await checkForGap(db, 100, broken)).toBe(100);
    expect(listGaps(db)).toHaveLength(0);
  });

  it("rejects invalid ranges at the persistence layer", () => {
    expect(() => recordGap(db, 10, 5)).toThrow(/Invalid ledger gap/);
  });

  it("survives reopening the database", async () => {
    await checkForGap(db, 100, source(150));
    db.close();
    db = openDatabase(join(dir, "events.db"));
    initSchema(db);
    expect(listGaps(db, "open")).toHaveLength(1);
    expect(getMeta(db, "schema_version")).toBe("4");
  });
});

// ── Decoding ────────────────────────────────────────────────────────────────

describe("decodeTransactionEvents", () => {
  it("decodes only this contract's events into the indexer's raw shape", () => {
    const t = tx(120, 2, [
      contractEvent(CONTRACT_BYTES, "charged", 500n),
      contractEvent(Buffer.alloc(32, 9), "charged", 1n),
    ]);
    const events = decodeTransactionEvents(t, CONTRACT_ID);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      txHash: "hash-120-2",
      ledger: 120,
      topic: ["charged", USER],
      value: { amount: "500" },
    });
    expect(decodeTransactionEvents(t, OTHER_CONTRACT_ID)).toHaveLength(1);
  });

  it("ignores failed transactions and undecodable meta", () => {
    expect(decodeTransactionEvents(tx(120, 1, [contractEvent(CONTRACT_BYTES, "charged", 1n)], false), CONTRACT_ID)).toEqual([]);
    expect(decodeTransactionEvents({ ...tx(120, 1, []), result_meta_xdr: "not-xdr" }, CONTRACT_ID)).toEqual([]);
  });
});

describe("fetchLedgerTransactions", () => {
  it("follows pagination until a short page", async () => {
    const pages = [
      Array.from({ length: 200 }, (_, i) => tx(5, i + 1, [])),
      [tx(5, 201, [])],
    ];
    let call = 0;
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: { records: pages[call] },
        _links: { next: { href: `https://h.example/page${++call}` } },
      }),
    });
    expect(await fetchLedgerTransactions("https://h.example", 5, fetchFn)).toHaveLength(201);
  });
});

// ── Backfill ────────────────────────────────────────────────────────────────

describe("backfillGap", () => {
  const ledgers = () => ({
    100: [tx(100, 1, [contractEvent(CONTRACT_BYTES, "subscribed", 10n)])],
    101: [],
    102: [tx(102, 1, [contractEvent(CONTRACT_BYTES, "charged", 20n), contractEvent(CONTRACT_BYTES, "charged", 30n)])],
  });
  const opts = (fetchFn: FetchLike) => ({ contractId: CONTRACT_ID, horizonUrl: "https://h.example", fetchFn });

  it("recovers events, marks the gap backfilled and stores progress", async () => {
    const { gap } = recordGap(db, 100, 102);
    const r = await backfillGap(db, gap, opts(fakeHorizon(ledgers())));
    expect(r).toMatchObject({ status: "backfilled", ledgersScanned: 3, eventsWritten: 3 });
    expect(eventCount()).toBe(3);

    const [row] = listGaps(db);
    expect(row).toMatchObject({ status: "backfilled", backfilled_through: 102, events_recovered: 3 });
    expect(row.resolved_at).not.toBeNull();
    expect((await metricsText())).toMatch(/indexer_open_ledger_gaps 0/);
  });

  it("is safe to run twice: no duplicate rows", async () => {
    const { gap } = recordGap(db, 100, 102);
    await backfillGap(db, gap, opts(fakeHorizon(ledgers())));
    await backfillGap(db, { ...gap, backfilled_through: null }, opts(fakeHorizon(ledgers())));
    expect(eventCount()).toBe(3);
  });

  it("does not duplicate events the indexer already holds", async () => {
    const { gap } = recordGap(db, 100, 102);
    await backfillGap(db, gap, opts(fakeHorizon({ 100: ledgers()[100], 101: [], 102: [] })));
    const { gap: overlapping } = recordGap(db, 100, 101);
    await backfillGap(db, overlapping, opts(fakeHorizon(ledgers())));
    expect(eventCount()).toBe(1);
  });

  it("resumes after a transient Horizon error without rescanning", async () => {
    const { gap } = recordGap(db, 100, 102);
    const flaky = fakeHorizon(ledgers(), { failAt: 102 });
    const first = await backfillGap(db, gap, opts(flaky));
    expect(first.status).toBe("interrupted");
    expect(listGaps(db)[0]).toMatchObject({ status: "open", backfilled_through: 101 });

    const healthy = fakeHorizon(ledgers());
    const second = await backfillGap(db, listGaps(db)[0], opts(healthy));
    expect(healthy.requested).toEqual([102]);
    expect(second.status).toBe("backfilled");
    expect(eventCount()).toBe(3);
  });

  it("marks the gap unrecoverable when Horizon no longer has the ledger", async () => {
    const { gap } = recordGap(db, 100, 102);
    const r = await backfillGap(db, gap, opts(fakeHorizon({ 100: ledgers()[100] })));
    expect(r.status).toBe("unrecoverable");
    expect(listGaps(db)[0]).toMatchObject({ status: "unrecoverable", backfilled_through: 100 });
    expect(listGaps(db)[0].detail).toMatch(/ledger 101/);
  });
});
