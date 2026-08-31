#!/usr/bin/env ts-node
/**
 * top-merchants.ts
 *
 * Queries the FlowPay contract for its top merchants by subscriber count
 * using the on-chain `get_top_merchants_by_subs` getter.
 *
 * The contract enforces a hard cap of MAX_BATCH_SIZE (20) per call.
 * This script respects that limit and also supports pagination via
 * --page / --page-size flags.
 *
 * Usage:
 *   npx ts-node scripts/top-merchants.ts [options]
 *
 * Options:
 *   --limit <n>       Number of merchants to fetch (1–20, default: 10)
 *   --page <n>        Page number for pagination (1-based, default: 1)
 *   --page-size <n>   Merchants per page (1–20, default: 10)
 *   --rpc-url <url>   Soroban RPC URL (overrides VITE_RPC_URL / RPC_URL)
 *   --contract <id>   Contract ID (overrides VITE_CONTRACT_ID / CONTRACT_ID)
 *   --network <pass>  Network passphrase (overrides VITE_NETWORK_PASSPHRASE)
 *   --json            Emit JSON output instead of a table
 *   --dry-run         Validate config and print call params without hitting RPC
 *
 * Environment variables (can also be set in .env):
 *   RPC_URL / VITE_RPC_URL
 *   CONTRACT_ID / VITE_CONTRACT_ID
 *   NETWORK_PASSPHRASE / VITE_NETWORK_PASSPHRASE
 *
 * Closes: https://github.com/SiLioLabs/PayFlow/issues/896
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
import { Server } from "@stellar/stellar-sdk/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Hard limit enforced by the contract's `get_top_merchants_by_subs`.
 * Exceeding this value causes the contract to panic with "BatchTooLarge".
 */
export const MAX_BATCH_SIZE = 20;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MerchantRank {
  /** Merchant Stellar address */
  address: string;
  /** Number of active subscribers */
  subscribers: number;
  /** Rank position (1-based) */
  rank: number;
}

