#!/usr/bin/env tsx
/**
 * subscriber-health-dashboard.ts — Aggregate subscriber health for FlowPay operators.
 *
 * Pages the subscriber index, bulk-fetches subscription ledger entries (with
 * RPC batching limits), and produces a health summary covering low allowances,
 * grace windows, pauses, trials, and expiring TTLs.
 *
 * Usage:
 *   CONTRACT_ID=C... npx tsx scripts/subscriber-health-dashboard.ts
 *   CONTRACT_ID=C... npx tsx scripts/subscriber-health-dashboard.ts --format table
 *   CONTRACT_ID=C... npx tsx scripts/subscriber-health-dashboard.ts --detail detail.csv
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

import { writeFileSync } from "node:fs";
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

const CONTRACT_ID =
  process.env.CONTRACT_ID ?? process.env.VITE_CONTRACT_ID ?? "";
const RPC_URL =
  process.env.RPC_URL ??
  process.env.VITE_RPC_URL ??
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ??
  process.env.VITE_NETWORK_PASSPHRASE ??
  Networks.TESTNET;
const PAGE_SIZE = Math.min(
  50,
  Math.max(1, Number.parseInt(process.env.PAGE_SIZE ?? "50", 10) || 50),
);
const LEDGER_ENTRY_BATCH = Math.min(
  200,
  Math.max(
    1,
    Number.parseInt(process.env.LEDGER_ENTRY_BATCH ?? "100", 10) || 100,
  ),
);
const EXPIRING_TTL_LEDGERS =
  Number.parseInt(process.env.EXPIRING_TTL_LEDGERS ?? "500000", 10) || 500_000;
const SHOW_PROGRESS = process.env.PROGRESS !== "0";
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HealthSummary {
  total_active: number;
  low_allowance_count: number;
  grace_period_active_count: number;
  paused_count: number;
  trial_active_count: number;
  expiring_ttl_count: number;
  requires_restore_count: number;
  total_indexed: number;
  scanned: number;
}

interface SubscriberDetail {
  address: string;
  active: boolean;
  paused: boolean;
  amount: string;
  allowance: string;
  low_allowance: boolean;
  within_grace: boolean;
  trial_active: boolean;
  ttl_remaining: number | null;
  expiring_ttl: boolean;
  requires_restore: boolean;
  token: string;
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
  --help, -h            Show help

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

async function simulate(
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal | null> {
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
    throw new Error(
      `${method}: ${String((result as { error?: unknown }).error ?? "failed")}`,
    );
  }
  return (result as { result?: { retval?: xdr.ScVal } }).result?.retval ?? null;
}

async function getU64(method: string): Promise<number> {
  const val = await simulate(method);
  if (!val) return 0;
  return Number(scValToNative(val));
}

async function getSubscriberPage(
  offset: number,
  limit: number,
): Promise<string[]> {
  const retval = await simulate(
    "get_subscriber_page",
    nativeToScVal(offset, { type: "u64" }),
    nativeToScVal(limit, { type: "u32" }),
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
    }),
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
  latestLedger: number,
): Promise<Map<string, LedgerMeta>> {
  const out = new Map<string, LedgerMeta>();
  for (const u of users) {
    out.set(u, {
      found: false,
      archived: false,
      liveUntilLedger: null,
      raw: null,
    });
  }

  for (let i = 0; i < users.length; i += LEDGER_ENTRY_BATCH) {
    const slice = users.slice(i, i + LEDGER_ENTRY_BATCH);
    const keys = slice.map(subscriptionLedgerKey);
    try {
      const resp = await server.getLedgerEntries(...keys);
      const entries = resp.entries ?? [];
      for (const entry of entries) {
        // Match by decoding the key's address
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
      // If the whole batch fails, fall back to per-key and mark archived on errors.
      for (const user of slice) {
        try {
          const resp = await server.getLedgerEntries(
            subscriptionLedgerKey(user),
          );
          const entry = resp.entries?.[0];
          if (!entry) {
            // Missing may mean archived or never written — probe via simulation later.
            continue;
          }
          out.set(user, {
            found: true,
            archived: false,
            liveUntilLedger: entry.liveUntilLedgerSeq ?? null,
            raw: entry.val.contractData().val(),
          });
        } catch (inner) {
          const innerMsg =
            inner instanceof Error ? inner.message : String(inner);
          if (
            /archiv|expired|not found/i.test(innerMsg) ||
            /archiv|expired/i.test(msg)
          ) {
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

    // Anything still missing after a successful batch: treat as potentially archived
    // if we can confirm via get_subscription failure patterns later.
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
    const account = await server
      .getAccount(owner)
      .catch(() => new Account(SIM_SOURCE, "0"));
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        tokenContract.call(
          "allowance",
          addressVal(owner),
          nativeToScVal(flowPayAddress, { type: "address" }),
        ),
      )
      .setTimeout(30)
      .build();
    const result = await server.simulateTransaction(tx);
    if ("error" in result) return 0n;
    const retval = (result as { result?: { retval?: xdr.ScVal } }).result
      ?.retval;
    if (!retval || retval.switch().name === "scvVoid") return 0n;
    return BigInt(String(scValToNative(retval)));
  } catch {
    return 0n;
  }
}

async function getSubscriptionHealth(user: string): Promise<{
  within_grace: boolean;
  trial_active: boolean;
  is_paused: boolean;
  active: boolean;
} | null> {
  try {
    const retval = await simulate("get_subscription_health", addressVal(user));
    if (!retval) return null;
    const native = scValToNative(retval) as Record<string, unknown>;
    return {
      within_grace: Boolean(native.within_grace),
      trial_active: Boolean(native.trial_active),
      is_paused: Boolean(native.is_paused),
      active: Boolean(native.active),
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
  details: SubscriberDetail[];
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

  const details: SubscriberDetail[] = [];
  let scanned = 0;

  for (let offset = 0; offset < indexSize; offset += PAGE_SIZE) {
    const page = await getSubscriberPage(offset, PAGE_SIZE);
    if (page.length === 0) break;

    progress(
      `Scanning subscribers ${Math.min(offset + page.length, indexSize)}/${indexSize}…`,
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
        // Fallback to simulation if ledger key encoding didn't match.
        try {
          const retval = await simulate(
            "get_subscription",
            addressVal(address),
          );
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
          paused: false,
          amount: "0",
          allowance: "0",
          low_allowance: false,
          within_grace: false,
          trial_active: false,
          ttl_remaining: null,
          expiring_ttl: false,
          requires_restore: requiresRestore,
          token: "",
        });
        continue;
      }

      const health = await getSubscriptionHealth(address);
      const allowance = sub.active
        ? await getAllowance(address, sub.token)
        : 0n;
      const lowAllowance =
        sub.active && !sub.paused && allowance < sub.amount * 2n;

      let withinGrace = health?.within_grace ?? false;
      if (!health && gracePeriod > 0 && sub.active && !sub.paused) {
        const next = sub.last_charged + sub.interval;
        withinGrace = now >= next && now <= next + gracePeriod;
      }

      const trialActive = health?.trial_active ?? sub.last_charged > now;

      const ttlRemaining =
        meta.liveUntilLedger != null
          ? Math.max(0, meta.liveUntilLedger - latestLedger)
          : null;
      const expiringTtl =
        ttlRemaining != null && ttlRemaining < EXPIRING_TTL_LEDGERS;

      details.push({
        address,
        active: sub.active,
        paused: health?.is_paused ?? sub.paused,
        amount: sub.amount.toString(),
        allowance: allowance.toString(),
        low_allowance: lowAllowance,
        within_grace: withinGrace,
        trial_active: trialActive,
        ttl_remaining: ttlRemaining,
        expiring_ttl: expiringTtl,
        requires_restore: requiresRestore,
        token: sub.token,
      });
    }
  }

  finishProgress();

  const summary: HealthSummary = {
    total_active: details.filter((d) => d.active).length,
    low_allowance_count: details.filter((d) => d.low_allowance).length,
    grace_period_active_count: details.filter((d) => d.within_grace).length,
    paused_count: details.filter((d) => d.paused).length,
    trial_active_count: details.filter((d) => d.trial_active).length,
    expiring_ttl_count: details.filter((d) => d.expiring_ttl).length,
    requires_restore_count: details.filter((d) => d.requires_restore).length,
    total_indexed: indexSize,
    scanned,
  };

  return { summary, details };
}

function printTable(summary: HealthSummary): void {
  const rows: [string, number][] = [
    ["total_active", summary.total_active],
    ["low_allowance_count", summary.low_allowance_count],
    ["grace_period_active_count", summary.grace_period_active_count],
    ["paused_count", summary.paused_count],
    ["trial_active_count", summary.trial_active_count],
    ["expiring_ttl_count", summary.expiring_ttl_count],
    ["requires_restore_count", summary.requires_restore_count],
    ["total_indexed", summary.total_indexed],
    ["scanned", summary.scanned],
  ];
  console.log("");
  console.log("Metric".padEnd(32) + "Value".padStart(12));
  console.log("-".repeat(44));
  for (const [k, v] of rows) {
    console.log(k.padEnd(32) + String(v).padStart(12));
  }
  console.log("");
}

function toCsv(details: SubscriberDetail[]): string {
  const header = [
    "address",
    "active",
    "paused",
    "amount",
    "allowance",
    "low_allowance",
    "within_grace",
    "trial_active",
    "ttl_remaining",
    "expiring_ttl",
    "requires_restore",
    "token",
  ];
  const lines = [header.join(",")];
  for (const d of details) {
    lines.push(
      [
        d.address,
        d.active,
        d.paused,
        d.amount,
        d.allowance,
        d.low_allowance,
        d.within_grace,
        d.trial_active,
        d.ttl_remaining ?? "",
        d.expiring_ttl,
        d.requires_restore,
        d.token,
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
  }
  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    showHelp();
  }

  const format = (getArg("--format") ?? "json").toLowerCase();
  const detailPath = getArg("--detail");

  const started = Date.now();
  const { summary, details } = await collectHealth();
  const elapsedMs = Date.now() - started;

  if (SHOW_PROGRESS) {
    console.error(
      `Completed in ${(elapsedMs / 1000).toFixed(1)}s (scanned ${summary.scanned})`,
    );
  }

  // Public acceptance shape (extra fields allowed for ops)
  const publicSummary = {
    total_active: summary.total_active,
    low_allowance_count: summary.low_allowance_count,
    grace_period_active_count: summary.grace_period_active_count,
    paused_count: summary.paused_count,
    trial_active_count: summary.trial_active_count,
    expiring_ttl_count: summary.expiring_ttl_count,
  };

  if (format === "table") {
    printTable(summary);
  } else {
    console.log(JSON.stringify(publicSummary, null, 2));
  }

  if (detailPath) {
    writeFileSync(detailPath, toCsv(details), "utf8");
    console.error(`Wrote detail CSV to ${detailPath} (${details.length} rows)`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
