/**
 * health-check.ts — Contract health check script for FlowPay.
 *
 * Shallow mode (default):
 *   Verifies contract responsiveness via get_schema_version() and
 *   get_active_count(). Suitable for Docker health checks and
 *   lightweight cron-based monitoring.
 *
 * Deep mode (--deep or HEALTH_DEEP=true):
 *   Calls the on-chain contract_health_check() to obtain a full
 *   HealthReport, samples get_batch_charge_estimate with an empty
 *   address list to verify the charge-path liveness, and exits
 *   non-zero when any critical invariant fails (paused, unhealthy,
 *   RPC decode errors).
 *
 * Usage:
 *   npx tsx scripts/health-check.ts            # shallow (default)
 *   npx tsx scripts/health-check.ts --deep     # deep checks
 *   npx tsx scripts/health-check.ts --json     # JSON output (any mode)
 *   npx tsx scripts/health-check.ts --deep --json
 *
 * Environment variables:
 *   CONTRACT_ID   — Deployed FlowPay contract ID (required)
 *   RPC_URL       — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *   RPC_URLS      — Optional comma-separated endpoints in failover order
 *   NETWORK       — Network passphrase identifier (default: testnet)
 *   HEALTH_DEEP   — Set "true" to enable deep checks without --deep flag
 *
 * Exit codes:
 *   0 — healthy
 *   1 — unhealthy (one or more calls failed, returned invalid data,
 *       or a critical invariant was violated)
 */

import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { logger as rootLogger } from "./logger.js";

// ── Configuration ────────────────────────────────────────────────────────────

const CONTRACT_ID =
  process.env.CONTRACT_ID || process.env.VITE_CONTRACT_ID || "";
const RPC_URL =
  process.env.RPC_URL ||
  process.env.VITE_RPC_URL ||
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK === "mainnet"
    ? Networks.PUBLIC
    : process.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

// A zero-funded source account used solely for simulating read-only calls.
const SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// ── Logger ────────────────────────────────────────────────────────────────────

const logger = rootLogger.child({
  script: "health-check",
  contract: CONTRACT_ID,
  rpc: RPC_URL,
});
// ── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DEEP = args.includes("--deep") || process.env.HEALTH_DEEP === "true";
const JSON_OUTPUT = args.includes("--json");

// ── Types ────────────────────────────────────────────────────────────────────

/** Mirrors the on-chain HealthReport struct returned by contract_health_check. */
interface HealthReport {
  is_healthy: boolean;
  contract_paused: boolean;
  token_configured: boolean;
  admin_configured: boolean;
  instance_bump_age_ledgers?: number | null;
  active_subscription_count: number | bigint;
  schema_version: number;
  fee_collector_set: boolean;
  global_volume_utilization_pct: number;
  pending_merchant_rev_count: number;
}

/** Typed probe result for structured output. */
interface ProbeResult {
  name: string;
  ok: boolean;
  detail?: string;
  data?: unknown;
}

/** Top-level output shape for JSON mode. */
interface HealthCheckOutput {
  status: "healthy" | "unhealthy";
  mode: "shallow" | "deep";
  contract: string;
  timestamp: string;
  probes: ProbeResult[];
  healthReport?: HealthReport;
  batchEstimate?: string;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toISOString();
}

function log(status: "healthy" | "unhealthy", detail?: string): void {
  if (JSON_OUTPUT) return; // suppressed in JSON mode; written at the end
  const line = `${timestamp()} contract=${CONTRACT_ID || "NOT_SET"} status=${status}`;
  if (detail) {
    logger.info(`${line} detail=${detail}`);
  } else {
    logger.info(line);
  }
}

function logJSON(output: HealthCheckOutput): void {
  const json = JSON.stringify(output, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value, 2);
  process.stdout.write(json + "\n");
}

