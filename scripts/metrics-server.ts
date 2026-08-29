/**
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
 */

import http from "node:http";
import { fileURLToPath } from "node:url";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import type { Server } from "node:http";

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

/** Increment the RPC error counter. */
export function incrementRpcErrors(): void {
  rpcErrorsTotal.inc(1);
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
        res.end(`# metrics collection failed: ${err instanceof Error ? err.message : err}\n`);
      }
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `[metrics] Port ${METRICS_PORT} already in use — keeper will continue without metrics`
        );
        server?.close();
        server = null;
      } else {
        console.error(`[metrics] Server error: ${err.message}`);
      }
    });

    server.listen(METRICS_PORT, () => {
      console.error(`[metrics] Prometheus metrics server listening on :${METRICS_PORT}/metrics`);
    });

    return true;
  } catch (err) {
    console.error(
      `[metrics] Failed to start metrics server: ${err instanceof Error ? err.message : err}`
    );
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
      console.error("[metrics] Server stopped");
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
  console.error(`[metrics] Starting standalone metrics server on port ${METRICS_PORT}`);
  startMetricsServer();

  // Keep the process alive. In standalone mode the metrics just reflect
  // defaults (zero counters / empty histograms) unless a keeper updates them.
  process.on("SIGINT", async () => {
    console.error("\n[metrics] Shutting down...");
    await stopMetricsServer();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await stopMetricsServer();
    process.exit(0);
  });
}

// ESM detection: compare resolved path to the main script.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`[metrics] Fatal: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
