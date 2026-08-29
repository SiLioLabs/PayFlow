/**
 * renewal-forecast.ts
 *
 * Reads all active subscribers from the FlowPay contract and projects
 * upcoming charge volume over the next FORECAST_DAYS days.
 *
 * Usage:
 *   tsx scripts/renewal-forecast.ts [--format json|csv] [--days N] [--out path/to/output]
 *
 * Flags:
 *   --format <json|csv>   Output format (default: json)
 *   --days <N>            Forecast window in days (default: FORECAST_DAYS env or 30)
 *   --out <path>          Write output to file instead of stdout
 *   --help, -h            Show help
 *
 * Environment Variables:
 *   CONTRACT_ID           Required. Deployed FlowPay contract ID.
 *   RPC_URL               Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *   NETWORK_PASSPHRASE    Network passphrase (default: Test SDF Network ; September 2015)
 *   FORECAST_DAYS         Number of days to forecast (default: 30)
 */

import {
  Contract,
  Networks,
  TransactionBuilder,
  Account,
  BASE_FEE,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { writeFileSync } from "node:fs";

// ── Configuration ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;

// Dummy source account for simulation-only (read) calls. No real funds needed.
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const FORECAST_DAYS = parseInt(process.env.FORECAST_DAYS ?? "30", 10);
const PAGE_SIZE = 50; // Contract cap for get_subscriber_page
const STROOPS_PER_XLM = 10_000_000n;

const server = new Server(RPC_URL);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an scvU64 ScVal to bigint */
function decodeU64(val: xdr.ScVal): bigint {
  return BigInt(val.u64().toString());
}

/** Convert an scvI128 ScVal to bigint */
function decodeI128(val: xdr.ScVal): bigint {
  const i128 = val.i128();
  return (BigInt(i128.hi().toString()) << 64n) + BigInt(i128.lo().toString());
}

/** Convert an scvBool ScVal to boolean */
function decodeBool(val: xdr.ScVal): boolean {
  return val.b();
}

/** Convert an scvAddress ScVal to string */
function decodeAddress(val: xdr.ScVal): string {
  return Address.fromScVal(val).toString();
}

/** Convert stroops to XLM with 7 decimal places */
function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  return `${whole}.${frac.toString().padStart(7, "0")}`;
}

// ── Simulation ───────────────────────────────────────────────────────────────

/**
 * Simulate a read-only contract call using a dummy source account.
 * Returns the decoded return value or null on error.
 */
