/**
 * scripts/metrics-server.ts — Prometheus metrics for the PayFlow keeper.
 *
 * Exposes a /metrics endpoint on METRICS_PORT (default 9091).
 * All keeper code imports individual counters/gauges from here.
 *
 * Metrics exposed:
 *   payflow_keeper_charges_total{result}       - keeper charge call outcomes
 *   payflow_keeper_batch_duration_seconds      - batch processing latency histogram
 *   payflow_keeper_fee_spend_stroops           - latest resource fee paid (gauge)
 *   payflow_keeper_adaptive_fee_stroops_bucket - histogram of adaptive fees calculated
 *   payflow_keeper_fee_bump_total              - number of fee-bump envelopes submitted
 *   payflow_keeper_rpc_errors_total{operation} - RPC error counter
 *   payflow_keeper_dlq_size                    - dead-letter queue depth (gauge)
 *   payflow_keeper_last_run_timestamp_seconds  - unix timestamp of last keeper run
 *   payflow_keeper_heartbeat_total             - monotonically increasing heartbeat
 */

import http from "http";
import { METRICS_PORT } from "./config";

// ── Minimal Prometheus counter / gauge / histogram ────────────────────────────
// We implement a lightweight subset to avoid a hard prom-client dependency
// while keeping the output 100% Prometheus-compatible text format.

interface LabelSet {
  [key: string]: string | number;
}

class Counter {
  private values = new Map<string, number>();

  constructor(
    private readonly name: string,
    private readonly help: string,
    private readonly labelNames: string[] = []
  ) {}

  inc(labels: LabelSet = {}, amount = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, value] of this.values) {
        lines.push(key ? `${this.name}{${key}} ${value}` : `${this.name} ${value}`);
      }
    }
    return lines.join("\n");
  }

  private labelKey(labels: LabelSet): string {
    return this.labelNames
      .filter((n) => labels[n] !== undefined)
      .map((n) => `${n}="${labels[n]}"`)
      .join(",");
  }
}

class Gauge {
  private value = 0;

  constructor(
    private readonly name: string,
    private readonly help: string
  ) {}

  set(value: number): void {
    this.value = value;
  }

  inc(amount = 1): void {
    this.value += amount;
  }

  serialize(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      `${this.name} ${this.value}`,
    ].join("\n");
  }
}

class Histogram {
  private buckets: Map<number, number>;
  private sum = 0;
  private count = 0;

  constructor(
    private readonly name: string,
    private readonly help: string,
    bounds: number[]
  ) {
    this.buckets = new Map(bounds.map((b) => [b, 0]));
  }

  observe(value: number): void {
    this.sum += value;
    this.count++;
    for (const bound of this.buckets.keys()) {
      if (value <= bound) {
        this.buckets.set(bound, (this.buckets.get(bound) ?? 0) + 1);
      }
    }
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const [bound, cnt] of this.buckets) {
      lines.push(`${this.name}_bucket{le="${bound}"} ${cnt}`);
    }
    lines.push(`${this.name}_bucket{le="+Inf"} ${this.count}`);
    lines.push(`${this.name}_sum ${this.sum}`);
    lines.push(`${this.name}_count ${this.count}`);
    return lines.join("\n");
  }
}

// ── Metric instances ──────────────────────────────────────────────────────────

export const chargesTotalCounter = new Counter(
  "payflow_keeper_charges_total",
  "Total number of charge call outcomes by result.",
  ["result"]
);

export const batchDurationHistogram = new Histogram(
  "payflow_keeper_batch_duration_seconds",
  "Histogram of keeper batch processing latency in seconds.",
  [0.1, 0.5, 1, 2, 5, 10, 30, 60]
);

export const feeSpendGauge = new Gauge(
  "payflow_keeper_fee_spend_stroops",
  "Latest resource fee paid by the keeper in stroops."
);

export const adaptiveFeeHistogram = new Histogram(
  "payflow_keeper_adaptive_fee_stroops",
  "Histogram of adaptive resource fees calculated (in stroops).",
  [10000, 50000, 100000, 500000, 1000000, 5000000, 10000000, 100000000]
);

export const feeBumpCounter = new Counter(
  "payflow_keeper_fee_bump_total",
  "Total number of fee-bump envelopes submitted."
);

export const rpcErrorCounter = new Counter(
  "payflow_keeper_rpc_errors_total",
  "Total RPC errors encountered by the keeper.",
  ["operation"]
);

export const dlqSizeGauge = new Gauge(
  "payflow_keeper_dlq_size",
  "Current depth of the dead-letter queue (failed batches awaiting retry)."
);

