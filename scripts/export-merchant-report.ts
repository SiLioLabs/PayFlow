/**
 * export-merchant-report.ts — Export merchant revenue and subscriber report.
 *
 * Usage:
 *   npx tsx scripts/export-merchant-report.ts [--merchant GXXXX...] [--format csv|json|ndjson] [--fields field1,field2] [--output report.json]
 *
 * Environment Variables:
 *   VITE_RPC_URL             — Soroban RPC endpoint
 *   VITE_NETWORK_PASSPHRASE  — Network passphrase
 *   VITE_CONTRACT_ID         — Deployed FlowPay contract ID
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
import { Server } from "@stellar/stellar-sdk/rpc";
import { logger } from "./logger";

const RPC_URL = process.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "";

const VALID_FIELDS = [
  "generated_at",
  "merchant",
  "total_revenue",
  "subscriber_count",
  "daily_revenue_last_30_days",
] as const;

type ValidField = (typeof VALID_FIELDS)[number];
type OutputFormat = "csv" | "json" | "ndjson";

interface RawMerchantReport {
  generated_at: string;
  merchant: string;
  total_revenue: string; // in XLM
  subscriber_count: number;
  daily_revenue_last_30_days: string[]; // in XLM
}

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function getMerchantRevenue(merchant: string): Promise<bigint> {
  const { MultiEndpointServer } = await import("./rpc-client.js");
  const server = new MultiEndpointServer(RPC_URL);
/** Convert stroops (bigint) to XLM string */
function stroopsToXlm(stroops: bigint): string {
  const isNegative = stroops < 0n;
  const absStroops = isNegative ? -stroops : stroops;
  const integerPart = absStroops / 10_000_000n;
  const fractionalPart = absStroops % 10_000_000n;
  const fracStr = fractionalPart.toString().padStart(7, "0").replace(/0+$/, "");
  const result = fracStr.length > 0 ? `${integerPart}.${fracStr}` : integerPart.toString();
  return isNegative ? `-${result}` : result;
}

async function getDummyAccount(server: Server, fallbackAddr: string) {
  try {
    return await server.getAccount(fallbackAddr);
  } catch {
    const { Account } = await import("@stellar/stellar-sdk");
    return new Account(fallbackAddr, "0");
  }
}

async function getMerchantRevenue(server: Server, merchant: string): Promise<bigint> {
  if (!CONTRACT_ID) return 0n;
  const contract = new Contract(CONTRACT_ID);
  const account = await getDummyAccount(server, merchant);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_merchant_revenue", addressVal(merchant)))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result && result.error) throw new Error(result.error);

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval || retval.switch().name === "scvVoid") return 0n;
  return BigInt(retval.i128().toString());
}

async function getMerchantSubscriberCount(merchant: string): Promise<number> {
  const { MultiEndpointServer } = await import("./rpc-client.js");
  const server = new MultiEndpointServer(RPC_URL);

async function getMerchantSubscriberCount(server: Server, merchant: string): Promise<number> {
  if (!CONTRACT_ID) return 0;
  const response = await server.getEvents({
    filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
    limit: 1000,
  });

  const latestSubscribeByUser = new Map<
    string,
    { merchant: string; timestamp: number }
  >();
  const latestCancelByUser = new Map<string, number>();

  for (const event of response.events) {
    const topic = event.topic;
    if (!topic || topic.length < 2) continue;
    const eventType = topic[0]?.toString();
    const userAddress = topic[1]?.toString();
    if (!userAddress) continue;

    const eventTime = Date.parse(event.ledgerClosedAt) || 0;
    const eventTime = Number(
      (event as { ledgerCloseTime?: number }).ledgerCloseTime ??
        (event.ledgerClosedAt ? Date.parse(event.ledgerClosedAt) / 1000 : 0)
    ) || 0;

    if (eventType === "subscribed") {
      const merchantVal = (event as any).value?._value?.merchant;
      const subscribedMerchant = merchantVal?.toString();
      if (!subscribedMerchant) continue;
      const existing = latestSubscribeByUser.get(userAddress);
      if (!existing || eventTime > existing.timestamp) {
        latestSubscribeByUser.set(userAddress, {
          merchant: subscribedMerchant,
          timestamp: eventTime,
        });
      }
    } else if (eventType === "cancelled") {
      const existing = latestCancelByUser.get(userAddress) || 0;
      if (eventTime > existing) {
        latestCancelByUser.set(userAddress, eventTime);
      }
    }
  }

  let count = 0;
  for (const [userAddress, subscribe] of latestSubscribeByUser.entries()) {
    if (subscribe.merchant !== merchant) continue;
    const cancelAt = latestCancelByUser.get(userAddress) ?? 0;
    if (cancelAt < subscribe.timestamp) {
      count++;
    }
  }

  return count;
}

async function getMerchantRevenueHistory(
  merchant: string,
  days: number,
): Promise<bigint[]> {
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const server = new Server(RPC_URL);
async function getMerchantRevenueHistory(merchant: string, days: number): Promise<bigint[]> {
  const { MultiEndpointServer } = await import("./rpc-client.js");
  const server = new MultiEndpointServer(RPC_URL);
async function getMerchantRevenueHistory(server: Server, merchant: string, days: number): Promise<bigint[]> {
  if (!CONTRACT_ID) return [];
  const contract = new Contract(CONTRACT_ID);
  const account = await getDummyAccount(server, merchant);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "get_merchant_revenue_history",
        addressVal(merchant),
        nativeToScVal(days, { type: "u32" }),
      ),
    )
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result && result.error) return [];

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return [];

  const vec = retval.vec();
  if (!vec) return [];
  return vec.map((v: xdr.ScVal) => BigInt(v.i128().toString()));
}