async function simulate(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) throw new Error(`${method}: ${result.error}`);
    return result.result?.retval ?? null;
  } catch (err) {
    console.error(`[warn] simulate ${method} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Wrap an address string into an ScVal Address */
function addressVal(addr: string): xdr.ScVal {
  return Address.fromString(addr).toScVal();
}

// ── Contract Reads ───────────────────────────────────────────────────────────

interface SubInfo {
  address: string;
  amount: bigint;
  interval: bigint; // seconds
  lastCharged: bigint; // Unix timestamp
  active: boolean;
  paused: boolean;
  merchant: string;
  token: string;
}

/**
 * Fetch a single subscription's data via get_subscription.
 * Returns null if no subscription exists.
 */
async function getSubscription(user: string): Promise<SubInfo | null> {
  const retval = await simulate("get_subscription", addressVal(user));
  if (!retval || retval.switch().name === "scvVoid") return null;

  const entries: Map<string, xdr.ScVal> = new Map();
  for (const e of retval.map() ?? []) {
    entries.set(e.key().sym().toString(), e.val());
  }

  const get = (k: string) => entries.get(k);

  return {
    address: user,
    amount: decodeI128(get("amount")!),
    interval: decodeU64(get("interval")!),
    lastCharged: decodeU64(get("last_charged")!),
    active: decodeBool(get("active")!),
    paused: decodeBool(get("paused")!),
    merchant: decodeAddress(get("merchant")!),
    token: decodeAddress(get("token")!),
  };
}

/**
 * Fetch the total subscriber index size (append-only count).
 */
async function getSubscriberCount(): Promise<bigint> {
  const retval = await simulate("get_subscriber_count");
  if (!retval) return 0n;
  return decodeU64(retval);
}

/**
 * Fetch a page of subscriber addresses from the index.
 * Pruned (cancelled) slots are skipped by the contract.
 */
async function getSubscriberPage(offset: bigint, limit: number): Promise<string[]> {
  const retval = await simulate(
    "get_subscriber_page",
    xdr.ScVal.scvU64(new xdr.Uint64(offset)),
    xdr.ScVal.scvU32(limit)
  );
  if (!retval || retval.switch().name === "scvVoid") return [];

  const vec = retval.vec();
  if (!vec) return [];
  return vec.map((v: xdr.ScVal) => decodeAddress(v));
}

// ── Forecast Logic ──────────────────────────────────────────────────────────

interface DailyBucket {
  date: string; // YYYY-MM-DD
  count: number;
  totalVolumeStroops: bigint;
}

interface ForecastResult {
  generatedAt: string;
  contractId: string;
  network: string;
  forecastDays: number;
  forecastStart: string;
  forecastEnd: string;
  totalActiveSubscribers: number;
  totalProjectedCharges: number;
  totalVolumeXlm: string;
  daily: Array<{
    date: string;
    count: number;
    totalVolumeXlm: string;
  }>;
}

/**
 * Compute the next charge timestamp for a subscription.
 *
 * When a trial is active (last_charged is in the future), the trial end
 * is `last_charged` — the first real charge happens at that timestamp.
 * Otherwise the next charge is `last_charged + interval`.
 */
function computeNextChargeAt(sub: SubInfo, now: bigint): bigint | null {
  if (!sub.active || sub.paused) return null;

  // Trial active: last_charged is the trial end time, first charge at trial end
  if (sub.lastCharged > now) {
    return sub.lastCharged;
  }

  // Normal case: next charge = last_charged + interval
  return sub.lastCharged + sub.interval;
}

/** Convert a Unix timestamp (seconds) to YYYY-MM-DD in UTC */
function unixToDateStr(ts: bigint): string {
  const date = new Date(Number(ts) * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Convert a YYYY-MM-DD string to a Unix timestamp at midnight UTC */
function dateStrToUnix(dateStr: string): bigint {
  return BigInt(Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 1000));
}

/**
 * Generate a list of date strings from start to end (inclusive).
 */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const startMs = new Date(start + "T00:00:00Z").getTime();
  const endMs = new Date(end + "T00:00:00Z").getTime();
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    dates.push(unixToDateStr(BigInt(Math.floor(ms / 1000))));
  }
  return dates;
}

// ── Output ────────────────────────────────────────────────────────────────────

/** Build a ForecastResult from raw daily buckets */
function buildResult(buckets: Map<string, DailyBucket>, startDate: string, endDate: string, activeCount: number): ForecastResult {
  const allDates = dateRange(startDate, endDate);
  const daily = allDates.map((date) => {
    const bucket = buckets.get(date);
    return {
      date,
      count: bucket?.count ?? 0,
      totalVolumeXlm: bucket ? stroopsToXlm(bucket.totalVolumeStroops) : "0.0000000",
    };
  });

  const totalCharges = daily.reduce((sum, d) => sum + d.count, 0);
  const totalVolume = daily.reduce(
    (sum, d) => sum + (buckets.get(d.date)?.totalVolumeStroops ?? 0n),
    0n
  );

  return {
    generatedAt: new Date().toISOString(),
    contractId: CONTRACT_ID,
    network: NETWORK_PASSPHRASE,
    forecastDays: FORECAST_DAYS,
    forecastStart: startDate,
    forecastEnd: endDate,
    totalActiveSubscribers: activeCount,
    totalProjectedCharges: totalCharges,
    totalVolumeXlm: stroopsToXlm(totalVolume),
    daily,
  };
}

function formatJson(result: ForecastResult): string {
  return JSON.stringify(result, null, 2);
}

function formatCsv(result: ForecastResult): string {
  const lines = ["date,count,total_volume_xlm"];
  for (const day of result.daily) {
    lines.push(`${day.date},${day.count},${day.totalVolumeXlm}`);
  }
  return lines.join("\n");
}

function printSummary(result: ForecastResult): void {
  console.error(
    `\nSummary: ${result.totalActiveSubscribers} active subscribers, ` +
      `${result.totalProjectedCharges} projected charges, ` +
      `${result.totalVolumeXlm} XLM over ${result.forecastDays} days ` +
      `(${result.forecastStart} → ${result.forecastEnd})`
  );
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
Usage: tsx scripts/renewal-forecast.ts [options]

Options:
  --format <json|csv>   Output format (default: json)
  --days <N>            Forecast window in days (default: ${FORECAST_DAYS})
  --out <path>          Write output to file instead of stdout
  --help, -h            Show this help message

Environment:
  CONTRACT_ID           Required. Deployed FlowPay contract ID.
  RPC_URL               Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE    Network passphrase (default: Test SDF Network ; September 2015)
  FORECAST_DAYS         Number of days to forecast (default: 30)

Examples:
  tsx scripts/renewal-forecast.ts
  tsx scripts/renewal-forecast.ts --format csv --days 7
  tsx scripts/renewal-forecast.ts --format json --out forecast.json
  CONTRACT_ID=CD123... tsx scripts/renewal-forecast.ts --days 90
`);
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Parse CLI args
  const argv = process.argv.slice(2);
  let format: "json" | "csv" = "json";
  let days = FORECAST_DAYS;
  let outPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp();
    } else if (arg === "--format") {
      const val = argv[++i];
      if (val !== "json" && val !== "csv") {
        console.error(`Invalid format: ${val}. Must be json or csv.`);
        process.exit(1);
      }
      format = val;
    } else if (arg === "--days") {
      const val = parseInt(argv[++i], 10);
      if (isNaN(val) || val <= 0 || val > 365) {
        console.error(`Invalid days: ${argv[i]}. Must be 1-365.`);
        process.exit(1);
      }
      days = val;
    } else if (arg === "--out") {
      outPath = argv[++i];
      if (!outPath) {
        console.error("Missing value for --out");
        process.exit(1);
      }
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  // Validate required env
  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    console.error("Usage: CONTRACT_ID=your_contract_id tsx scripts/renewal-forecast.ts");
    process.exit(1);
  }

  console.error(`Forecasting ${days} days of renewals for contract ${CONTRACT_ID}...`);

  // ── Step 1: Compute forecast window ──────────────────────────────────────

  const now = BigInt(Math.floor(Date.now() / 1000));
  const todayDate = unixToDateStr(now);
  const forecastEndUnix = now + BigInt(days * 86_400);
  const forecastEndDate = unixToDateStr(forecastEndUnix);

  // ── Step 2: Page through subscriber index ─────────────────────────────────

  const totalSubscribers = await getSubscriberCount();
  console.error(`Total subscriber index size: ${totalSubscribers}`);

  const activeSubs: SubInfo[] = [];
  let offset = 0n;

  while (offset < totalSubscribers) {
    const page = await getSubscriberPage(offset, PAGE_SIZE);
    if (page.length === 0) break;

    // Fetch subscription details in parallel for each address in the page
    const results = await Promise.all(
      page.map((addr) => getSubscription(addr))
    );

    for (const sub of results) {
      if (sub && sub.active && !sub.paused) {
        activeSubs.push(sub);
      }
    }

    // Advance by page size, not returned count — contract skips pruned slots
    // in the scan window but the window always covers `limit` index positions.
    offset += BigInt(PAGE_SIZE);
    console.error(
      `  Scanned through ${offset < totalSubscribers ? offset : totalSubscribers}/${totalSubscribers} slots (${activeSubs.length} active so far)...`
    );
  }

  console.error(`Found ${activeSubs.length} active (non-paused) subscribers.`);

  if (activeSubs.length === 0) {
    const emptyResult = buildResult(new Map(), todayDate, forecastEndDate, 0);
    const output = format === "json" ? formatJson(emptyResult) : formatCsv(emptyResult);
    if (outPath) {
      writeFileSync(outPath, output);
      console.error(`Wrote forecast to ${outPath}`);
    } else {
      process.stdout.write(output + "\n");
    }
    return;
  }

  // ── Step 3: Project charges into daily buckets ───────────────────────────

  const buckets = new Map<string, DailyBucket>();

  for (const sub of activeSubs) {
    const nextCharge = computeNextChargeAt(sub, now);
    if (nextCharge === null) continue; // Shouldn't happen for active subs

    // Walk forward through each projected charge within the forecast window.
    // For long intervals (monthly/yearly), this may only produce 0-1 charges.
    let chargeTime = nextCharge;

    // If the computed next charge is already before `now`, it's overdue.
    // In that case the charge is due immediately (today).
    if (chargeTime < now) {
      chargeTime = now;
    }

    while (chargeTime <= forecastEndUnix) {
      const dateStr = unixToDateStr(chargeTime);
      const existing = buckets.get(dateStr);
      if (existing) {
        existing.count += 1;
        existing.totalVolumeStroops += sub.amount;
      } else {
        buckets.set(dateStr, {
          date: dateStr,
          count: 1,
          totalVolumeStroops: sub.amount,
        });
      }
      chargeTime += sub.interval;
    }
  }

  // ── Step 4: Build and output ─────────────────────────────────────────────

  const result = buildResult(buckets, todayDate, forecastEndDate, activeSubs.length);
  const output = format === "json" ? formatJson(result) : formatCsv(result);

  if (outPath) {
    writeFileSync(outPath, output);
    console.error(`Wrote forecast to ${outPath}`);
  } else {
    process.stdout.write(output + "\n");
  }
  printSummary(result);
}

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
