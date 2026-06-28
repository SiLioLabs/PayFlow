/**
 * health-check.ts — Contract health check script for FlowPay.
 *
 * Verifies that the deployed contract is responsive by calling:
 *   - get_schema_version()
 *   - get_active_count()
 *
 * Suitable for Docker health checks and cron-based monitoring.
 *
 * Usage:
 *   npx ts-node scripts/health-check.ts
 *
 * Environment variables:
 *   CONTRACT_ID  — Deployed FlowPay contract ID (required)
 *   RPC_URL      — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *   NETWORK      — Network passphrase identifier (default: testnet)
 *
 * Exit codes:
 *   0 — healthy (both calls returned valid responses)
 *   1 — unhealthy (one or more calls failed or returned invalid data)
 */

import { Contract, Networks, TransactionBuilder, BASE_FEE, Address } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

// ── Configuration ────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID || process.env.VITE_CONTRACT_ID || "";
const RPC_URL = process.env.RPC_URL || process.env.VITE_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK === "mainnet"
    ? Networks.PUBLIC
    : process.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

// A zero-funded source account used solely for simulating read-only calls.
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toISOString();
}

function log(status: "healthy" | "unhealthy", detail?: string): void {
  const line = `${timestamp()} contract=${CONTRACT_ID || "NOT_SET"} status=${status}`;
  if (detail) {
    console.log(`${line} detail=${detail}`);
  } else {
    console.log(line);
  }
}

/**
 * Simulate a read-only contract call and return the raw result xdr.
 */
async function simulateCall(server: Server, fnName: string): Promise<unknown> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(SIMULATION_SOURCE).catch(() => {
    // For simulation-only calls, build a synthetic account if lookup fails.
    return new (await import("@stellar/stellar-sdk")).Account(SIMULATION_SOURCE, "0");
  });

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(fnName))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if ("error" in simulation && simulation.error) {
    throw new Error(`Simulation failed for ${fnName}: ${simulation.error}`);
  }

  if (!("result" in simulation) || !simulation.result) {
    throw new Error(`No result returned for ${fnName}`);
  }

  return simulation.result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate configuration
  if (!CONTRACT_ID) {
    log("unhealthy", "CONTRACT_ID environment variable is not set");
    process.exit(1);
  }

  const server = new Server(RPC_URL);

  try {
    // Call get_schema_version
    const schemaResult = await simulateCall(server, "get_schema_version");
    if (schemaResult === undefined || schemaResult === null) {
      log("unhealthy", "get_schema_version returned no data");
      process.exit(1);
    }

    // Call get_active_count (active subscription count)
    const countResult = await simulateCall(server, "get_active_count");
    if (countResult === undefined || countResult === null) {
      log("unhealthy", "get_active_count returned no data");
      process.exit(1);
    }

    // Both calls succeeded with valid responses
    log("healthy");
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log("unhealthy", message);
    process.exit(1);
  }
}

main();
