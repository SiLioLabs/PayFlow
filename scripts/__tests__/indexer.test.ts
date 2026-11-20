/**
 * Restart-idempotency and convergence tests for scripts/indexer.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventDedupCache } from "../event-dedup.js";
import pg from "pg";
import {
  initSchema,
  openDatabase,
  parseEvent,
  pollOnce,
  stableEventKey,
  SCHEMA_VERSION,
  type EventSource,
} from "../indexer.js";
import { SqliteStore, PostgresStore, type IndexerStore } from "../db/store.js";

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

/**
 * Storage backends the pollOnce suite runs against (#1484). SQLite always;
 * PostgreSQL when TEST_DATABASE_URL is set (each test gets its own schema).
 */
interface Backend {
  /** Open a fresh store handle on the same underlying database. */
  open(): Promise<IndexerStore>;
  ids(): Promise<string[]>;
  cleanup(): Promise<void>;
}

const backends: Array<[string, () => Backend]> = [
  ["sqlite", () => ({
    open: async () => {
      const store = SqliteStore.open(dbFile);
      await store.init();
      return store;
    },
    ids: async () => rowIds(dbFile),
    cleanup: async () => undefined,
  })],
];

const PG_URL = process.env.TEST_DATABASE_URL;
if (PG_URL) {
  backends.push(["postgres", () => {
    const schema = `payflow_test_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
    return {
      open: async () => {
        const store = await PostgresStore.connect(PG_URL, { schema });
        await store.init();
        return store;
      },
      ids: async () => {
        const client = new pg.Client({ connectionString: PG_URL });
        await client.connect();
        try {
          const r = await client.query<{ id: string }>(`SELECT id FROM ${schema}.events ORDER BY id COLLATE "C"`);
          return r.rows.map((row) => row.id);
        } finally {
          await client.end();
        }
      },
      cleanup: async () => {
        const client = new pg.Client({ connectionString: PG_URL });
        await client.connect();
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      },
    };
  }]);
}

describe.each(backends)("pollOnce (%s)", (_name, makeBackend) => {
  // Two same-named events per tx, spread over several ledgers, > one page.
  const source: FakeEvent[] = [];
  for (let ledger = 100; ledger < 100 + 150; ledger++) {
    source.push(rpcEvent(ledger, 1, 0, 0), rpcEvent(ledger, 1, 0, 1));
  }
  const expectedIds = source.map((e) => stableEventKey(e)!).sort();
  const latest = 300;
  let backend: Backend;

  beforeEach(() => {
    backend = makeBackend();
  });

  afterEach(async () => {
    await backend.cleanup();
  });

  it("indexes every source event exactly once across pages", async () => {
    const store = await backend.open();
    const next = await pollOnce(store, 100, new EventDedupCache(), fakeSource(source, latest));
    await store.close();

    expect(next).toBe(latest + 1);
    expect(await backend.ids()).toEqual(expectedIds);
  });

  it("is idempotent across a restart that re-ingests the same range", async () => {
    for (let run = 0; run < 2; run++) {
      // Fresh DB handle + cold in-memory cache each run, same stored cursor.
      const store = await backend.open();
      await pollOnce(store, 100, new EventDedupCache(), fakeSource(source, latest));
      await store.close();
    }
    expect(await backend.ids()).toEqual(expectedIds);
  });

  it("converges on the cursor alone", async () => {
    const store = await backend.open();
    const src = fakeSource(source, latest);

    const a = await pollOnce(store, 100, new EventDedupCache(), src);
    const b = await pollOnce(store, 100, new EventDedupCache(), src);
    expect(b).toBe(a);

    // Caught up: polling from the returned cursor is a fixed point.
    expect(await pollOnce(store, a, new EventDedupCache(), src)).toBe(a);
    expect(await pollOnce(store, a, new EventDedupCache(), src)).toBe(a);

    // RPC failure never moves the cursor.
    const failing: EventSource = { getEvents: async () => { throw new Error("boom"); } };
    expect(await pollOnce(store, 100, new EventDedupCache(), failing)).toBe(100);
    await store.close();

    expect(await backend.ids()).toEqual(expectedIds);
  });

  it("stores meta and the schema version, and re-init is a no-op", async () => {
    const store = await backend.open();
    expect(await store.getMeta("schema_version")).toBe(String(SCHEMA_VERSION));
    expect(await store.getMeta("last_ledger")).toBeNull();
    await store.setMeta("last_ledger", "123");
    await store.setMeta("last_ledger", "456");
    await store.init();
    expect(await store.getMeta("last_ledger")).toBe("456");
    await store.close();
  });

  it("upserts changed rows instead of duplicating them", async () => {
    const store = await backend.open();
    const event = parseEvent(rpcEvent(100, 1, 0, 0))!;
    await store.upsertEvents([event]);
    await store.upsertEvents([{ ...event, amount: "999" }]);
    await store.close();
    expect(await backend.ids()).toEqual([event.id]);
  });
});

describe("pollOnce with a raw DatabaseSync handle", () => {
  it("still accepts the SQLite handle directly (backwards compatible)", async () => {
    const db = openDatabase(dbFile);
    initSchema(db);
    const next = await pollOnce(db, 100, new EventDedupCache(), fakeSource([rpcEvent(100, 1, 0, 0)], 100));
    db.close();
    expect(next).toBe(101);
    expect(rowIds(dbFile)).toEqual([stableEventKey(rpcEvent(100, 1, 0, 0))]);
  });
});

describe.runIf(PG_URL)("PostgresStore migrations", () => {
  it("upgrades a v1 schema to the current version", async () => {
    const schema = `payflow_test_mig_${process.pid}`;
    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
      await client.query(`
        CREATE TABLE ${schema}.meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE ${schema}.events (
          id TEXT PRIMARY KEY, event_name TEXT NOT NULL, address TEXT NOT NULL, amount TEXT,
          ledger BIGINT NOT NULL, timestamp BIGINT NOT NULL, tx_hash TEXT NOT NULL, raw_data TEXT NOT NULL
        );
        INSERT INTO ${schema}.meta VALUES ('schema_version', '1');
      `);

      const store = await PostgresStore.connect(PG_URL!, { schema });
      await store.init();
      expect(await store.getMeta("schema_version")).toBe(String(SCHEMA_VERSION));
      await store.upsertEvents([parseEvent(rpcEvent(100, 1, 0, 0))!]); // needs the v2 columns
      await store.close();

      const cols = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'events'", [schema]);
      expect(cols.rows.map((r) => r.column_name)).toEqual(expect.arrayContaining(["merchant", "fee_amount", "token", "result_code"]));
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