export interface TopMerchantsResult {
  merchants: MerchantRank[];
  page: number;
  pageSize: number;
  totalFetched: number;
  contractId: string;
  rpcUrl: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

function resolveConfig(args: ParsedArgs): {
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
} {
  const rpcUrl =
    args.rpcUrl ??
    process.env.RPC_URL ??
    process.env.VITE_RPC_URL ??
    "https://soroban-testnet.stellar.org";

  const contractId =
    args.contractId ??
    process.env.CONTRACT_ID ??
    process.env.VITE_CONTRACT_ID ??
    "";

  const networkPassphrase =
    args.network ??
    process.env.NETWORK_PASSPHRASE ??
    process.env.VITE_NETWORK_PASSPHRASE ??
    Networks.TESTNET;

  return { rpcUrl, contractId, networkPassphrase };
}

// ── Argument parsing ──────────────────────────────────────────────────────────

interface ParsedArgs {
  limit: number;
  page: number;
  pageSize: number;
  rpcUrl?: string;
  contractId?: string;
  network?: string;
  jsonOutput: boolean;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    limit: 10,
    page: 1,
    pageSize: 10,
    jsonOutput: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--limit":
        args.limit = parseInt(argv[++i], 10);
        break;
      case "--page":
        args.page = parseInt(argv[++i], 10);
        break;
      case "--page-size":
        args.pageSize = parseInt(argv[++i], 10);
        break;
      case "--rpc-url":
        args.rpcUrl = argv[++i];
        break;
      case "--contract":
        args.contractId = argv[++i];
        break;
      case "--network":
        args.network = argv[++i];
        break;
      case "--json":
        args.jsonOutput = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
    }
  }

  return args;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateParams(limit: number, pageSize: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit must be a positive integer, got: ${limit}`);
  }
  if (limit > MAX_BATCH_SIZE) {
    throw new Error(
      `--limit ${limit} exceeds contract maximum of ${MAX_BATCH_SIZE} (BatchTooLarge). Use --limit ${MAX_BATCH_SIZE} or smaller.`
    );
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`--page-size must be a positive integer, got: ${pageSize}`);
  }
  if (pageSize > MAX_BATCH_SIZE) {
    throw new Error(
      `--page-size ${pageSize} exceeds contract maximum of ${MAX_BATCH_SIZE} (BatchTooLarge). Use --page-size ${MAX_BATCH_SIZE} or smaller.`
    );
  }
}

// ── On-chain query ────────────────────────────────────────────────────────────

/**
 * Calls `get_top_merchants_by_subs(limit)` on the deployed FlowPay contract.
 *
 * The contract returns a `Vec<(Address, u64)>` sorted descending by subscriber
 * count. Tie-breaking order is defined by the contract (stable storage
 * iteration order) and is preserved here without re-sorting.
 *
 * @param limit   Number of results to request (1–MAX_BATCH_SIZE).
 * @param contractId  Deployed contract address.
 * @param server  Soroban RPC server instance.
 * @param networkPassphrase  Stellar network passphrase.
 * @param callerKey  Any funded account to use as transaction source.
 */
export async function fetchTopMerchants(
  limit: number,
  contractId: string,
  server: Server,
  networkPassphrase: string,
  callerKey: string
): Promise<MerchantRank[]> {
  validateParams(limit, limit); // same cap applies

  const contract = new Contract(contractId);
  const account = await server.getAccount(callerKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "get_top_merchants_by_subs",
        nativeToScVal(limit, { type: "u32" })
      )
    )
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult) {
    throw new Error(`Contract simulation failed: ${simResult.error}`);
  }

  return decodeTopMerchantsResult(simResult);
}

/**
 * Decodes the `Vec<(Address, u64)>` return value from a simulation result.
 * Preserves the contract's ordering exactly (tie-breaking is on-chain stable).
 */
export function decodeTopMerchantsResult(simResult: {
  result?: { retval?: xdr.ScVal };
}): MerchantRank[] {
  const retval = simResult.result?.retval;
  if (!retval || retval.switch().name === "scvVoid") {
    return [];
  }

  const vecItems =
    typeof retval.vec === "function" ? retval.vec() : (retval as any)._value?.vec ?? [];

  if (!Array.isArray(vecItems)) {
    return [];
  }

  return vecItems.map((item: xdr.ScVal, index: number) => {
    // Each item is a tuple/struct: (Address, u64)
    // Access as map entries or vec entries depending on SDK version
    let address = "";
    let subscribers = 0;

    const asVec =
      typeof item.vec === "function"
        ? item.vec()
        : (item as any)._value?.vec ?? null;

    if (Array.isArray(asVec) && asVec.length >= 2) {
      // Tuple representation: [ScVal(address), ScVal(u64)]
      address = Address.fromScVal(asVec[0]).toString();
      subscribers = Number(asVec[1].u64());
    } else {
      // Map representation: {address: ScVal, count: ScVal}
      const asMap =
        typeof item.map === "function"
          ? item.map()
          : (item as any)._value?.map ?? [];

      for (const entry of asMap ?? []) {
        const key = entry.key().sym().toString();
        if (key === "address") {
          address = Address.fromScVal(entry.val()).toString();
        } else if (key === "count" || key === "subs" || key === "subscribers") {
          subscribers = Number(entry.val().u64());
        }
      }
    }

    return { address, subscribers, rank: index + 1 };
  });
}

// ── Pagination helper ─────────────────────────────────────────────────────────

/**
 * Applies page/pageSize slicing to an already-fetched sorted list.
 * Pagination happens client-side over the on-chain result set.
 *
 * @param merchants  Full sorted list from the contract.
 * @param page       1-based page number.
 * @param pageSize   Number of results per page (≤ MAX_BATCH_SIZE).
 */
export function paginateMerchants(
  merchants: MerchantRank[],
  page: number,
  pageSize: number
): MerchantRank[] {
  validateParams(pageSize, pageSize);
  if (page < 1) throw new Error(`--page must be >= 1, got: ${page}`);

  const start = (page - 1) * pageSize;
  return merchants.slice(start, start + pageSize).map((m, i) => ({
    ...m,
    rank: start + i + 1, // re-rank within full result set
  }));
}

// ── Output formatting ─────────────────────────────────────────────────────────

function printTable(merchants: MerchantRank[], contractId: string): void {
  console.log(`\nTop Merchants — Contract: ${contractId}`);
  console.log("─".repeat(74));
  console.log(
    `${"Rank".padEnd(6)}${"Subscribers".padEnd(14)}${"Merchant Address"}`
  );
  console.log("─".repeat(74));

  if (merchants.length === 0) {
    console.log("  (no results)");
  } else {
    for (const m of merchants) {
      console.log(
        `${String(m.rank).padEnd(6)}${String(m.subscribers).padEnd(14)}${m.address}`
      );
    }
  }

  console.log("─".repeat(74));
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { rpcUrl, contractId, networkPassphrase } = resolveConfig(args);

  // Validate before any network call
  try {
    validateParams(args.limit, args.pageSize);
  } catch (err: unknown) {
    console.error(`[top-merchants] Config error: ${(err as Error).message}`);
    process.exit(1);
  }

  if (!contractId) {
    console.error(
      "[top-merchants] CONTRACT_ID is not set. Use --contract or set the CONTRACT_ID / VITE_CONTRACT_ID env var."
    );
    process.exit(1);
  }

  if (args.dryRun) {
    console.log("[top-merchants] Dry-run — would call:");
    console.log(
      JSON.stringify(
        { rpcUrl, contractId, limit: args.limit, page: args.page, pageSize: args.pageSize },
        null,
        2
      )
    );
    return;
  }

  const server = new Server(rpcUrl);

  // We need any funded account as TX source for the simulation.
  // Use a well-known testnet faucet account as a zero-auth read source.
  const READ_ONLY_ACCOUNT =
    process.env.SOROBAN_SOURCE_ACCOUNT ??
    "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  let allMerchants: MerchantRank[];
  try {
    allMerchants = await fetchTopMerchants(
      args.limit,
      contractId,
      server,
      networkPassphrase,
      READ_ONLY_ACCOUNT
    );
  } catch (err: unknown) {
    console.error(`[top-merchants] RPC error: ${(err as Error).message}`);
    process.exit(1);
  }

  const paginated = paginateMerchants(allMerchants, args.page, args.pageSize);

  const result: TopMerchantsResult = {
    merchants: paginated,
    page: args.page,
    pageSize: args.pageSize,
    totalFetched: allMerchants.length,
    contractId,
    rpcUrl,
  };

  if (args.jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTable(paginated, contractId);
    if (allMerchants.length === args.limit) {
      console.log(
        `\nNote: Showing page ${args.page} (${paginated.length} of ${allMerchants.length} fetched). Use --page and --page-size to paginate.`
      );
    }
  }
}

// Only run when executed directly (not when imported in tests)
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
/**
 * top-merchants.ts
 *
 * Queries the indexer DB for all charged events, sums net revenue per merchant,
 * and outputs a sorted leaderboard (top 20 by default).
 *
 * Usage:
 *   node --experimental-sqlite scripts/top-merchants.ts \
 *     --db <path-to-indexer.db> [--limit N] [--out report.json]
 *
 * Expected table: events(event_name TEXT, data TEXT, timestamp INTEGER)
 * Charged event data JSON: { merchant: "G...", amount: "123", fee: "1", ... }
 */

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { logger } from "./logger";

interface EventRow {
  data: string;
}

interface MerchantEntry {
  rank: number;
  address: string;
  total_revenue: string;
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function main() {
  const dbPath = getArg("--db");
  if (!dbPath) {
    console.error("--db <path> required");
    process.exit(1);
  }

  const limitArg = getArg("--limit");
  const limit = limitArg ? parseInt(limitArg, 10) : 20;
  if (isNaN(limit) || limit < 1) {
    console.error("--limit must be a positive integer");
    process.exit(1);
  }
  if (!dbPath) {
    logger.error("--db <path> required");
    process.exit(1);
  }

  const limitArg = getArg("--limit");
  const limit = limitArg ? parseInt(limitArg, 10) : 20;
  if (isNaN(limit) || limit < 1) {
    logger.error("--limit must be a positive integer");
    process.exit(1);
  }

  const db = new DatabaseSync(dbPath, { open: true });
  const rows = db
    .prepare("SELECT data FROM events WHERE event_name = 'charged'")
    .all() as unknown as EventRow[];
  db.close();

  const revenue = new Map<string, bigint>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.data) as Record<string, unknown>;
      const merchant = String(parsed.merchant ?? "");
      if (!merchant) continue;
      const amount = BigInt(String(parsed.amount ?? "0"));
      const fee = BigInt(String(parsed.fee ?? "0"));
      revenue.set(merchant, (revenue.get(merchant) ?? 0n) + (amount - fee));
    } catch {
      /* skip malformed rows */
    }
  }

  const leaderboard: MerchantEntry[] = [...revenue.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, limit)
    .map(([address, total], i) => ({
      rank: i + 1,
      address,
      total_revenue: total.toString(),
    }));

  const out = getArg("--out");
  const json = JSON.stringify(leaderboard, null, 2);
  if (out) {
    writeFileSync(out, json);
    console.log(`Wrote leaderboard to ${out}`);
  } else process.stdout.write(json + "\n");
  if (out) {
    writeFileSync(out, json);
    logger.info(`Wrote leaderboard to ${out}`);
  } else process.stdout.write(json + "\n");
}

main();