/** Simulate a read-only call and decode the Soroban return value. */
async function simulateCall(
  servers: rpc.Server[],
  fnName: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> {
  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(fnName, ...args))
    .setTimeout(30)
    .build();

  const failures: string[] = [];
  for (const server of servers) {
    try {
      const simulation = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(simulation.error);
      }
      if (!simulation.result?.retval) {
        throw new Error("No return value");
      }
      return scValToNative(simulation.result.retval);
    } catch (err: unknown) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(`Simulation failed for ${fnName}: ${failures.join("; ")}`);
}

function extractHealthReport(report: unknown): HealthReport {
  if (
    report && typeof report === "object" &&
    "is_healthy" in report && typeof report.is_healthy === "boolean" &&
    "contract_paused" in report && typeof report.contract_paused === "boolean" &&
    "token_configured" in report && typeof report.token_configured === "boolean" &&
    "admin_configured" in report && typeof report.admin_configured === "boolean"
  ) {
    return report as HealthReport;
  }
  throw new Error("Unable to decode HealthReport from simulation result");
}

// ── Deep probe functions ─────────────────────────────────────────────────────

/**
 * Call contract_health_check and validate the HealthReport invariants.
 * Returns a ProbeResult indicating pass/fail.
 */
async function probeContractHealthCheck(
  servers: rpc.Server[],
): Promise<ProbeResult> {
  try {
    const result = await simulateCall(servers, "contract_health_check");
    const report = extractHealthReport(result);

    // Validate critical invariants
    const failures: string[] = [];

    if (report.contract_paused) {
      failures.push("contract is paused");
    }
    if (!report.is_healthy) {
      failures.push("is_healthy is false");
    }
    if (!report.token_configured) {
      failures.push("token not configured");
    }
    if (!report.admin_configured) {
      failures.push("admin not configured");
    }
    const age = report.instance_bump_age_ledgers;
    const maxBumpAgeLedgers = 17_280; // About one day at five seconds per ledger.
    if (age == null) {
      failures.push("instance TTL maintenance ledger unavailable");
    } else if (!Number.isInteger(age) || age < 0 || age > 0xffff_ffff) {
      failures.push("invalid instance TTL maintenance age");
    } else if (age > maxBumpAgeLedgers) {
      failures.push(
        `instance TTL maintenance age is ${age} ledgers (threshold ${maxBumpAgeLedgers})`,
      );
    }

    const ok = failures.length === 0;
    return {
      name: "contract_health_check",
      ok,
      detail: ok ? "all invariants pass" : failures.join("; "),
      data: report,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "contract_health_check",
      ok: false,
      detail: message,
    };
  }
}

/**
 * Call get_batch_charge_estimate with an empty address list to verify the
 * charge path is responsive (RPC decode works, contract logic reachable).
 * The contract returns an empty Vec for an empty input — any error here
 * signals schema drift, RPC issues, or a broken charge path.
 */
