/**
 * Endpoint, validation, read-only and OpenAPI tests for indexer-api.ts.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema, openDatabase, parseEvent, upsertEvents } from "../indexer.js";
import {
  buildOpenApiSpec,
  buildRoutes,
  createApiServer,
  loadApiConfig,
  openReadOnlyDb,
  type ApiConfig,
  type IndexerApi,
} from "../indexer-api.js";

const MERCHANT = Keypair.random().publicKey();
const OTHER_MERCHANT = Keypair.random().publicKey();
const ALICE = Keypair.random().publicKey();
const BOB = Keypair.random().publicKey();

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

let seq = 0;
function rpcEvent(name: string, address: string, value: Record<string, unknown>, ageDays: number) {
  seq++;
  const ledger = 1000 + seq;
  const toid = ((BigInt(ledger) << 32n) | (1n << 12n)).toString().padStart(19, "0");
  const id = `${toid}-${String(0).padStart(10, "0")}`;
  return {
    id,
    pagingToken: id,
    txHash: `tx${seq}`,
    ledger,
    ledgerClosedAt: new Date((NOW - ageDays * DAY) * 1000).toISOString(),
    topic: [name, address],
    value,
  };
}

let dir: string;
let dbFile: string;
let api: IndexerApi | null = null;
let base = "";

function seed(): void {
  const db = openDatabase(dbFile);
  initSchema(db);
  const events = [
    rpcEvent("subscribed", ALICE, { merchant: MERCHANT, subscriber: ALICE, amount: 1000 }, 60),
    rpcEvent("subscribed", BOB, { merchant: MERCHANT, subscriber: BOB, amount: 1000 }, 60),
    rpcEvent("charged", ALICE, { merchant: MERCHANT, amount: 1000, fee: 10 }, 2),
    rpcEvent("charged", BOB, { merchant: MERCHANT, amount: 1000, fee: 10 }, 1),
    rpcEvent("cancelled", BOB, { merchant: MERCHANT }, 1),
    rpcEvent("charged", ALICE, { merchant: OTHER_MERCHANT, amount: 500, fee: 5 }, 1),
  ]
    .map((e) => parseEvent(e))
    .filter((e): e is NonNullable<typeof e> => e !== null);
  upsertEvents(db, events);
  db.close();
}

async function start(overrides: Partial<ApiConfig> = {}): Promise<void> {
  const config: ApiConfig = {
    dbFile,
    port: 0,
    host: "127.0.0.1",
    corsOrigins: [],
    defaultLimit: 2,
    maxLimit: 5,
    ...overrides,
  };
  api = createApiServer(config);
  await new Promise<void>((ok) => api!.server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;
}

const get = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, init);
  const text = await res.text();
  return { res, status: res.status, body: text ? (JSON.parse(text) as any) : null };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "payflow-api-"));
  dbFile = join(dir, "events.db");
});
afterEach(async () => {
  await api?.close();
  api = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("events endpoints", () => {
  beforeEach(async () => {
    seed();
    await start();
  });

  it("returns a user's events newest-first with pagination metadata", async () => {
    const { status, body } = await get(`/v1/users/${ALICE}/events`);
    expect(status).toBe(200);
    expect(body.pagination).toEqual({ limit: 2, offset: 0, total: 3, has_more: true });
    expect(body.data).toHaveLength(2);
    expect(body.data[0].ledger).toBeGreaterThan(body.data[1].ledger);
    expect(body.data[0]).toMatchObject({ address: ALICE, event_name: "charged" });
    expect(body.data[0].data).toMatchObject({ merchant: expect.any(String) });
  });

  it("pages through all results without overlap", async () => {
    const first = await get(`/v1/users/${ALICE}/events?limit=2&offset=0`);
    const second = await get(`/v1/users/${ALICE}/events?limit=2&offset=2`);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.pagination.has_more).toBe(false);
    const ids = [...first.body.data, ...second.body.data].map((e: any) => e.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("filters by event_name", async () => {
    const { body } = await get(`/v1/users/${ALICE}/events?event_name=charged`);
    expect(body.pagination.total).toBe(2);
    expect(body.data.every((e: any) => e.event_name === "charged")).toBe(true);
  });

  it("returns merchant events and excludes other merchants", async () => {
    const { status, body } = await get(`/v1/merchants/${MERCHANT}/events?limit=5`);
    expect(status).toBe(200);
    expect(body.pagination.total).toBe(5);
    expect(body.data.every((e: any) => e.merchant === MERCHANT)).toBe(true);
  });

  it("returns an empty page for an unknown address", async () => {
    const { status, body } = await get(`/v1/users/${Keypair.random().publicKey()}/events`);
    expect(status).toBe(200);
    expect(body).toEqual({ data: [], pagination: { limit: 2, offset: 0, total: 0, has_more: false } });
  });

  it("treats SQL metacharacters in event_name as invalid, not as SQL", async () => {
    const { status, body } = await get(`/v1/users/${ALICE}/events?event_name=${encodeURIComponent("x' OR 1=1 --")}`);
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });
});

describe("analytics endpoints", () => {
  beforeEach(async () => {
    seed();
    await start();
  });

  it("revenue: net of fees, with a 30-day daily series", async () => {
    const { status, body } = await get(`/v1/merchants/${MERCHANT}/revenue`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ merchant: MERCHANT, total_net_revenue: "1980", subscriber_count: 2 });
    expect(body.daily_revenue_last_30_days).toHaveLength(30);
    const sum = body.daily_revenue_last_30_days.reduce((a: bigint, d: any) => a + BigInt(d.net_revenue), 0n);
    expect(sum).toBe(1980n);
    expect(body.freshness).toHaveProperty("last_ledger");
  });

  it("revenue: zero for a merchant with no events", async () => {
    const { body } = await get(`/v1/merchants/${Keypair.random().publicKey()}/revenue`);
    expect(body).toMatchObject({ total_net_revenue: "0", subscriber_count: 0 });
  });

  it("churn: cancellations over subscribers at window start", async () => {
    const { status, body } = await get(`/v1/merchants/${MERCHANT}/churn?days=30`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      merchant: MERCHANT,
      window_days: 30,
      found: true,
      subscriber_count: 2,
      churn_rate_percent: 50,
      revenue_in_window: "1980",
    });
  });

  it("churn: defaults to 30 days and reports found=false for unknown merchants", async () => {
    const { body } = await get(`/v1/merchants/${Keypair.random().publicKey()}/churn`);
    expect(body).toMatchObject({ window_days: 30, found: false, churn_rate_percent: null });
  });
});

describe("validation and error handling", () => {
  beforeEach(async () => {
    seed();
    await start();
  });

  it.each([
    ["/v1/users/not-an-address/events", /valid Stellar address/],
    [`/v1/users/${ALICE}/events?limit=6`, /limit must be between 1 and 5/],
    [`/v1/users/${ALICE}/events?limit=0`, /limit must be between/],
    [`/v1/users/${ALICE}/events?limit=-1`, /non-negative integer/],
    [`/v1/users/${ALICE}/events?limit=abc`, /non-negative integer/],
    [`/v1/users/${ALICE}/events?limit=1&limit=2`, /at most once/],
    [`/v1/users/${ALICE}/events?offset=-5`, /non-negative integer/],
    [`/v1/users/${ALICE}/events?bogus=1`, /Unknown query parameter/],
    [`/v1/merchants/${MERCHANT}/churn?days=0`, /days must be between 1 and 365/],
    [`/v1/merchants/${MERCHANT}/churn?days=366`, /days must be between 1 and 365/],
    [`/v1/merchants/${MERCHANT}/revenue?x=1`, /Unknown query parameter/],
    ["/v1/users/%E0%A4%A/events", /Malformed URL/],
  ])("400 for %s", async (path, message) => {
    const { status, body } = await get(path);
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toMatch(message);
  });

  it("404 for unknown paths with the standard error shape", async () => {
    const { status, body } = await get("/v1/nope");
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found", message: "No such endpoint" } });
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("405 for %s and no data is modified", async (method) => {
    const { status, body } = await get(`/v1/users/${ALICE}/events`, { method });
    expect(status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
    const count = (await get(`/v1/users/${ALICE}/events`)).body.pagination.total;
    expect(count).toBe(3);
  });

  it("500 with a generic body (no internals) on a database error", async () => {
    const db = openDatabase(dbFile);
    db.exec("DROP TABLE events");
    db.close();
    const { status, body } = await get(`/v1/users/${ALICE}/events`);
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: "internal_error", message: "Internal server error" } });
  });
});

describe("database availability", () => {
  it("503 while the database file does not exist, then recovers", async () => {
    await start();
    expect((await get("/health")).status).toBe(503);
    expect((await get(`/v1/users/${ALICE}/events`)).body.error.code).toBe("database_unavailable");
    seed();
    expect((await get("/health")).body).toEqual({ status: "ok" });
    expect((await get(`/v1/users/${ALICE}/events`)).status).toBe(200);
  });
});

describe("read-only guarantees", () => {
  it("the connection used by the API rejects writes", () => {
    seed();
    const db = openReadOnlyDb(dbFile);
    expect(() => db.exec("INSERT INTO meta(key, value) VALUES('x', 'y')")).toThrow();
    expect(() => db.exec("DELETE FROM events")).toThrow();
    expect(() => db.exec("DROP TABLE events")).toThrow();
    db.close();
  });

  it("reads see data written concurrently by the indexer", async () => {
    seed();
    await start();
    expect((await get(`/v1/users/${BOB}/events`)).body.pagination.total).toBe(3);
    const db = openDatabase(dbFile);
    upsertEvents(db, [parseEvent(rpcEvent("paused", BOB, {}, 0))!]);
    db.close();
    expect((await get(`/v1/users/${BOB}/events`)).body.pagination.total).toBe(4);
  });
});

describe("CORS", () => {
  const origin = "https://dashboard.example";

  it("adds no CORS headers by default", async () => {
    seed();
    await start();
    const { res } = await get(`/v1/users/${ALICE}/events`, { headers: { Origin: origin } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows only listed origins", async () => {
    seed();
    await start({ corsOrigins: [origin] });
    const ok = await get(`/v1/users/${ALICE}/events`, { headers: { Origin: origin } });
    expect(ok.res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(ok.res.headers.get("vary")).toContain("Origin");
    const bad = await get(`/v1/users/${ALICE}/events`, { headers: { Origin: "https://evil.example" } });
    expect(bad.res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("supports a wildcard and answers preflight requests", async () => {
    seed();
    await start({ corsOrigins: ["*"] });
    const pre = await get(`/v1/users/${ALICE}/events`, { method: "OPTIONS", headers: { Origin: origin } });
    expect(pre.status).toBe(204);
    expect(pre.res.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.res.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
  });

  it("includes CORS headers on error responses", async () => {
    seed();
    await start({ corsOrigins: [origin] });
    const { res, status } = await get("/v1/users/bad/events", { headers: { Origin: origin } });
    expect(status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });
});

describe("configuration", () => {
  it("parses env with defaults", () => {
    expect(loadApiConfig({ DB_FILE: "/x/events.db" })).toMatchObject({
      dbFile: "/x/events.db",
      port: 3100,
      host: "127.0.0.1",
      corsOrigins: [],
      defaultLimit: 50,
      maxLimit: 500,
    });
    expect(loadApiConfig({ API_CORS_ORIGINS: " https://a.example , https://b.example " }).corsOrigins).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
  it("rejects invalid numbers and default > max", () => {
    expect(() => loadApiConfig({ API_PORT: "abc" })).toThrow(/API_PORT/);
    expect(() => loadApiConfig({ API_MAX_LIMIT: "0" })).toThrow(/API_MAX_LIMIT/);
    expect(() => loadApiConfig({ API_DEFAULT_LIMIT: "10", API_MAX_LIMIT: "5" })).toThrow(/must not exceed/);
  });
});

describe("OpenAPI specification", () => {
  it("documents every route (and only those) and is served at /openapi.json", async () => {
    seed();
    await start();
    const served = (await get("/openapi.json")).body;
    const documented = Object.keys(served.paths).sort();
    const implemented = ["/health", ...buildRoutes({ defaultLimit: 2, maxLimit: 5 }).map((r) => r.path)].sort();
    expect(documented).toEqual(implemented);
    expect(served.openapi).toBe("3.0.3");
    for (const op of Object.values<any>(served.paths)) {
      expect(Object.keys(op)).toEqual(["get"]);
      expect(op.get.responses["200"]).toBeDefined();
    }
  });

  it("references only schemas that exist", () => {
    const spec = JSON.stringify(buildOpenApiSpec());
    const refs = [...spec.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]);
    const defined = Object.keys((buildOpenApiSpec() as any).components.schemas);
    for (const r of refs) expect(defined).toContain(r);
  });

  it("advertises the configured limits", () => {
    const spec = buildOpenApiSpec({ defaultLimit: 7, maxLimit: 70 }) as any;
    const limit = spec.paths["/v1/users/{address}/events"].get.parameters.find((p: any) => p.name === "limit");
    expect(limit.schema).toMatchObject({ default: 7, maximum: 70 });
  });

  it("matches the committed docs/openapi/indexer-api.json (run `npm run api:openapi` to refresh)", () => {
    const committed = JSON.parse(readFileSync(new URL("../../docs/openapi/indexer-api.json", import.meta.url), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApiSpec(loadApiConfig({})))));
  });
});
