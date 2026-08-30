#!/usr/bin/env tsx
/**
 * subscriber-health-dashboard.ts — Aggregate subscriber health for FlowPay operators.
 *
 * Pages the subscriber index, bulk-fetches subscription ledger entries (with
 * RPC batching limits), and produces a health summary covering low allowances,
 * grace windows, pauses, trials, and expiring TTLs.
 *
 * Output JSON fields are aligned 1:1 with the on-chain SubscriptionHealth
 * struct returned by `get_subscription_health`:
 *
 *   active, charge_due, within_grace, has_sufficient_allowance,
 *   is_paused, trial_active, daily_limit_set
 *
 * Plus an `address` identity field and ops-specific extensions
 * (ttl_remaining, expiring_ttl, requires_restore).
 *
 * Exit codes:
 *   0 — all subscribers healthy (no unhealthy in aggregate)
 *   1 — any subscriber unhealthy
 *   2 — hard failure (RPC error, fixture parse error, script crash)
 *
 * Usage:
 *   CONTRACT_ID=C... npx tsx scripts/subscriber-health-dashboard.ts
 *   CONTRACT_ID=C... npx tsx scripts/subscriber-health-dashboard.ts --format table
 *   CONTRACT_ID=C... npx tsx scripts/subscriber-health-dashboard.ts --detail detail.csv
 *   CONTRACT_ID=C... npx tsx scripts/subscriber-health-dashboard.ts --fixtures data/healthy.json
 *   CONTRACT_ID=C... npx tsx scripts/subscriber-health-dashboard.ts --fixtures data/unhealthy.json
 *
 * Environment:
 *   CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE
 *   PAGE_SIZE              Subscriber page size (default 50, max 50)
 *   LEDGER_ENTRY_BATCH     getLedgerEntries batch size (default 100, max 200)
 *   EXPIRING_TTL_LEDGERS   Threshold for expiring TTL (default 500000)
 *   PROGRESS               Set to 0 to disable progress output
 *
 * Low allowance = allowance < subscription amount × 2
 * Expiring TTL  = remaining liveUntil ledgers < EXPIRING_TTL_LEDGERS
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  Contract,
  Networks,
  TransactionBuilder,
  Account,
  BASE_FEE,
  Address,
  nativeToScVal,
  xdr,
  scValToNative,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

// ── Config ───────────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? process.env.VITE_CONTRACT_ID ?? "";
const RPC_URL =
  process.env.RPC_URL ?? process.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? process.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const PAGE_SIZE = Math.min(
  50,
  Math.max(1, Number.parseInt(process.env.PAGE_SIZE ?? "50", 10) || 50)
);
const LEDGER_ENTRY_BATCH = Math.min(
  200,
  Math.max(1, Number.parseInt(process.env.LEDGER_ENTRY_BATCH ?? "100", 10) || 100)
);
const EXPIRING_TTL_LEDGERS = Number.parseInt(process.env.EXPIRING_TTL_LEDGERS ?? "500000", 10) || 500_000;
const SHOW_PROGRESS = process.env.PROGRESS !== "0";
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// ── Exit Codes ───────────────────────────────────────────────────────────────

const EXIT_HEALTHY = 0;
const EXIT_UNHEALTHY = 1;
const EXIT_HARD_FAILURE = 2;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Per-subscriber health output.
 * Fields are aligned with the on-chain SubscriptionHealth struct.
 * Extra ops-specific fields are appended at the end.
 */
export interface SubscriberHealth {
  // Identity
  address: string;

  // On-chain SubscriptionHealth fields (1:1 alignment)
  active: boolean;
  charge_due: boolean;
  within_grace: boolean;
  has_sufficient_allowance: boolean;
  is_paused: boolean;
  trial_active: boolean;
  daily_limit_set: boolean;

  // Ops extensions (not part of SubscriptionHealth, but useful for operators)
  amount: string;
  allowance: string;
  token: string;
  ttl_remaining: number | null;
  expiring_ttl: boolean;
  requires_restore: boolean;
}