export const lastRunGauge = new Gauge(
  "payflow_keeper_last_run_timestamp_seconds",
  "Unix timestamp of the last keeper run."
);

export const heartbeatCounter = new Counter(
  "payflow_keeper_heartbeat_total",
  "Monotonically increasing heartbeat counter incremented on every keeper cycle."
);

// ── All metrics registry ──────────────────────────────────────────────────────

const ALL_METRICS = [
  chargesTotalCounter,
  batchDurationHistogram,
  feeSpendGauge,
  adaptiveFeeHistogram,
  feeBumpCounter,
  rpcErrorCounter,
  dlqSizeGauge,
  lastRunGauge,
  heartbeatCounter,
];

// ── HTTP server ───────────────────────────────────────────────────────────────

let server: http.Server | null = null;

/**
 * startMetricsServer — starts the Prometheus /metrics HTTP endpoint.
 * Call once from the keeper entry-point.
 */
export function startMetricsServer(port = METRICS_PORT): http.Server {
  server = http.createServer((req, res) => {
    if (req.url === "/metrics" && req.method === "GET") {
      const body = ALL_METRICS.map((m) => m.serialize()).join("\n\n");
      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4",
        "Cache-Control": "no-cache",
      });
      res.end(body + "\n");
    } else if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[PayFlow Keeper] Metrics server listening on :${port}/metrics`);
  });

  return server;
}

/** Stop the metrics server (useful in tests). */
export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    server = null;
 * metrics-server.ts — Prometheus metrics exporter for the FlowPay keeper.
 *
 * Starts an HTTP server on METRICS_PORT (default 9090) serving /metrics
 * in Prometheus text format. Exposes counters and histograms that the
 * keeper run loop updates after each batch_charge cycle.
 *
 * Usage:
 *   tsx scripts/metrics-server.ts
 *
 * Environment Variables:
 *   METRICS_PORT          HTTP port for the /metrics endpoint (default: 9090)
 *   CONTRACT_ID           For active subscriber gauge (optional — read-only)
 *   RPC_URL               Soroban RPC endpoint (default: testnet)
 *   NETWORK_PASSPHRASE    Stellar network passphrase
 *
 * Exposed Metrics:
 *   keeper_charges_total{status}         — Counter, success / failed
 *   keeper_batch_duration_seconds        — Histogram of batch charge duration
 *   keeper_rpc_errors_total              — Counter, RPC error count
 *   keeper_active_subscribers            — Gauge, current active subscriber count
 *   keeper_batch_size                    — Gauge, addresses per batch
 *   keeper_cycles_total                  — Counter, total charge cycles run
 *   indexer_duplicate_events_total       — Counter, duplicate events skipped by EventDedupCache
 *   indexer_dedup_cache_size             — Gauge, current EventDedupCache entry count
 *   indexer_dedup_evictions_total        — Counter, LRU evictions from EventDedupCache
 */

import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import type { Server } from "node:http";
import { logger as rootLogger } from "./logger.js";

const logger = rootLogger.child({ script: "metrics-server" });

// ── Configuration ────────────────────────────────────────────────────────────

const METRICS_PORT = parseInt(process.env.METRICS_PORT ?? "9090", 10);

// ── Registry & default metrics ───────────────────────────────────────────────

const registry = new Registry();

// Collect Node.js default metrics (CPU, memory, event loop, GC, etc.)
collectDefaultMetrics({ register: registry });

// ── Custom metrics ───────────────────────────────────────────────────────────

/** Total charge outcomes per cycle, labeled by status (success / failed). */
const chargesTotal = new Counter({
  name: "keeper_charges_total",
  help: "Total number of charge outcomes, labeled by status",
  labelNames: ["status"] as const,
  registers: [registry],
});

/** Histogram of how long a single batch_charge call takes in seconds. */
const batchDurationSeconds = new Histogram({
  name: "keeper_batch_duration_seconds",
  help: "Duration of batch_charge calls in seconds",
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60],
  registers: [registry],
});

/** Total RPC-level errors encountered by the keeper. */
const rpcErrorsTotal = new Counter({
  name: "keeper_rpc_errors_total",
  help: "Total number of RPC errors encountered by the keeper",
  registers: [registry],
});

/** Gauge of the currently known active subscriber count. */
const activeSubscribers = new Gauge({
  name: "keeper_active_subscribers",
  help: "Number of active (non-paused) subscribers the keeper is tracking",
  registers: [registry],
});

/** Gauge of the addresses per batch_charge call. */
const batchSize = new Gauge({
  name: "keeper_batch_size",
  help: "Number of addresses included in the most recent batch_charge call",
  registers: [registry],
});

/** Total keeper charge cycles completed. */
const cyclesTotal = new Counter({
  name: "keeper_cycles_total",
  help: "Total number of charge cycles completed by the keeper",
  registers: [registry],
});

/** Total duplicate events skipped by an EventDedupCache (indexer, watch-events, etc.). */
const indexerDuplicatesTotal = new Counter({
  name: "indexer_duplicate_events_total",
  help: "Total number of duplicate events skipped via EventDedupCache",
  registers: [registry],
});

/** Current number of entries held in the EventDedupCache. */
const indexerDedupCacheSize = new Gauge({
  name: "indexer_dedup_cache_size",
  help: "Current entry count of the EventDedupCache",
  registers: [registry],
});

/** Total LRU evictions performed by the EventDedupCache. */
const indexerDedupEvictionsTotal = new Counter({
  name: "indexer_dedup_evictions_total",
  help: "Total number of LRU evictions performed by the EventDedupCache",
  registers: [registry],
});

/** Ledger gaps detected (RPC retention pruned ledgers the indexer had not read). */
const indexerLedgerGapsTotal = new Counter({
  name: "indexer_ledger_gaps_total",
  help: "Total number of ledger gaps detected by the indexer",
  registers: [registry],
});

/** Ledgers skipped across all detected gaps. */
const indexerLedgerGapLedgersTotal = new Counter({
  name: "indexer_ledger_gap_ledgers_total",
  help: "Total number of ledgers lost to detected gaps",
  registers: [registry],
});

/** Gaps not yet backfilled. */
const indexerOpenLedgerGaps = new Gauge({
  name: "indexer_open_ledger_gaps",
  help: "Number of detected ledger gaps that have not been backfilled",
  registers: [registry],
});

/** Highest ledger the indexer has fully processed. */
const indexerLastProcessedLedger = new Gauge({
  name: "indexer_last_processed_ledger",
  help: "Last ledger successfully processed by the indexer",
  registers: [registry],
});

/** Oldest ledger the RPC provider currently serves. */
const indexerOldestAvailableLedger = new Gauge({
  name: "indexer_oldest_available_ledger",
  help: "Oldest ledger available from the RPC provider (retention boundary)",
  registers: [registry],
});

/** Total RPC failovers across multiple endpoints. */
const rpcFailoversTotal = new Counter({
  name: "keeper_rpc_failovers_total",
  help: "Total number of RPC failovers triggered",
  registers: [registry],
});

/** Granular outcomes for each subscriber checked. */
const chargeResultsTotal = new Counter({
  name: "keeper_charge_results_total",
  help: "Total number of charge outcomes labeled by specific contract result",
  labelNames: ["result"] as const,
  registers: [registry],
});

// ── Public API for the keeper run loop ───────────────────────────────────────

/**
 * Record the outcome of a batch_charge call.
 *
 * @param status     - "success" when the call completed, "failed" when it threw.
 * @param charged    - Number of subscribers successfully charged in the batch.
 * @param skipped    - Number of subscribers skipped (not due, paused, etc.).
 * @param durationMs - Wall-clock duration of the batch_charge RPC call in ms.
 * @param rpcError   - Set to true when an RPC-level error occurred.
 */
export function recordBatchCharge(params: {
  status: "success" | "failed";
  charged: number;
  skipped: number;
  durationMs: number;
  rpcError?: boolean;
}): void {
  if (params.status === "success") {
    chargesTotal.inc({ status: "success" }, params.charged);
    // Skipped is NOT a failure — it's normal eligibility (not due, paused, etc.).
    // Only true failures (RPC errors, contract panics) increment the "failed" label.
    batchSize.set(params.charged + params.skipped);
  } else {
    chargesTotal.inc({ status: "failed" }, 1);
  }

  batchDurationSeconds.observe(params.durationMs / 1000);

  if (params.rpcError) {
    rpcErrorsTotal.inc(1);
  }
}

/** Record specific granular charge results. */
export function recordChargeResults(results: Record<string, number>): void {
  for (const [result, count] of Object.entries(results)) {
    chargeResultsTotal.inc({ result }, count);
  }
}

/** Increment the RPC error counter. */
export function incrementRpcErrors(): void {
  rpcErrorsTotal.inc(1);
}

/** Increment the RPC failovers counter. */
export function incrementRpcFailovers(): void {
  rpcFailoversTotal.inc(1);
}

/** Set the current active subscriber count gauge. */
export function setActiveSubscribers(count: number): void {
  activeSubscribers.set(count);
}

/** Increment the cycle counter. */
export function incrementCycles(): void {
  cyclesTotal.inc(1);
}

/** Record a batch_charge duration manually. */
export function observeBatchDuration(durationMs: number): void {
  batchDurationSeconds.observe(durationMs / 1000);
}

// Prometheus Counters only support incrementing by a delta, but
// EventDedupCache.stats reports cumulative totals — track the last-seen
// cumulative values here so repeated calls only add the difference.
let lastDedupHits = 0;
let lastDedupEvictions = 0;

/**
 * Record a snapshot of `EventDedupCache.stats` (hits/evictions/size) into the
 * Prometheus registry. Safe to call repeatedly (e.g. once per poll cycle) —
 * counters are incremented by the delta since the last call, and the size
 * gauge is set to the current value.
 */
export function recordIndexerDedupStats(stats: {
  hits: number;
  evictions: number;
  size: number;
}): void {
  const hitsDelta = stats.hits - lastDedupHits;
  if (hitsDelta > 0) indexerDuplicatesTotal.inc(hitsDelta);
  lastDedupHits = stats.hits;

  const evictionsDelta = stats.evictions - lastDedupEvictions;
  if (evictionsDelta > 0) indexerDedupEvictionsTotal.inc(evictionsDelta);
  lastDedupEvictions = stats.evictions;

  indexerDedupCacheSize.set(stats.size);
}

/** Record a newly detected ledger gap of `ledgerCount` ledgers. */
export function recordLedgerGap(ledgerCount: number): void {
  indexerLedgerGapsTotal.inc();
  indexerLedgerGapLedgersTotal.inc(ledgerCount);
}

/** Set the current number of un-backfilled gaps. */
export function setOpenLedgerGaps(count: number): void {
  indexerOpenLedgerGaps.set(count);
}

/** Record indexer progress and the RPC retention boundary (either may be omitted). */
export function setIndexerLedgerPosition(pos: {
  lastProcessed?: number;
  oldestAvailable?: number;
}): void {
  if (pos.lastProcessed !== undefined) indexerLastProcessedLedger.set(pos.lastProcessed);
  if (pos.oldestAvailable !== undefined) indexerOldestAvailableLedger.set(pos.oldestAvailable);
}

/**
 * Return the Prometheus text-format metrics string.
 * Used by the HTTP handler — also available for testing.
 */
export async function metricsText(): Promise<string> {
  return registry.metrics();
}

// ── HTTP server ──────────────────────────────────────────────────────────────

let server: Server | null = null;

/**
 * Start the metrics HTTP server on the configured port.
 *
 * If the port is already in use, logs an error and returns `false`
 * without crashing — the keeper should continue operating without metrics.
 *
 * @returns `true` when the server started, `false` otherwise.
 */
export function startMetricsServer(): boolean {
  if (server) return true; // Already running

  try {
    server = http.createServer(async (_req, res) => {
      try {
        const text = await metricsText();
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
        res.end(text);
      } catch (err) {
        res.writeHead(500);
        res.end(
          `# metrics collection failed: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        logger.error("Port already in use — keeper will continue without metrics", {
          port: METRICS_PORT,
        });
        server?.close();
        server = null;
      } else {
        logger.error("Metrics server error", { error: err.message });
      }
    });

    server.listen(METRICS_PORT, () => {
      logger.info("Prometheus metrics server listening", {
        port: METRICS_PORT,
        path: "/metrics",
      });
    });

    return true;
  } catch (err) {
    logger.error("Failed to start metrics server", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Gracefully stop the metrics server. Safe to call when not running.
 */
export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      logger.info("Metrics server stopped");
      server = null;
      resolve();
    });
  });
}

// ── Standalone mode ──────────────────────────────────────────────────────────

/**
 * When run directly (not imported), start the metrics server in standalone
 * mode. The keeper metrics will all show zero / default values until a
 * keeper process imports and uses the exported record* functions.
 */
async function main(): Promise<void> {
  logger.info("Starting standalone metrics server", { port: METRICS_PORT });
  startMetricsServer();

  // Keep the process alive. In standalone mode the metrics just reflect
  // defaults (zero counters / empty histograms) unless a keeper updates them.
  process.on("SIGINT", async () => {
    logger.info("Shutting down (SIGINT)");
    await stopMetricsServer();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Shutting down (SIGTERM)");
    await stopMetricsServer();
    process.exit(0);
  });
}

// ESM detection: compare resolved path to the main script.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    logger.error("Fatal error", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
