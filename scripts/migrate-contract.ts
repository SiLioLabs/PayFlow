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

const RPC_URL =
  process.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
import { Contract, Networks, TransactionBuilder, BASE_FEE, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { logger } from "./logger";

const RPC_URL = process.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "";

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

  const usersVec = users.map((u) => addressVal(u));

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("migrate", usersVec as unknown as xdr.ScVal))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  logger.info("Migration transaction simulated successfully");
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  logger.info("Starting contract migration...\n");

  // Get pre-migration version
  const preVersion = await getSchemaVersion();
  logger.info(`Pre-migration schema version: ${preVersion}`);

  if (dryRun) {
    logger.info("\n[Dry-run mode] Skipping actual migration");
    logger.info(`Post-migration version would be: ${preVersion}`);
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
    console.error(
      `\nERROR: Schema version did not increment! (${preVersion} -> ${postVersion})`,
    );
    process.exit(1);
  }

  console.log(
    `\nMigration successful! Version incremented from ${preVersion} to ${postVersion}`,
  );
    logger.error(`\nERROR: Schema version did not increment! (${preVersion} -> ${postVersion})`);
    process.exit(1);
  }

  logger.info(`\nMigration successful! Version incremented from ${preVersion} to ${postVersion}`);
}

main().catch((err) => {
  logger.error("Migration failed:", err.message);
  process.exit(1);
});
