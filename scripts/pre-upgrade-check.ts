/**
 * pre-upgrade-check.ts
 *
 * Verifies the on-chain state of a deployed FlowPay contract before
 * performing an irreversible WASM upgrade.
 *
 * Usage:
 *   npx ts-node scripts/pre-upgrade-check.ts [--confirm]
 *
 * Environment variables (or .env in project root):
 *   CONTRACT_ID          – deployed contract address
 *   RPC_URL              – Soroban RPC endpoint (default: testnet)
 *   NETWORK_PASSPHRASE   – Stellar network passphrase
 */

import {
  Contract,
  Networks,
  TransactionBuilder,
  Account,
  BASE_FEE,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

// ── Config ───────────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const RPC_URL =
  process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;

// Dummy source account used solely for simulation (no auth needed)
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const CONFIRM = process.argv.includes("--confirm");

// ── Helpers ──────────────────────────────────────────────────────────────────

const server = new Server(RPC_URL);

async function simulateReadOnly(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal> {
  const contract = new Contract(CONTRACT_ID);
  const sourceAccount = new Account(SIM_SOURCE, "0");

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);

  if ("error" in result) {
    throw new Error(`Simulation error for ${method}: ${result.error}`);
  }
  if (!result.result?.retval) {
    throw new Error(`No return value from ${method}`);
  }
  return result.result.retval;
}

function scValToString(val: xdr.ScVal): string {
  switch (val.switch()) {
    case xdr.ScValType.scvAddress():
      return val.address().toString();
    case xdr.ScValType.scvU64():
      return val.u64().toString();
    case xdr.ScValType.scvU32():
      return val.u32().toString();
    case xdr.ScValType.scvString():
      return Buffer.from(val.str()).toString();
    default:
      return val.toXDR("base64");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    process.exit(1);
  }

  console.log("=== FlowPay Pre-Upgrade Check ===");
  console.log(`Contract : ${CONTRACT_ID}`);
  console.log(`RPC URL  : ${RPC_URL}`);
  console.log(`Network  : ${NETWORK_PASSPHRASE}`);
  console.log("");

  // 1. Admin address
  const adminVal = await simulateReadOnly("get_admin");
  const admin = scValToString(adminVal);
  console.log(`Admin address      : ${admin}`);

  // 2. Active subscription count
  const countVal = await simulateReadOnly("get_active_count");
  const activeCount = scValToString(countVal);
  console.log(`Active subscriptions: ${activeCount}`);

  if (Number(activeCount) > 0) {
    console.warn(
      `  ⚠  ${activeCount} active subscription(s) will be affected by a storage migration.`
    );
  }

  // 3. Schema version
  const versionVal = await simulateReadOnly("get_schema_version");
  const schemaVersion = scValToString(versionVal);
  console.log(`Schema version     : ${schemaVersion}`);
  if (Number(schemaVersion) < 2) {
    console.warn("  ⚠  Schema is below current version 2 — run migrate() after upgrading.");
  }

  console.log("");

  // 4. Confirmation gate
  if (!CONFIRM) {
    console.log("Checks complete. Re-run with --confirm to proceed with the upgrade.");
    process.exit(0);
  }

  console.log("✔  --confirm flag present. Safe to proceed with upgrade.");
}

main().catch((err) => {
  console.error("Pre-upgrade check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
