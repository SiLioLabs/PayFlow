#!/usr/bin/env tsx
/**
 * indexer-api.ts — Read-only HTTP API on top of the indexer SQLite database.
 *
 * Lets merchant dashboards and analytics read indexed data without opening the
 * SQLite file themselves or scanning the chain. It reuses the query helpers in
 * merchant-queries.ts so numbers match the CLI reports.
 *
 * Endpoints (all GET; see /openapi.json or docs/openapi/indexer-api.json):
 *   GET /health
 *   GET /openapi.json
 *   GET /v1/users/{address}/events        ?limit&offset&event_name
 *   GET /v1/merchants/{address}/events    ?limit&offset&event_name
 *   GET /v1/merchants/{address}/revenue
 *   GET /v1/merchants/{address}/churn     ?days
 *
 * Safety:
 *   - The database is opened with { readOnly: true } and PRAGMA query_only=ON,
 *     so no request can modify indexer data. Non-GET/HEAD/OPTIONS → 405.
 *   - All parameters are validated; SQL only ever uses bound parameters.
 *   - Page size is bounded by API_MAX_LIMIT; larger requests are rejected (400).
 *   - Internal/database errors return a generic 500/503 body; details are logged.
 *
 * Environment variables:
 *   API_PORT           Listen port (default: 3100)
 *   API_HOST           Bind address (default: 127.0.0.1)
 *   API_CORS_ORIGINS   Comma-separated allowed origins, or "*" (default: none → no CORS headers)
 *   API_DEFAULT_LIMIT  Default page size (default: 50)
 *   API_MAX_LIMIT      Maximum page size (default: 500)
 *   DATA_DIR / DB_FILE Same as indexer.ts.
 *
 * Usage:
 *   tsx indexer-api.ts            # start the server
 *   tsx indexer-api.ts --openapi  # print the OpenAPI document and exit
 */
import http from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { logger as rootLogger } from "./logger.js";
import {
  checkFreshness,
  computeMerchantMetrics,
  computeMerchantReport,
  type EventRow,
} from "./merchant-queries.js";

const logger = rootLogger.child({ script: "indexer-api" });

// ── Configuration ────────────────────────────────────────────────────────────