/** Aggregate summary for the full subscriber set. */
export interface HealthSummary {
  total: number;
  total_active: number;
  total_healthy: number;
  total_unhealthy: number;
  paused_count: number;
  charge_due_count: number;
  grace_period_active_count: number;
  no_allowance_count: number;
  trial_active_count: number;
  daily_limit_set_count: number;
  expiring_ttl_count: number;
  requires_restore_count: number;
  total_indexed: number;
  scanned: number;
}

/** Top-level JSON output shape. */
export interface DashboardOutput {
  status: "healthy" | "unhealthy";
  summary: HealthSummary;
  subscribers: SubscriberHealth[];
  fixture_source?: string;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function showHelp(): never {
  console.log(`
Usage: tsx scripts/subscriber-health-dashboard.ts [options]

Options:
  --format json|table   Output format (default: json)
  --detail <path.csv>   Write per-subscriber detail CSV
  --fixtures <path>     Load subscribers from a JSON fixture file instead of RPC
  --help, -h            Show help

Exit Codes:
  0  All subscribers healthy
  1  Any subscriber unhealthy (paused, no allowance, charge due, etc.)
  2  Hard failure (RPC error, fixture parse error, etc.)

Environment:
  CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE, PAGE_SIZE, LEDGER_ENTRY_BATCH,
  EXPIRING_TTL_LEDGERS, PROGRESS
`);
  process.exit(0);
}

// ── RPC helpers ──────────────────────────────────────────────────────────────

const server = new Server(RPC_URL);
const flowPayAddress = CONTRACT_ID ? Address.fromString(CONTRACT_ID) : null;

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function simulate(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal | null> {
  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const result = await server.simulateTransaction(tx);
  if ("error" in result) {
    throw new Error(`${method}: ${String((result as { error?: unknown }).error ?? "failed")}`);
  }
  return (result as { result?: { retval?: xdr.ScVal } }).result?.retval ?? null;
}

async function getU64(method: string): Promise<number> {
  const val = await simulate(method);
  if (!val) return 0;
  return Number(scValToNative(val));
}

async function getSubscriberPage(offset: number, limit: number): Promise<string[]> {
  const retval = await simulate(
    "get_subscriber_page",
    nativeToScVal(offset, { type: "u64" }),
    nativeToScVal(limit, { type: "u32" })
  );
  if (!retval) return [];
  const native = scValToNative(retval);
  if (!Array.isArray(native)) return [];
  return native.map((a) => String(a));
}

/** Build LedgerKey for DataKey::Subscription(Address). */
function subscriptionLedgerKey(user: string): xdr.LedgerKey {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    Address.fromString(user).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(CONTRACT_ID).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

interface LedgerMeta {
  found: boolean;
  archived: boolean;
  liveUntilLedger: number | null;
  raw: xdr.ScVal | null;
}

async function fetchLedgerEntries(
  users: string[],
  latestLedger: number
): Promise<Map<string, LedgerMeta>> {
  const out = new Map<string, LedgerMeta>();
  for (const u of users) {
    out.set(u, { found: false, archived: false, liveUntilLedger: null, raw: null });
  }

  for (let i = 0; i < users.length; i += LEDGER_ENTRY_BATCH) {
    const slice = users.slice(i, i + LEDGER_ENTRY_BATCH);
    const keys = slice.map(subscriptionLedgerKey);
    try {
      const resp = await server.getLedgerEntries(...keys);
      const entries = resp.entries ?? [];
      for (const entry of entries) {
        try {
          const lk = entry.key;
          const cd = lk.contractData();
          const scKey = cd.key();
          let userAddr = "";
          if (scKey.switch().name === "scvVec") {
            const vec = scKey.vec() ?? [];
            if (vec.length >= 2) {
              userAddr = Address.fromScVal(vec[1]).toString();
            }
          }
          if (!userAddr) continue;
          const liveUntil = entry.liveUntilLedgerSeq ?? null;
          out.set(userAddr, {
            found: true,
            archived: false,
            liveUntilLedger: liveUntil,
            raw: entry.val.contractData().val(),
          });
        } catch {
          // ignore decode errors for individual entries
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const user of slice) {
        try {
          const resp = await server.getLedgerEntries(subscriptionLedgerKey(user));
          const entry = resp.entries?.[0];
          if (!entry) continue;
          out.set(user, {
            found: true,
            archived: false,
            liveUntilLedger: entry.liveUntilLedgerSeq ?? null,
            raw: entry.val.contractData().val(),
          });
        } catch (inner) {
          const innerMsg = inner instanceof Error ? inner.message : String(inner);
          if (/archiv|expired|not found/i.test(innerMsg) || /archiv|expired/i.test(msg)) {
            out.set(user, {
              found: false,
              archived: true,
              liveUntilLedger: null,
              raw: null,
            });
          }
        }
      }
    }

    void latestLedger;
  }

  return out;
}

function decodeSubscription(val: xdr.ScVal | null): {
  active: boolean;
  paused: boolean;
  amount: bigint;
  token: string;
  last_charged: number;
  interval: number;
  trial_duration: number;
} | null {
  if (!val) return null;
  try {
    const native = scValToNative(val) as Record<string, unknown>;
    if (!native || typeof native !== "object") return null;
    return {
      active: Boolean(native.active),
      paused: Boolean(native.paused),
      amount: BigInt(String(native.amount ?? 0)),
      token: String(native.token ?? ""),
      last_charged: Number(native.last_charged ?? 0),
      interval: Number(native.interval ?? 0),
      trial_duration: Number(native.trial_duration ?? 0),
    };
  } catch {
    return null;
  }
}

async function getAllowance(owner: string, tokenId: string): Promise<bigint> {
  if (!tokenId || !flowPayAddress) return 0n;
  try {
    const tokenContract = new Contract(tokenId);
    const account = await server.getAccount(owner).catch(() => new Account(SIM_SOURCE, "0"));
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        tokenContract.call(
          "allowance",
          addressVal(owner),
          nativeToScVal(flowPayAddress, { type: "address" })
        )
      )
      .setTimeout(30)
      .build();
    const result = await server.simulateTransaction(tx);
    if ("error" in result) return 0n;
    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") return 0n;
    return BigInt(String(scValToNative(retval)));
  } catch {
    return 0n;
  }
}

/**
 * Call get_subscription_health and extract all 7 SubscriptionHealth fields.
 */
async function getSubscriptionHealth(user: string): Promise<{
  active: boolean;
  charge_due: boolean;
  within_grace: boolean;
  has_sufficient_allowance: boolean;
  is_paused: boolean;
  trial_active: boolean;
  daily_limit_set: boolean;
} | null> {
  try {
    const retval = await simulate("get_subscription_health", addressVal(user));
    if (!retval) return null;
    const native = scValToNative(retval) as Record<string, unknown>;
    return {
      active: Boolean(native.active),
      charge_due: Boolean(native.charge_due),
      within_grace: Boolean(native.within_grace),
      has_sufficient_allowance: Boolean(native.has_sufficient_allowance),
      is_paused: Boolean(native.is_paused),
      trial_active: Boolean(native.trial_active),
      daily_limit_set: Boolean(native.daily_limit_set),
    };
  } catch {
    return null;
  }
}

function progress(msg: string): void {
  if (SHOW_PROGRESS) {
    process.stderr.write(`\r${msg}`);
  }
}

function finishProgress(): void {
  if (SHOW_PROGRESS) process.stderr.write("\n");
}

// ── Core scan ────────────────────────────────────────────────────────────────

export async function collectHealth(): Promise<{
  summary: HealthSummary;
  details: SubscriberHealth[];
}> {
  if (!CONTRACT_ID) throw new Error("CONTRACT_ID is required");

  const latest = await server.getLatestLedger();
  const latestLedger = latest.sequence;
  const indexSize = await getU64("get_subscriber_count");
  let gracePeriod = 0;
  try {
    gracePeriod = await getU64("get_grace_period");
  } catch {
    gracePeriod = 0;
  }
  const now = Math.floor(Date.now() / 1000);

  const details: SubscriberHealth[] = [];
  let scanned = 0;

  for (let offset = 0; offset < indexSize; offset += PAGE_SIZE) {
    const page = await getSubscriberPage(offset, PAGE_SIZE);
    if (page.length === 0) break;

    progress(
      `Scanning subscribers ${Math.min(offset + page.length, indexSize)}/${indexSize}…`
    );

    const ledgerMap = await fetchLedgerEntries(page, latestLedger);

    for (const address of page) {
      scanned += 1;
      const meta = ledgerMap.get(address) ?? {
        found: false,
        archived: false,
        liveUntilLedger: null,
        raw: null,
      };

      let sub = decodeSubscription(meta.raw);
      let requiresRestore = meta.archived;

      if (!sub && !requiresRestore) {
        try {
          const retval = await simulate("get_subscription", addressVal(address));
          if (retval && retval.switch().name !== "scvVoid") {
            sub = decodeSubscription(retval);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/archiv/i.test(msg)) requiresRestore = true;
        }
      }

      if (!sub) {
        details.push({
          address,
          active: false,
          charge_due: false,
          within_grace: false,
          has_sufficient_allowance: false,
          is_paused: false,
          trial_active: false,
          daily_limit_set: false,
          amount: "0",
          allowance: "0",
          token: "",
          ttl_remaining: null,
          expiring_ttl: false,
          requires_restore: requiresRestore,
        });
        continue;
      }

      const health = await getSubscriptionHealth(address);
      const allowance = sub.active ? await getAllowance(address, sub.token) : 0n;

      // Determine fields from on-chain health where possible, fall back to computation
      let withinGrace = health?.within_grace ?? false;
      if (!health && gracePeriod > 0 && sub.active && !sub.paused) {
        const next = sub.last_charged + sub.interval;
        withinGrace = now >= next && now <= next + gracePeriod;
      }

      const trialActive = health?.trial_active ?? (sub.last_charged > now);

      // For has_sufficient_allowance: prefer on-chain health, fall back to local calculation
      let hasSufficientAllowance = health?.has_sufficient_allowance ?? false;
      if (health === null && sub.active) {
        hasSufficientAllowance = allowance >= sub.amount;
      }

      // For charge_due: prefer on-chain health, fall back to interval check
      let chargeDue = health?.charge_due ?? false;
      if (health === null && sub.active && !sub.paused) {
        chargeDue = now >= sub.last_charged + sub.interval;
      }

      const ttlRemaining =
        meta.liveUntilLedger != null ? Math.max(0, meta.liveUntilLedger - latestLedger) : null;
      const expiringTtl = ttlRemaining != null && ttlRemaining < EXPIRING_TTL_LEDGERS;

      details.push({
        address,
        active: sub.active,
        charge_due: chargeDue,
        within_grace: withinGrace,
        has_sufficient_allowance: hasSufficientAllowance,
        is_paused: health?.is_paused ?? sub.paused,
        trial_active: trialActive,
        daily_limit_set: health?.daily_limit_set ?? false,
        amount: sub.amount.toString(),
        allowance: allowance.toString(),
        token: sub.token,
        ttl_remaining: ttlRemaining,
        expiring_ttl: expiringTtl,
        requires_restore: requiresRestore,
      });
    }
  }

  finishProgress();

  const unhealthy = details.filter(
    (d) => d.is_paused || d.charge_due || !d.has_sufficient_allowance || d.requires_restore
  );

  const summary: HealthSummary = {
    total: details.length,
    total_active: details.filter((d) => d.active).length,
    total_healthy: details.length - unhealthy.length,
    total_unhealthy: unhealthy.length,
    paused_count: details.filter((d) => d.is_paused).length,
    charge_due_count: details.filter((d) => d.charge_due).length,
    grace_period_active_count: details.filter((d) => d.within_grace).length,
    no_allowance_count: details.filter((d) => d.active && !d.has_sufficient_allowance).length,
    trial_active_count: details.filter((d) => d.trial_active).length,
    daily_limit_set_count: details.filter((d) => d.daily_limit_set).length,
    expiring_ttl_count: details.filter((d) => d.expiring_ttl).length,
    requires_restore_count: details.filter((d) => d.requires_restore).length,
    total_indexed: indexSize,
    scanned,
  };

  return { summary, details };
}

// ── Fixture loader ───────────────────────────────────────────────────────────

/**
 * Load subscriber health data from a JSON fixture file.
 * Fixture format:
 * {
 *   "subscribers": [
 *     { "address": "G...", "active": true, "charge_due": false, ... },
 *     ...
 *   ]
 * }
 * Or a flat array of subscriber health objects.
 */
function loadFixtures(fixturePath: string): { summary: HealthSummary; details: SubscriberHealth[] } {
  const raw = readFileSync(fixturePath, "utf-8");
  let entries: SubscriberHealth[];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (parsed.subscribers && Array.isArray(parsed.subscribers)) {
      entries = parsed.subscribers;
    } else {
      throw new Error("Fixture must be a JSON array or { \"subscribers\": [...] }");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to parse fixture file: ${msg}`);
    process.exit(EXIT_HARD_FAILURE);
  }

  // Ensure all required fields with defaults
  const details: SubscriberHealth[] = entries.map((e) => ({
    address: e.address ?? "",
    active: e.active ?? false,
    charge_due: e.charge_due ?? false,
    within_grace: e.within_grace ?? false,
    has_sufficient_allowance: e.has_sufficient_allowance ?? true,
    is_paused: e.is_paused ?? false,
    trial_active: e.trial_active ?? false,
    daily_limit_set: e.daily_limit_set ?? false,
    amount: e.amount ?? "0",
    allowance: e.allowance ?? "0",
    token: e.token ?? "",
    ttl_remaining: e.ttl_remaining ?? null,
    expiring_ttl: e.expiring_ttl ?? false,
    requires_restore: e.requires_restore ?? false,
  }));

  const unhealthy = details.filter(
    (d) => d.is_paused || d.charge_due || !d.has_sufficient_allowance || d.requires_restore
  );

  const summary: HealthSummary = {
    total: details.length,
    total_active: details.filter((d) => d.active).length,
    total_healthy: details.length - unhealthy.length,
    total_unhealthy: unhealthy.length,
    paused_count: details.filter((d) => d.is_paused).length,
    charge_due_count: details.filter((d) => d.charge_due).length,
    grace_period_active_count: details.filter((d) => d.within_grace).length,
    no_allowance_count: details.filter((d) => d.active && !d.has_sufficient_allowance).length,
    trial_active_count: details.filter((d) => d.trial_active).length,
    daily_limit_set_count: details.filter((d) => d.daily_limit_set).length,
    expiring_ttl_count: details.filter((d) => d.expiring_ttl).length,
    requires_restore_count: details.filter((d) => d.requires_restore).length,
    total_indexed: details.length,
    scanned: details.length,
  };

  return { summary, details };
}

// ── Formatters ───────────────────────────────────────────────────────────────

function printTable(summary: HealthSummary, details: SubscriberHealth[]): void {
  console.log("");
  console.log("── Aggregate Summary ──────────────────────────────────");
  console.log("");
  const rows: [string, number][] = [
    ["total", summary.total],
    ["total_active", summary.total_active],
    ["total_healthy", summary.total_healthy],
    ["total_unhealthy", summary.total_unhealthy],
    ["paused_count", summary.paused_count],
    ["charge_due_count", summary.charge_due_count],
    ["grace_period_active_count", summary.grace_period_active_count],
    ["no_allowance_count", summary.no_allowance_count],
    ["trial_active_count", summary.trial_active_count],
    ["daily_limit_set_count", summary.daily_limit_set_count],
    ["expiring_ttl_count", summary.expiring_ttl_count],
    ["requires_restore_count", summary.requires_restore_count],
    ["total_indexed", summary.total_indexed],
    ["scanned", summary.scanned],
  ];
  console.log("Metric".padEnd(32) + "Value".padStart(12));
  console.log("-".repeat(44));
  for (const [k, v] of rows) {
    console.log(k.padEnd(32) + String(v).padStart(12));
  }
  console.log("");
  console.log("── Per-Subscriber SubscriptionHealth ──────────────────");
  console.log("");
  const header = [
    "address".padEnd(50),
    "active".padEnd(8),
    "is_paused".padEnd(10),
    "charge_due".padEnd(11),
    "within_grace".padEnd(13),
    "has_allowance".padEnd(14),
    "trial".padEnd(8),
    "daily_lim".padEnd(10),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const d of details) {
    const addr = d.address.length > 50 ? d.address.slice(0, 47) + "..." : d.address;
    console.log(
      [
        addr.padEnd(50),
        (d.active ? "yes" : "no").padEnd(8),
        (d.is_paused ? "yes" : "no").padEnd(10),
        (d.charge_due ? "yes" : "no").padEnd(11),
        (d.within_grace ? "yes" : "no").padEnd(13),
        (d.has_sufficient_allowance ? "yes" : "no").padEnd(14),
        (d.trial_active ? "yes" : "no").padEnd(8),
        (d.daily_limit_set ? "yes" : "no").padEnd(10),
      ].join(" ")
    );
  }
  console.log("");
}

function toCsv(details: SubscriberHealth[]): string {
  const header = [
    "address",
    "active",
    "is_paused",
    "charge_due",
    "within_grace",
    "has_sufficient_allowance",
    "trial_active",
    "daily_limit_set",
    "amount",
    "allowance",
    "token",
    "ttl_remaining",
    "expiring_ttl",
    "requires_restore",
  ];
  const lines = [header.join(",")];
  for (const d of details) {
    lines.push(
      [
        d.address,
        d.active,
        d.is_paused,
        d.charge_due,
        d.within_grace,
        d.has_sufficient_allowance,
        d.trial_active,
        d.daily_limit_set,
        d.amount,
        d.allowance,
        d.token,
        d.ttl_remaining ?? "",
        d.expiring_ttl,
        d.requires_restore,
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
  }

  const fixturesPath = getArg("--fixtures");

  if (!CONTRACT_ID && !fixturesPath) {
    console.error("Error: CONTRACT_ID environment variable is required (or use --fixtures).");
    process.exit(EXIT_HARD_FAILURE);
  }

  const format = (getArg("--format") ?? "json").toLowerCase();
  const detailPath = getArg("--detail");

  const started = Date.now();

  let result: { summary: HealthSummary; details: SubscriberHealth[] };
  let fixtureSource: string | undefined;

  if (fixturesPath) {
    try {
      result = loadFixtures(fixturesPath);
      fixtureSource = fixturesPath;
    } catch (err) {
      console.error(`Failed to load fixtures: ${err instanceof Error ? err.message : err}`);
      process.exit(EXIT_HARD_FAILURE);
    }
  } else {
    try {
      result = await collectHealth();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (JSON_OUTPUT) {
        process.stdout.write(
          JSON.stringify({ status: "error", error: msg }, null, 2) + "\n"
        );
      } else {
        console.error(`Fatal error: ${msg}`);
      }
      process.exit(EXIT_HARD_FAILURE);
    }
  }

  const elapsedMs = Date.now() - started;
  const { summary, details } = result;

  if (SHOW_PROGRESS) {
    console.error(`Completed in ${(elapsedMs / 1000).toFixed(1)}s (scanned ${summary.scanned})`);
  }

  // Determine aggregate status
  const isHealthy = summary.total_unhealthy === 0;

  const output: DashboardOutput = {
    status: isHealthy ? "healthy" : "unhealthy",
    summary,
    subscribers: details,
  };

  if (fixtureSource) {
    output.fixture_source = fixtureSource;
  }

  if (format === "table") {
    printTable(summary, details);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  if (detailPath) {
    writeFileSync(detailPath, toCsv(details), "utf8");
    console.error(`Wrote detail CSV to ${detailPath} (${details.length} rows)`);
  }

  // Exit code: 0 = all healthy, 1 = any unhealthy
  process.exit(isHealthy ? EXIT_HEALTHY : EXIT_UNHEALTHY);
}

// JSON_OUTPUT flag for error path
const JSON_OUTPUT = !(getArg("--format") ?? "json").match(/^table$/i);

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
  process.exit(EXIT_HARD_FAILURE);
});
