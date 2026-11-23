/**
 * Resumable storage migration for the FlowPay contract.
 *
 * The operator supplies the complete list of legacy accounts as a JSON array of
 * G-addresses. The list must be in a stable order with no duplicates, because the
 * contract counts processed accounts and this script resumes by position.
 *
 * The script:
 *   1. reads `get_migration_progress` to find where a previous run stopped,
 *   2. simulates `migrate(batch)` for the accounts still unprocessed, in batches of 50,
 *   3. once every account is processed on-chain, simulates `finalize_migration(total)`.
 *
 * Usage:
 *   CONTRACT_ID=C... npx tsx scripts/migrate-contract.ts --accounts accounts.json
 *
 * This script never submits a transaction. Submitting `migrate` and
 * `finalize_migration` needs the admin key, which is handled outside this script.
 * The `--simulate` and `--dry-run` flags are accepted for compatibility and ignored.
 */

import { readFileSync } from "node:fs";

import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { logger } from "./logger";
import { vecAddressToScVal } from "./soroban-admin";

const NETWORK_PASSPHRASE = process.env.VITE_NETWORK_PASSPHRASE ?? process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? process.env.CONTRACT_ID ?? "";

/** Accounts per `migrate` call. Keeps each transaction well inside ledger limits. */
const BATCH_SIZE = 50;

/** Account used only as the simulation source. Nothing is signed or submitted with it. */
const SIMULATION_ACCOUNT = "GCZDMZCNQ5ZRR7IJK2G2H7C5OZS6M5J2G2H7C5OZS6M5J2G2H7C5OZS6";

interface MigrationProgress {
  schemaVersion: number;
  targetVersion: number;
  migratedAccounts: number;
  complete: boolean;
}

/** Simulates one contract call and returns its return value. Submits nothing. */
async function simulate(method: string, args: xdr.ScVal[]): Promise<xdr.ScVal | undefined> {
  const { MultiEndpointServer } = await import("./rpc-client.js");
  // No argument: the client reads RPC_URLS / RPC_URL / VITE_RPC_URL itself.
  const server = new MultiEndpointServer();
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(SIMULATION_ACCOUNT);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  return (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
}

async function getMigrationProgress(): Promise<MigrationProgress> {
  const retval = await simulate("get_migration_progress", []);
  if (!retval) throw new Error("No return value from get_migration_progress");

  const raw = scValToNative(retval) as Record<string, unknown>;
  return {
    schemaVersion: Number(raw.schema_version),
    targetVersion: Number(raw.target_version),
    migratedAccounts: Number(raw.migrated_accounts),
    complete: Boolean(raw.complete),
  };
}

/** Loads and validates the operator's account list. Throws on any problem. */
function loadAccounts(file: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${file} must contain a JSON array of account address strings`);
  }
  const accounts = parsed as string[];

  // Resume is by position, so a duplicate would make the position drift.
  if (new Set(accounts).size !== accounts.length) {
    throw new Error(`${file} contains duplicate accounts; de-duplicate it before running`);
  }
  // Fails fast on malformed addresses rather than partway through a batch.
  accounts.forEach((addr) => Address.fromString(addr));
  return accounts;
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (!CONTRACT_ID) {
    logger.error(
      "ERROR: CONTRACT_ID is not set. Export CONTRACT_ID (or VITE_CONTRACT_ID) before running.",
    );
    process.exit(1);
  }

  const accountsFile = argValue(args, "--accounts");
  if (!accountsFile) {
    logger.error("ERROR: pass --accounts <file.json> with the legacy account list.");
    process.exit(1);
  }
  const accounts = loadAccounts(accountsFile);

  const progress = await getMigrationProgress();
  logger.info(
    `Schema version ${progress.schemaVersion} (target ${progress.targetVersion}); ` +
      `${progress.migratedAccounts} of ${accounts.length} account(s) already processed.`,
  );

  if (progress.complete) {
    logger.info("Schema migration is already complete. Nothing to do.");
    return;
  }
  if (progress.migratedAccounts > accounts.length) {
    logger.error(
      `ERROR: the contract has processed ${progress.migratedAccounts} accounts but the list has ` +
        `${accounts.length}. The list does not match this upgrade; stop and check it.`,
    );
    process.exit(1);
  }

  // Resume from the on-chain position. Accounts before it are already marked and
  // would be skipped by the contract anyway.
  const remaining = accounts.slice(progress.migratedAccounts);
  logger.info(
    `${remaining.length} account(s) left, in ${Math.ceil(remaining.length / BATCH_SIZE)} batch(es) of up to ${BATCH_SIZE}.`,
  );

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    // Encode as a real ScVec: `contract.call` spreads its arguments into separately
    // encoded ScVals, so a bare JS array is not a valid argument.
    await simulate("migrate", [vecAddressToScVal(batch)]);
    logger.info(`Simulated migrate for ${batch.length} account(s) starting at position ${progress.migratedAccounts + i}.`);
  }

  if (progress.migratedAccounts >= accounts.length) {
    await simulate("finalize_migration", [nativeToScVal(accounts.length, { type: "u64" })]);
    logger.info(
      `Simulated finalize_migration(${accounts.length}): the contract would accept the upgrade as complete.`,
    );
  } else {
    logger.info(
      "Not finalizing yet. Submit the batches with your admin tooling, then re-run this script to finalize.",
    );
  }
}

main().catch((err) => {
  logger.error("Migration failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
