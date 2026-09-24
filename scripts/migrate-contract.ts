/**
 * Migrate contract storage with pre/post version checks.
 * Usage: npx tsx scripts/migrate-contract.ts [--dry-run|--simulate] [userAddress ...]
 *
 * Simulation-first: without addresses the script simulates `get_schema_version`
 * before/after; with `--dry-run` (alias `--simulate`) it reports the exact
 * `migrate` invocation without submitting.
 */

import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { MultiEndpointServer } from "./rpc-client.js";
import { logger } from "./logger.js";

const RPC_URL =
  process.env.VITE_RPC_URL ??
  process.env.RPC_URL ??
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.VITE_NETWORK_PASSPHRASE ??
  process.env.NETWORK_PASSPHRASE ??
  Networks.TESTNET;
const CONTRACT_ID =
  process.env.VITE_CONTRACT_ID ?? process.env.CONTRACT_ID ?? "";

// Simulation source: all-zero simulator account (never signs, simulation only).
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

/**
 * Encode `migrate(users)` arguments as an xdr.ScVal array.
 * The contract takes a single `Vec<Address>` param, so the result is a
 * one-element array holding a vec ScVal.
 */
export function encodeMigrateArgs(users: string[]): xdr.ScVal[] {
  const vec = nativeToScVal(
    users.map((u) => Address.fromString(u)),
    { type: "vec" },
  );
  return [vec];
}

/** Decode a `get_schema_version` simulation retval to a number. */
export function decodeSchemaVersion(retval: xdr.ScVal): number {
  return Number(retval.u32());
}

async function getSchemaVersion(): Promise<number> {
  const server = new MultiEndpointServer(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  // Simulation-only read; no signing required.
  const account = await server.getAccount(SIMULATION_SOURCE);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_schema_version"))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) throw new Error("No return value from get_schema_version");

  return decodeSchemaVersion(retval);
}

async function migrate(users: string[]): Promise<void> {
  const server = new MultiEndpointServer(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  // Simulation-only (in production, use the admin wallet to submit).
  const account = await server.getAccount(SIMULATION_SOURCE);

  const args = encodeMigrateArgs(users);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("migrate", ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  logger.info("Migration transaction simulated successfully");
}

export interface MigrateOptions {
  dryRun: boolean;
  users: string[];
}

export function parseMigrateArgs(argv: string[]): MigrateOptions {
  const dryRun =
    argv.includes("--dry-run") || argv.includes("--simulate");
  const users = argv.filter(
    (a) => a !== "--dry-run" && a !== "--simulate" && !a.startsWith("--"),
  );
  return { dryRun, users };
}

async function main() {
  const { dryRun, users } = parseMigrateArgs(process.argv.slice(2));

  logger.info("Starting contract migration...\n");

  // Get pre-migration version
  const preVersion = await getSchemaVersion();
  logger.info(`Pre-migration schema version: ${preVersion}`);

  if (dryRun) {
    logger.info("\n[Dry-run mode] Skipping actual migration");
    logger.info(`Would call migrate with ${users.length} user(s).`);
    logger.info(`Post-migration version would be: ${preVersion}`);
    return;
  }

  logger.info("\nCalling migrate...");
  await migrate(users);

  // Get post-migration version
  const postVersion = await getSchemaVersion();
  logger.info(`Post-migration schema version: ${postVersion}`);

  // Verify version incremented
  if (postVersion <= preVersion) {
    logger.error(
      `\nERROR: Schema version did not increment! (${preVersion} -> ${postVersion})`,
    );
    process.exit(1);
  }

  logger.info(
    `\nMigration successful! Version incremented from ${preVersion} to ${postVersion}`,
  );
}

import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] &&
  import.meta.url.startsWith("file:") &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    logger.error("Migration failed:", err.message ?? err);
    process.exit(1);
  });
}