async function probeBatchEstimate(
  servers: rpc.Server[],
): Promise<ProbeResult> {
  try {
    // get_batch_charge_estimate expects Vec<Address>. An empty vec is valid.
    const emptyVec = nativeToScVal([], { type: "vec" });
    const decoded = await simulateCall(
      servers,
      "get_batch_charge_estimate",
      [emptyVec],
    );

    // The result should be an empty Vec — any decode failure means the
    // charge path has schema drift.
    const isEmpty =
      decoded === null ||
      decoded === undefined ||
      (Array.isArray(decoded) && decoded.length === 0);

    if (!isEmpty) {
      return {
        name: "get_batch_charge_estimate",
        ok: true, // non-empty is unexpected for empty input but not unhealthy
        detail: `unexpected non-empty result (${Array.isArray(decoded) ? decoded.length : "unknown"} items)`,
        data: decoded,
      };
    }

    return {
      name: "get_batch_charge_estimate",
      ok: true,
      detail: "empty list accepted, charge path responsive",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "get_batch_charge_estimate",
      ok: false,
      detail: `charge path probe failed: ${message}`,
    };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate configuration
  if (!CONTRACT_ID) {
    logger.error("CONTRACT_ID environment variable is not set", { status: "unhealthy" });
    log("unhealthy", "CONTRACT_ID environment variable is not set");
    if (JSON_OUTPUT) {
      logJSON({
        status: "unhealthy",
        mode: DEEP ? "deep" : "shallow",
        contract: "",
        timestamp: timestamp(),
        probes: [],
        error: "CONTRACT_ID environment variable is not set",
      });
    }
    process.exit(1);
  }

  const endpoints = (process.env.RPC_URLS || RPC_URL)
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const servers = (endpoints.length ? endpoints : [RPC_URL]).map((url) =>
    new rpc.Server(url, { allowHttp: url.startsWith("http://"), timeout: 30_000 }),
  );
  const probes: ProbeResult[] = [];
  let healthReport: HealthReport | undefined;
  let batchEstimate: string | undefined;
  let overallError: string | undefined;

  try {
    // ── Shallow probes (always run) ───────────────────────────────────

    // Probe 1: get_schema_version
    try {
      const schemaResult = await simulateCall(servers, "get_schema_version");
      if (schemaResult === undefined || schemaResult === null) {
        probes.push({
          name: "get_schema_version",
          ok: false,
          detail: "returned no data",
        });
      } else {
        probes.push({
          name: "get_schema_version",
          ok: true,
          detail: `schema version response received`,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      probes.push({
        name: "get_schema_version",
        ok: false,
        detail: message,
      });
    }

    // Probe 2: get_active_count
    try {
      const countResult = await simulateCall(servers, "get_active_count");
      if (countResult === undefined || countResult === null) {
        probes.push({
          name: "get_active_count",
          ok: false,
          detail: "returned no data",
        });
      } else {
        probes.push({
          name: "get_active_count",
          ok: true,
          detail: "active count response received",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      probes.push({
        name: "get_active_count",
        ok: false,
        detail: message,
      });
    }

    // ── Deep probes (only when --deep or HEALTH_DEEP=true) ────────────

    if (DEEP) {
      // Probe 3: contract_health_check
      const healthProbe = await probeContractHealthCheck(servers);
      probes.push(healthProbe);
      if (healthProbe.data && typeof healthProbe.data === "object") {
        healthReport = healthProbe.data as HealthReport;
      }

      // Probe 4: get_batch_charge_estimate (empty list liveness)
      const batchProbe = await probeBatchEstimate(servers);
      probes.push(batchProbe);
      if (batchProbe.detail) {
        batchEstimate = batchProbe.detail;
      }
    }

    // ── Evaluate overall status ───────────────────────────────────────

    // All probes must pass
    const allProbesPassed = probes.every((p) => p.ok);

    // In deep mode, also require healthReport.is_healthy and not paused
    let deepInvariantsPass = true;
    if (DEEP && healthReport) {
      deepInvariantsPass =
        healthReport.is_healthy && !healthReport.contract_paused;
    }

    const healthy = allProbesPassed && deepInvariantsPass;

    if (healthy) {
      log("healthy");
      if (JSON_OUTPUT) {
        logJSON({
          status: "healthy",
          mode: DEEP ? "deep" : "shallow",
          contract: CONTRACT_ID,
          timestamp: timestamp(),
          probes,
          healthReport,
          batchEstimate,
        });
      }
      process.exit(0);
    } else {
      const reasons = probes
        .filter((p) => !p.ok)
        .map((p) => `${p.name}: ${p.detail}`)
        .join("; ");
      log("unhealthy", reasons || "invariant check failed");

      if (!reasons) {
        overallError = "deep invariant check failed (paused or unhealthy)";
      }

      if (JSON_OUTPUT) {
        logJSON({
          status: "unhealthy",
          mode: DEEP ? "deep" : "shallow",
          contract: CONTRACT_ID,
          timestamp: timestamp(),
          probes,
          healthReport,
          batchEstimate,
          error: overallError || reasons,
        });
      }
      process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log("unhealthy", message);
    if (JSON_OUTPUT) {
      logJSON({
        status: "unhealthy",
        mode: DEEP ? "deep" : "shallow",
        contract: CONTRACT_ID,
        timestamp: timestamp(),
        probes,
        healthReport,
        batchEstimate,
        error: message,
      });
    }
    process.exit(1);
  }
}

main();
