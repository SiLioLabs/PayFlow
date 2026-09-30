/**
 * Migrate contract storage with pre/post version checks.
 * Usage: npx tsx scripts/migrate-contract.ts [--dry-run]
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

import { logger } from "./logger";
import { vecAddressToScVal } from "./soroban-admin";

const RPC_URL = process.env.VITE_RPC_URL ?? process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.VITE_NETWORK_PASSPHRASE ?? process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? process.env.CONTRACT_ID ?? "";

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function getSchemaVersion(): Promise<number> {
  const { MultiEndpointServer } = await import("./rpc-client.js");
  const server = new MultiEndpointServer(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  // Use a dummy account for simulation
  const account = await server.getAccount(
    "GCZDMZCNQ5ZRR7IJK2G2H7C5OZS6M5J2G2H7C5OZS6M5J2G2H7C5OZS6",
  );

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

  return Number(retval.u32());
}

async function migrate(users: string[]): Promise<void> {
  const { MultiEndpointServer } = await import("./rpc-client.js");
  const server = new MultiEndpointServer(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  // Use a dummy account for simulation (in production, use admin wallet)
  const account = await server.getAccount(
    "GCZDMZCNQ5ZRR7IJK2G2H7C5OZS6M5J2G2H7C5OZS6M5J2G2H7C5OZS6",
  );

  // Encode as a real ScVec rather than passing a bare JS array: `contract.call`
  // spreads its arguments into individually-encoded ScVals, so a raw array was
  // never valid and had to be laundered through a cast.
  const usersVec = vecAddressToScVal(users);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("migrate", usersVec))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  logger.info("Migration transaction simulated successfully");
}

async function main() {
  const args = process.argv.slice(2);
  // --simulate is the safe default; --dry-run is kept as a backwards-compatible alias.
  const dryRun = args.includes("--simulate") || args.includes("--dry-run");

  if (!CONTRACT_ID) {
    logger.error(
      "ERROR: CONTRACT_ID is not set. Export CONTRACT_ID (or VITE_CONTRACT_ID) before running.",
    );
    process.exit(1);
  }

  logger.info("Starting contract migration...\n");

  // Get pre-migration version
  const preVersion = await getSchemaVersion();
  logger.info(`Pre-migration schema version: ${preVersion}`);

  if (dryRun) {
    logger.info("\n[Simulate mode] Validating migration arguments against the network...");
    // Exercise the ScVal encoding path without submitting anything.
    await migrate([]);
    logger.info(`Post-migration version would be: ${preVersion}`);
    logger.info("\nSimulation successful — no transaction submitted.");
    return;
  }

  // Get users to migrate (empty for now, could be loaded from env or args)
  const users: string[] = [];

  logger.info("\nCalling migrate...");
  await migrate(users);

  // Get post-migration version
  const postVersion = await getSchemaVersion();
  logger.info(`Post-migration schema version: ${postVersion}`);

  // Verify version incremented
  if (postVersion <= preVersion) {
    logger.error(`\nERROR: Schema version did not increment! (${preVersion} -> ${postVersion})`);
    process.exit(1);
  }

  logger.info(`\nMigration successful! Version incremented from ${preVersion} to ${postVersion}`);
}

main().catch((err) => {
  logger.error("Migration failed:", err.message);
  process.exit(1);
});