export interface ApiConfig {
  dbFile: string;
  port: number;
  host: string;
  /** Allowed CORS origins; ["*"] allows any. Empty disables CORS headers. */
  corsOrigins: string[];
  defaultLimit: number;
  maxLimit: number;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer (got "${raw}")`);
  return n;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const config: ApiConfig = {
    dbFile: env.DB_FILE ?? resolve(env.DATA_DIR ?? "data", "events.db"),
    port: intEnv(env, "API_PORT", 3100),
    host: env.API_HOST ?? "127.0.0.1",
    corsOrigins: (env.API_CORS_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    defaultLimit: intEnv(env, "API_DEFAULT_LIMIT", 50),
    maxLimit: intEnv(env, "API_MAX_LIMIT", 500),
  };
  if (config.defaultLimit > config.maxLimit) {
    throw new Error("API_DEFAULT_LIMIT must not exceed API_MAX_LIMIT");
  }
  return config;
}

// ── Errors ───────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const badRequest = (message: string): ApiError => new ApiError(400, "invalid_request", message);

// ── Validation ───────────────────────────────────────────────────────────────

/** Stellar account (G…) or contract (C…) strkey shape. */
const ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

function parseAddress(raw: string): string {
  if (!ADDRESS_RE.test(raw)) throw badRequest("address must be a valid Stellar address (56 characters, starting with G or C)");
  return raw;
}

function parseIntParam(
  params: URLSearchParams,
  name: string,
  opts: { min: number; max: number; fallback: number },
): number {
  const all = params.getAll(name);
  if (all.length === 0) return opts.fallback;
  if (all.length > 1) throw badRequest(`${name} must be provided at most once`);
  if (!/^\d{1,9}$/.test(all[0])) throw badRequest(`${name} must be a non-negative integer`);
  const n = parseInt(all[0], 10);
  if (n < opts.min || n > opts.max) throw badRequest(`${name} must be between ${opts.min} and ${opts.max}`);
  return n;
}

function rejectUnknownParams(params: URLSearchParams, allowed: string[]): void {
  for (const key of params.keys()) {
    if (!allowed.includes(key)) throw badRequest(`Unknown query parameter: ${key}`);
  }
}

// ── Database ─────────────────────────────────────────────────────────────────

/** Open the indexer DB read-only. Throws if the file does not exist. */
export function openReadOnlyDb(dbFile: string): DatabaseSync {
  const db = new DatabaseSync(dbFile, { open: true, readOnly: true });
  db.exec("PRAGMA query_only = ON");
  return db;
}

interface Page<T> {
  data: T[];
  pagination: { limit: number; offset: number; total: number; has_more: boolean };
}

const EVENT_COLUMNS =
  "id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount, token, result_code";

function serializeEvent(row: EventRow): Record<string, unknown> {
  let data: unknown = null;
  try {
    data = JSON.parse(row.raw_data);
  } catch {
    /* keep null: a malformed raw_data must not fail the whole page */
  }
  return {
    id: row.id,
    event_name: row.event_name,
    address: row.address,
    merchant: row.merchant,
    amount: row.amount,
    fee_amount: row.fee_amount,
    token: row.token,
    result_code: row.result_code,
    ledger: Number(row.ledger),
    timestamp: Number(row.timestamp),
    tx_hash: row.tx_hash,
    data,
  };
}

function queryEvents(
  db: DatabaseSync,
  where: string,
  whereArgs: string[],
  eventName: string | undefined,
  limit: number,
  offset: number,
): Page<Record<string, unknown>> {
  const clause = eventName ? `${where} AND event_name = ?` : where;
  const args = eventName ? [...whereArgs, eventName] : whereArgs;
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS c FROM events WHERE ${clause}`).get(...args) as { c: number }).c,
  );
  const rows = db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE ${clause} ORDER BY ledger DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as unknown as EventRow[];
  return {
    data: rows.map(serializeEvent),
    pagination: { limit, offset, total, has_more: offset + rows.length < total },
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

interface RouteContext {
  db: DatabaseSync;
  config: ApiConfig;
  params: Record<string, string>;
  query: URLSearchParams;
}

interface Route {
  path: string;
  summary: string;
  parameters: Array<Record<string, unknown>>;
  /** Name of the OpenAPI schema describing the 200 body. */
  schema: string;
  handler: (ctx: RouteContext) => unknown;
}

const addressParam = (description: string): Record<string, unknown> => ({
  name: "address",
  in: "path",
  required: true,
  description,
  schema: { type: "string", pattern: ADDRESS_RE.source },
});

const pagingParams = (config: Pick<ApiConfig, "defaultLimit" | "maxLimit">): Array<Record<string, unknown>> => [
  {
    name: "limit",
    in: "query",
    description: "Page size.",
    schema: { type: "integer", minimum: 1, maximum: config.maxLimit, default: config.defaultLimit },
  },
  { name: "offset", in: "query", description: "Rows to skip.", schema: { type: "integer", minimum: 0, default: 0 } },
  {
    name: "event_name",
    in: "query",
    description: "Only return events with this name (e.g. charged).",
    schema: { type: "string", pattern: EVENT_NAME_RE.source },
  },
];

function pagedEvents(ctx: RouteContext, where: string, addressArgs: 1 | 2): Page<Record<string, unknown>> {
  const { config, query } = ctx;
  rejectUnknownParams(query, ["limit", "offset", "event_name"]);
  const limit = parseIntParam(query, "limit", { min: 1, max: config.maxLimit, fallback: config.defaultLimit });
  const offset = parseIntParam(query, "offset", { min: 0, max: 100_000_000, fallback: 0 });
  const eventName = query.get("event_name") ?? undefined;
  if (eventName !== undefined && !EVENT_NAME_RE.test(eventName)) {
    throw badRequest("event_name must be lowercase letters, digits or underscores");
  }
  const address = parseAddress(ctx.params.address);
  const args = addressArgs === 2 ? [address, address] : [address];
  return queryEvents(ctx.db, where, args, eventName, limit, offset);
}

function freshness(db: DatabaseSync): Record<string, unknown> {
  const f = checkFreshness(db);
  return { last_ledger: f.lastLedger, is_fresh: f.isFresh, staleness_seconds: f.stalenessSeconds };
}

export function buildRoutes(config: Pick<ApiConfig, "defaultLimit" | "maxLimit">): Route[] {
  return [
    {
      path: "/v1/users/{address}/events",
      summary: "Events for a subscriber/actor address, newest first.",
      parameters: [addressParam("Subscriber (user) address."), ...pagingParams(config)],
      schema: "EventPage",
      handler: (ctx) => pagedEvents(ctx, "address = ?", 1),
    },
    {
      path: "/v1/merchants/{address}/events",
      summary: "Events involving a merchant, newest first.",
      parameters: [addressParam("Merchant address."), ...pagingParams(config)],
      schema: "EventPage",
      // Same predicate as merchant-queries.fetchMerchantEvents.
      handler: (ctx) => pagedEvents(ctx, "(merchant = ? OR address = ?)", 2),
    },
    {
      path: "/v1/merchants/{address}/revenue",
      summary: "Net revenue (charges minus protocol fees) for a merchant.",
      parameters: [addressParam("Merchant address.")],
      schema: "Revenue",
      handler: (ctx) => {
        rejectUnknownParams(ctx.query, []);
        const merchant = parseAddress(ctx.params.address);
        const report = computeMerchantReport(ctx.db, merchant);
        const today = Math.floor(Date.now() / 1000);
        const daily = report.dailyRevenueLast30Days.map((amount, i) => ({
          date: new Date((today - (29 - i) * 86400) * 1000).toISOString().slice(0, 10),
          net_revenue: amount.toString(),
        }));
        return {
          merchant,
          total_net_revenue: report.totalRevenue.toString(),
          subscriber_count: report.subscriberCount,
          daily_revenue_last_30_days: daily,
          freshness: freshness(ctx.db),
        };
      },
    },
    {
      path: "/v1/merchants/{address}/churn",
      summary: "Subscriber churn and growth for a merchant over a window.",
      parameters: [
        addressParam("Merchant address."),
        {
          name: "days",
          in: "query",
          description: "Comparison window in days.",
          schema: { type: "integer", minimum: 1, maximum: 365, default: 30 },
        },
      ],
      schema: "Churn",
      handler: (ctx) => {
        rejectUnknownParams(ctx.query, ["days"]);
        const merchant = parseAddress(ctx.params.address);
        const days = parseIntParam(ctx.query, "days", { min: 1, max: 365, fallback: 30 });
        const m = computeMerchantMetrics(ctx.db, days).get(merchant);
        return {
          merchant,
          window_days: days,
          found: m !== undefined,
          subscriber_count: m?.subscriberCount ?? 0,
          churn_rate_percent: m?.churnRate ?? null,
          growth_rate_percent: m?.growthRate ?? null,
          revenue_in_window: (m?.revenueInWindow ?? 0n).toString(),
          is_new: m?.isNew ?? null,
          freshness: freshness(ctx.db),
        };
      },
    },
  ];
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

const errorRef = { $ref: "#/components/schemas/Error" };
const errorResponses = (codes: Array<[string, string]>): Record<string, unknown> =>
  Object.fromEntries(
    codes.map(([code, description]) => [
      code,
      { description, content: { "application/json": { schema: errorRef } } },
    ]),
  );

/** Build the OpenAPI 3.0 document from the route table (so it cannot drift). */
export function buildOpenApiSpec(
  config: Pick<ApiConfig, "defaultLimit" | "maxLimit"> = { defaultLimit: 50, maxLimit: 500 },
): Record<string, unknown> {
  const paths: Record<string, unknown> = {
    "/health": {
      get: {
        summary: "Liveness and database availability.",
        responses: {
          "200": { description: "Database reachable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } },
          ...errorResponses([["503", "Database unavailable."]]),
        },
      },
    },
  };
  for (const r of buildRoutes(config)) {
    paths[r.path] = {
      get: {
        summary: r.summary,
        parameters: r.parameters,
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${r.schema}` } } } },
          ...errorResponses([
            ["400", "Invalid path or query parameter."],
            ["500", "Internal error."],
            ["503", "Database unavailable."],
          ]),
        },
      },
    };
  }
  const str = { type: "string" };
  const nstr = { type: "string", nullable: true };
  const int = { type: "integer" };
  const freshness = {
    type: "object",
    properties: {
      last_ledger: { type: "integer", nullable: true },
      is_fresh: { type: "boolean" },
      staleness_seconds: { type: "number", nullable: true },
    },
  };
  return {
    openapi: "3.0.3",
    info: {
      title: "FlowPay Indexer API",
      version: "1.0.0",
      description:
        "Read-only HTTP API over the FlowPay event indexer database. All amounts are stroop strings.",
    },
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: { code: str, message: str },
            },
          },
        },
        Health: { type: "object", properties: { status: { type: "string", enum: ["ok"] } } },
        Event: {
          type: "object",
          properties: {
            id: str, event_name: str, address: str, merchant: nstr, amount: nstr, fee_amount: nstr,
            token: nstr, result_code: nstr, ledger: int, timestamp: int, tx_hash: str,
            data: { description: "Decoded event value (JSON), or null.", nullable: true },
          },
        },
        EventPage: {
          type: "object",
          properties: {
            data: { type: "array", items: { $ref: "#/components/schemas/Event" } },
            pagination: {
              type: "object",
              properties: { limit: int, offset: int, total: int, has_more: { type: "boolean" } },
            },
          },
        },
        Revenue: {
          type: "object",
          properties: {
            merchant: str,
            total_net_revenue: str,
            subscriber_count: int,
            daily_revenue_last_30_days: {
              type: "array",
              items: { type: "object", properties: { date: str, net_revenue: str } },
            },
            freshness,
          },
        },
        Churn: {
          type: "object",
          properties: {
            merchant: str,
            window_days: int,
            found: { type: "boolean" },
            subscriber_count: int,
            churn_rate_percent: { type: "number", nullable: true },
            growth_rate_percent: { type: "number", nullable: true },
            revenue_in_window: str,
            is_new: { type: "boolean", nullable: true },
            freshness,
          },
        },
      },
    },
  };
}

// ── Server ───────────────────────────────────────────────────────────────────

function matchRoute(routes: Route[], pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const names: string[] = [];
    const re = new RegExp(
      "^" + route.path.replace(/\{(\w+)\}/g, (_m, n: string) => (names.push(n), "([^/]+)")) + "$",
    );
    const m = re.exec(pathname);
    if (m) return { route, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

function corsHeaders(config: ApiConfig, origin: string | undefined): Record<string, string> {
  if (config.corsOrigins.length === 0) return {};
  if (config.corsOrigins.includes("*")) return { "Access-Control-Allow-Origin": "*" };
  if (origin && config.corsOrigins.includes(origin)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return { Vary: "Origin" };
}

export interface IndexerApi {
  server: http.Server;
  /** Close the HTTP server and the database handle. */
  close(): Promise<void>;
}

export function createApiServer(config: ApiConfig): IndexerApi {
  const routes = buildRoutes(config);
  const openapi = JSON.stringify(buildOpenApiSpec(config));
  let db: DatabaseSync | null = null;

  /** Lazily open (and re-open after failure) the read-only connection. */
  function getDb(): DatabaseSync {
    if (db) return db;
    if (!existsSync(config.dbFile)) {
      throw new ApiError(503, "database_unavailable", "Indexer database is not available");
    }
    try {
      db = openReadOnlyDb(config.dbFile);
    } catch (err) {
      logger.error("Failed to open indexer database", { error: String(err) });
      throw new ApiError(503, "database_unavailable", "Indexer database is not available");
    }
    return db;
  }

  function send(
    res: http.ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string>,
    rawBody?: string,
  ): void {
    const payload = rawBody ?? JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(payload);
  }

  const server = http.createServer((req, res) => {
    const headers = corsHeaders(config, req.headers.origin);
    try {
      const method = req.method ?? "GET";
      if (method === "OPTIONS") {
        res.writeHead(204, {
          ...headers,
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600",
        });
        res.end();
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        throw new ApiError(405, "method_not_allowed", "This API is read-only");
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/openapi.json") return send(res, 200, null, headers, openapi);
      if (url.pathname === "/health") {
        getDb().prepare("SELECT 1").get();
        return send(res, 200, { status: "ok" }, headers);
      }

      let matched: ReturnType<typeof matchRoute>;
      try {
        matched = matchRoute(routes, url.pathname);
      } catch {
        throw badRequest("Malformed URL encoding in path");
      }
      if (!matched) throw new ApiError(404, "not_found", "No such endpoint");

      const result = matched.route.handler({
        db: getDb(),
        config,
        params: matched.params,
        query: url.searchParams,
      });
      send(res, 200, result, headers);
    } catch (err) {
      if (err instanceof ApiError) {
        return send(res, err.status, { error: { code: err.code, message: err.message } }, headers);
      }
      // Database or programming error: log details, return a generic body.
      logger.error("Unhandled API error", { error: err instanceof Error ? err.message : String(err), url: req.url });
      send(res, 500, { error: { code: "internal_error", message: "Internal server error" } }, headers);
    }
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => {
          db?.close();
          db = null;
          resolveClose();
        });
        server.closeAllConnections?.();
      }),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadApiConfig();
  if (process.argv.includes("--openapi")) {
    process.stdout.write(JSON.stringify(buildOpenApiSpec(config), null, 2) + "\n");
    return;
  }
  const api = createApiServer(config);
  await new Promise<void>((ok, fail) => {
    api.server.once("error", fail);
    api.server.listen(config.port, config.host, ok);
  });
  logger.info("Indexer API listening", {
    host: config.host,
    port: config.port,
    db: config.dbFile,
    cors_origins: config.corsOrigins,
    max_limit: config.maxLimit,
  });
  const stop = (): void => {
    void api.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