async function fetchReportForMerchant(server: Server, merchant: string): Promise<RawMerchantReport> {
  const [revenueStroops, subscriberCount, dailyRevenueStroops] = await Promise.all([
    getMerchantRevenue(server, merchant),
    getMerchantSubscriberCount(server, merchant),
    getMerchantRevenueHistory(server, merchant, 30),
  ]);

  return {
    generated_at: new Date().toISOString(),
    merchant,
    total_revenue: stroopsToXlm(revenueStroops),
    subscriber_count: subscriberCount,
    daily_revenue_last_30_days: dailyRevenueStroops.map(stroopsToXlm),
  };
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function filterFields(report: RawMerchantReport, fields: ValidField[]): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const field of fields) {
    filtered[field] = report[field];
  }
  return filtered;
}

function formatReports(reports: RawMerchantReport[], format: OutputFormat, fields: ValidField[]): string {
  const filteredList = reports.map((r) => filterFields(r, fields));

  if (format === "json") {
    return JSON.stringify(filteredList, null, 2);
  }

  if (format === "ndjson") {
    return filteredList.map((obj) => JSON.stringify(obj)).join("\n") + "\n";
  }

  if (format === "csv") {
    const header = fields.join(",");
    const rows = filteredList.map((obj) => fields.map((f) => escapeCsvCell(obj[f])).join(","));
    return [header, ...rows].join("\n") + "\n";
  }

  throw new Error(`Unsupported format: ${format}`);
}

async function main() {
  const args = process.argv.slice(2);
  let merchant = "";
  let output = "";
  let format: OutputFormat = "json";
  let fieldsStr = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--merchant" && args[i + 1]) merchant = args[++i];
    else if (args[i] === "--output" && args[i + 1]) output = args[++i];
    else if (args[i] === "--format" && args[i + 1]) format = args[++i].toLowerCase() as OutputFormat;
    else if (args[i] === "--fields" && args[i + 1]) fieldsStr = args[++i];
  }

  if (!merchant || !output) {
    console.error(
      "Usage: npx tsx scripts/export-merchant-report.ts --merchant GXXXX... --output report.json",
    );
  if (!["csv", "json", "ndjson"].includes(format)) {
    logger.error(`ERROR: Invalid format '${format}'. Supported formats: csv, json, ndjson`);
    process.exit(1);
  }

  let selectedFields: ValidField[] = [...VALID_FIELDS];
  if (fieldsStr) {
    const parsedFields = fieldsStr.split(",").map((f) => f.trim());
    const invalidFields = parsedFields.filter((f) => !VALID_FIELDS.includes(f as ValidField));
    if (invalidFields.length > 0) {
      logger.error(`ERROR: Invalid field(s): ${invalidFields.join(", ")}.`);
      logger.error(`Valid fields are: ${VALID_FIELDS.join(", ")}`);
      process.exit(1);
    }
    selectedFields = parsedFields as ValidField[];
  }

  const server = new Server(RPC_URL);

  const merchantsToReport: string[] = [];
  if (merchant) {
    merchantsToReport.push(merchant);
  } else {
    // If no specific merchant requested, discover from top merchants or default dummy merchant
    merchantsToReport.push("GXXXX_DEFAULT_MERCHANT");
  }

  const reports: RawMerchantReport[] = [];
  for (const m of merchantsToReport) {
    try {
      const report = await fetchReportForMerchant(server, m);
      reports.push(report);
    } catch (err) {
      // Fallback empty report for unmatched/offline merchant in dev
      reports.push({
        generated_at: new Date().toISOString(),
        merchant: m,
        total_revenue: "0",
        subscriber_count: 0,
        daily_revenue_last_30_days: [],
      });
    }
  }

  const formattedOutput = formatReports(reports, format, selectedFields);

  if (output) {
    const fs = await import("fs/promises");
    await fs.writeFile(output, formattedOutput, "utf-8");
    logger.info(`Report written to ${output}`);
  } else {
    process.stdout.write(formattedOutput);
  }
}

main().catch((err) => {
  logger.error("Export report failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

