/**
 * Restart-idempotency and convergence tests for scripts/indexer.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventDedupCache } from "../event-dedup.js";
import {
  initSchema,
  openDatabase,
  parseEvent,
  pollOnce,
  stableEventKey,
  type EventSource,
} from "../indexer.js";

interface FakeEvent extends Record<string, unknown> {
  id: string;
  pagingToken: string;
  txHash: string;
  ledger: number;
}

/** Build an RPC-shaped event. TOID = ledger << 32 | txOrder << 12 | opIndex. */
function rpcEvent(ledger: number, txOrder: number, opIndex: number, eventIndex: number, name = "charged"): FakeEvent {
  const toid = ((BigInt(ledger) << 32n) | (BigInt(txOrder) << 12n) | BigInt(opIndex)).toString().padStart(19, "0");
  const id = `${toid}-${String(eventIndex).padStart(10, "0")}`;
  return {
    id,
    pagingToken: id,
    txHash: `tx-${ledger}-${txOrder}`,
    ledger,
    ledgerClosedAt: new Date(ledger * 5000).toISOString(),
    topic: [name, `GUSER${ledger}${txOrder}${eventIndex}`],
    value: { amount: 100 },
  };
}

/** In-memory RPC honouring startLedger / cursor / limit like Soroban RPC. */
function fakeSource(events: FakeEvent[], latestLedger: number): EventSource & { calls: number } {
  const src = {
    calls: 0,
    async getEvents(req: { startLedger?: number; cursor?: string; limit?: number }) {
      src.calls++;
      if (req.startLedger !== undefined && req.startLedger > latestLedger) {
        throw new Error("startLedger must be <= latest ledger");
      }
      const from =
        req.cursor !== undefined
          ? events.findIndex((e) => e.pagingToken === req.cursor) + 1
          : events.findIndex((e) => e.ledger >= req.startLedger!);
      const page = from < 0 ? [] : events.slice(from, from + (req.limit ?? 100));
      return { latestLedger, events: page } as never;
    },
  };
  return src;
}

function rowIds(dbFile: string): string[] {
  const db = openDatabase(dbFile);
  const ids = (db.prepare("SELECT id FROM events ORDER BY id").all() as { id: string }[]).map((r) => r.id);
  db.close();
  return ids;
}

let dir: string;
let dbFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "payflow-indexer-"));
  dbFile = join(dir, "events.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("stableEventKey", () => {
  it("is derived from tx hash + op index + event index only", () => {
    const e = rpcEvent(1000, 3, 2, 7);
    expect(stableEventKey(e)).toBe("tx-1000-3:2:7");
    // Cursor / ordering bookkeeping does not affect the key.
    expect(stableEventKey({ ...e, pagingToken: "other", ledgerClosedAt: "2020-01-01T00:00:00Z" })).toBe("tx-1000-3:2:7");
  });

  it("keeps same-named events in one tx distinct", () => {
    expect(stableEventKey(rpcEvent(1000, 1, 0, 0))).not.toBe(stableEventKey(rpcEvent(1000, 1, 0, 1)));
    expect(stableEventKey(rpcEvent(1000, 1, 0, 0))).not.toBe(stableEventKey(rpcEvent(1000, 1, 1, 0)));
  });

  it("rejects events without a tx hash or well-formed id", () => {
    expect(stableEventKey({ id: "0-0" })).toBeNull();
    expect(stableEventKey({ txHash: "tx", id: "garbage" })).toBeNull();
    expect(parseEvent({ topic: ["charged"], txHash: "tx" })).toBeNull();
  });
});

describe("pollOnce", () => {
  // Two same-named events per tx, spread over several ledgers, > one page.
  const source: FakeEvent[] = [];
  for (let ledger = 100; ledger < 100 + 150; ledger++) {
    source.push(rpcEvent(ledger, 1, 0, 0), rpcEvent(ledger, 1, 0, 1));
  }
  const expectedIds = source.map((e) => stableEventKey(e)!).sort();
  const latest = 300;

  it("indexes every source event exactly once across pages", async () => {
    const db = openDatabase(dbFile);
    initSchema(db);
    const next = await pollOnce(db, 100, new EventDedupCache(), fakeSource(source, latest));
    db.close();

    expect(next).toBe(latest + 1);
    expect(rowIds(dbFile)).toEqual(expectedIds);
  });

  it("is idempotent across a restart that re-ingests the same range", async () => {
    for (let run = 0; run < 2; run++) {
      // Fresh DB handle + cold in-memory cache each run, same stored cursor.
      const db = openDatabase(dbFile);
      initSchema(db);
      await pollOnce(db, 100, new EventDedupCache(), fakeSource(source, latest));
      db.close();
    }
    expect(rowIds(dbFile)).toEqual(expectedIds);
  });

  it("converges on the cursor alone", async () => {
    const db = openDatabase(dbFile);
    initSchema(db);
    const src = fakeSource(source, latest);

    const a = await pollOnce(db, 100, new EventDedupCache(), src);
    const b = await pollOnce(db, 100, new EventDedupCache(), src);
    expect(b).toBe(a);

    // Caught up: polling from the returned cursor is a fixed point.
    expect(await pollOnce(db, a, new EventDedupCache(), src)).toBe(a);
    expect(await pollOnce(db, a, new EventDedupCache(), src)).toBe(a);

    // RPC failure never moves the cursor.
    const failing: EventSource = { getEvents: async () => { throw new Error("boom"); } };
    expect(await pollOnce(db, 100, new EventDedupCache(), failing)).toBe(100);
    db.close();

    expect(rowIds(dbFile)).toEqual(expectedIds);
  });
});
