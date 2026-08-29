#!/usr/bin/env tsx
/**
 * alert-expiring-allowances.ts — Proactive alerting for soon-to-expire token allowances
 *
 * Checks each subscriber's token allowance expiry ledger. Subscribers whose
 * allowance will expire within ALERT_WINDOW_LEDGERS (default 17280 ≈ 24 h at
 * ~5 s/ledger) are included in the report.
 *
 * Usage:
 *   tsx alert-expiring-allowances.ts [--file subscribers.txt] [--dry-run] [address1 ...]
 *
 * Environment variables:
 *   CONTRACT_ID           Required. Deployed FlowPay contract ID.
 *   RPC_URL               Optional. Soroban RPC endpoint (default: testnet).
 *   NETWORK_PASSPHRASE    Optional. Network passphrase (default: testnet).
 *   ALERT_WINDOW_LEDGERS  Optional. Ledgers ahead to consider "expiring soon"
 *                         (default: 17280 ≈ 24 h).
 *   WEBHOOK_URL           Optional. POST the JSON report here if set.
 *
 * Exit codes:
 *   0 — no expiring allowances found (or dry-run with none found)
 *   1 — one or more allowances are expiring within the alert window
 */

import { Server } from "@stellar/stellar-sdk/rpc";
import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
  Account,
} from "@stellar/stellar-sdk";

// ── Configuration ─────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ??
  Networks.TESTNET) as string;
const ALERT_WINDOW_LEDGERS = parseInt(
  process.env.ALERT_WINDOW_LEDGERS ?? "17280",
  10,
);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!CONTRACT_ID) {
  console.error("Error: CONTRACT_ID environment variable is required.");
  console.error(
    "Usage: CONTRACT_ID=<id> tsx alert-expiring-allowances.ts [--file subs.txt] [--dry-run] [addr ...]",
  );
  process.exit(1);
}

/** A stable dummy source used for read-only simulations (no funds needed). */
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const server = new Server(RPC_URL);
const FlowPayAddress = Address.fromString(CONTRACT_ID);

// ── Types ─────────────────────────────────────────────────────────────────────

/** Raw subscription fields returned by the contract's get_subscription. */
interface Subscription {
  merchant: string;
  amount: bigint;
  token: string;
  active: boolean;
  paused: boolean;
}

/**
 * Per-subscriber expiry report entry.
 * Emitted in the JSON report and sent to the webhook (if configured).
 */
export interface ExpiryEntry {
  address: string;
  merchant: string;
  allowance_amount: string;
  /** Ledger sequence number at which the allowance expires (0 = no expiry set). */
  expires_at_ledger: number;
  ledgers_remaining: number;
}

/** Top-level report posted to the webhook and/or printed to stdout. */
interface AlertReport {
  generated_at: string;
  contract: string;
  current_ledger: number;
  alert_window_ledgers: number;
  expiring_count: number;
  expiring: ExpiryEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function readAddressesFromFile(filePath: string): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  try {
    const content = await readFile(filePath, "utf-8");
    return content
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (err) {
    console.error(`Error reading file "${filePath}": ${err}`);
    process.exit(1);
  }
}

function showHelp(): never {
  console.log(`
Usage: tsx alert-expiring-allowances.ts [options] [addresses...]

Options:
  --file <path>   Read subscriber addresses from a file (one per line, # comments allowed)
  --dry-run       Print the report without sending the webhook
  --help, -h      Show this help

Environment variables:
  CONTRACT_ID           Required. Deployed FlowPay contract ID
  RPC_URL               Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE    Network passphrase (default: Test SDF Network ; September 2015)
  ALERT_WINDOW_LEDGERS  Ledgers ahead to flag as expiring (default: 17280 ≈ 24 h)
  WEBHOOK_URL           If set, POST the JSON report to this URL

Exit codes:
  0  No allowances expiring within the alert window
  1  One or more allowances expiring soon (or webhook returned non-2xx)

Examples:
  CONTRACT_ID=CD123... tsx alert-expiring-allowances.ts GXYZ... GABC...
  CONTRACT_ID=CD123... tsx alert-expiring-allowances.ts --file subscribers.txt
  CONTRACT_ID=CD123... WEBHOOK_URL=https://hooks.example.com/payflow \\
    tsx alert-expiring-allowances.ts --file subscribers.txt
  CONTRACT_ID=CD123... tsx alert-expiring-allowances.ts --dry-run --file subscribers.txt
  `);
  process.exit(0);
}

// ── Contract Reads ────────────────────────────────────────────────────────────

/**
 * Fetches the subscription record for `user` from the FlowPay contract.
 * Returns null if the user has no subscription or on any RPC error.
 */
async function getSubscription(user: string): Promise<Subscription | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_subscription", addressVal(user)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return null;

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result
      ?.retval;
    if (!retval || retval.switch().name === "scvVoid") return null;

    const fields: Record<string, unknown> = {};
    for (const entry of retval.map() ?? []) {
      const key = entry.key().sym().toString();
      const val = entry.val();
      switch (key) {
        case "amount":
          fields[key] = BigInt(val.i128().toString());
          break;
        case "token":
          fields[key] = Address.fromScVal(val).toString();
          break;
        case "merchant":
          fields[key] = Address.fromScVal(val).toString();
          break;
        case "active":
          fields[key] = val.b();
          break;
        case "paused":
          fields[key] = val.b();
          break;
      }
    }

    if (
      fields.amount === undefined ||
      fields.token === undefined ||
      fields.merchant === undefined
    ) {
      return null;
    }

    return {
      merchant: fields.merchant as string,
      amount: fields.amount as bigint,
      token: fields.token as string,
      active: (fields.active as boolean | undefined) ?? false,
      paused: (fields.paused as boolean | undefined) ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * Returns the current allowance amount that the FlowPay contract is approved
 * to spend on behalf of `owner` for token `tokenId`.
 */
async function getAllowanceAmount(
  owner: string,
  tokenId: string,
): Promise<bigint> {
  try {
    const tokenContract = new Contract(tokenId);
    const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        tokenContract.call(
          "allowance",
          addressVal(owner),
          nativeToScVal(FlowPayAddress, { type: "address" }),
        ),
      )
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return 0n;

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result
      ?.retval;
    if (!retval || retval.switch().name === "scvVoid") return 0n;

    return BigInt(retval.i128().toString());
  } catch {
    return 0n;
  }
}

/**
 * Builds the ledger key for the allowance entry stored in a SEP-41 / SAC token
 * contract. Allowances are stored as Temporary ContractData with a Map key of
 * the form `{ "from": Address, "spender": Address }`.
 *
 * The `liveUntilLedgerSeq` of this entry is the expiry ledger.
 */
function buildAllowanceLedgerKey(
  tokenId: string,
  owner: string,
  spender: string,
): xdr.LedgerKey {
  // The SEP-41 / Stellar Asset Contract stores allowances as a Temporary
  // ContractData entry keyed by a ScMap:  { "from": owner, "spender": spender }
  const mapKey = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("from"),
      val: addressVal(owner),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("spender"),
      val: nativeToScVal(Address.fromString(spender), { type: "address" }),
    }),
  ]);

  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(tokenId).toScAddress(),
      key: mapKey,
      durability: xdr.ContractDataDurability.temporary(),
    }),
  );
}

/**
 * Returns the `liveUntilLedgerSeq` for the allowance ledger entry, or 0 if the
 * entry doesn't exist (meaning no expiry / zero allowance).
 */
async function getAllowanceExpiryLedger(
  tokenId: string,
  owner: string,
  spender: string,
): Promise<number> {
  try {
    const ledgerKey = buildAllowanceLedgerKey(tokenId, owner, spender);
    const response = await server.getLedgerEntries(ledgerKey);

    if (!response.entries || response.entries.length === 0) return 0;

    const entry = response.entries[0];
    // liveUntilLedgerSeq is the last ledger the entry is live on.
    // The field is named liveUntilLedgerSeq in the SDK response object.
    const liveUntil = (entry as { liveUntilLedgerSeq?: number })
      .liveUntilLedgerSeq;
    return typeof liveUntil === "number" ? liveUntil : 0;
  } catch {
    return 0;
  }
}

// ── Core Logic ────────────────────────────────────────────────────────────────

/**
 * Checks a single subscriber and returns an ExpiryEntry if their allowance is
 * expiring within the alert window, or null otherwise.
 *
 * Skips:
 *  - Invalid addresses
 *  - Subscribers with no active subscription
 *  - Allowances with no expiry set (liveUntil = 0)
 *  - Allowances that are still healthy (ledgers_remaining > ALERT_WINDOW_LEDGERS)
 */
async function checkSubscriber(
  address: string,
  currentLedger: number,
): Promise<ExpiryEntry | null> {
  // Validate the G-address format
  try {
    Address.fromString(address);
  } catch {
    console.error(`Skipping invalid address: ${address}`);
    return null;
  }

  const sub = await getSubscription(address);
  if (!sub) return null; // No subscription — nothing to alert on

  // Paused or inactive subscribers won't be charged, so skip them.
  if (!sub.active || sub.paused) return null;

  const [allowanceAmount, expiresAtLedger] = await Promise.all([
    getAllowanceAmount(address, sub.token),
    getAllowanceExpiryLedger(sub.token, address, CONTRACT_ID),
  ]);

  // No expiry set — this allowance never expires, skip it.
  if (expiresAtLedger === 0) return null;

  const ledgersRemaining = Math.max(0, expiresAtLedger - currentLedger);

  if (ledgersRemaining > ALERT_WINDOW_LEDGERS) return null;

  return {
    address,
    merchant: sub.merchant,
    allowance_amount: allowanceAmount.toString(),
    expires_at_ledger: expiresAtLedger,
    ledgers_remaining: ledgersRemaining,
  };
}

// ── Webhook Delivery ──────────────────────────────────────────────────────────

/**
 * POSTs the report as JSON to WEBHOOK_URL.
 *
 * Logs the HTTP status on success, logs the error on failure.
 * Does NOT throw — callers rely on the exit code, not exceptions here.
 *
 * @returns true if the webhook was delivered with a 2xx status, false otherwise.
 */
async function sendWebhook(url: string, report: AlertReport): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    if (response.ok) {
      console.error(
        `Webhook delivered successfully (HTTP ${response.status}).`,
      );
      return true;
    } else {
      console.error(
        `Webhook returned non-2xx response: HTTP ${response.status} ${response.statusText}`,
      );
      return false;
    }
  } catch (err) {
    console.error(`Webhook delivery failed: ${err}`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const cliAddresses: string[] = [];
  let filePath: string | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp();
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--file") {
      filePath = argv[++i];
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      showHelp();
    } else {
      cliAddresses.push(arg);
    }
  }

  if (cliAddresses.length === 0 && !filePath) {
    showHelp();
  }

  // Collect all addresses
  const allAddresses = [...cliAddresses];
  if (filePath) {
    const fileAddresses = await readAddressesFromFile(filePath);
    allAddresses.push(...fileAddresses);
  }

  if (allAddresses.length === 0) {
    console.error("No addresses provided.");
    process.exit(1);
  }

  // Fetch the current ledger sequence once — used for all comparisons.
  let currentLedger: number;
  try {
    const ledgerInfo = await server.getLatestLedger();
    currentLedger = ledgerInfo.sequence;
  } catch (err) {
    console.error(`Failed to fetch latest ledger: ${err}`);
    process.exit(1);
  }

  // Check each subscriber sequentially to avoid hammering the RPC endpoint.
  const expiring: ExpiryEntry[] = [];
  for (const addr of allAddresses) {
    const entry = await checkSubscriber(addr, currentLedger);
    if (entry !== null) {
      expiring.push(entry);
    }
  }

  // Sort by ledgers_remaining ascending (most urgent first).
  expiring.sort((a, b) => a.ledgers_remaining - b.ledgers_remaining);

  const report: AlertReport = {
    generated_at: new Date().toISOString(),
    contract: CONTRACT_ID,
    current_ledger: currentLedger,
    alert_window_ledgers: ALERT_WINDOW_LEDGERS,
    expiring_count: expiring.length,
    expiring,
  };

  // Always print the report to stdout.
  console.log(JSON.stringify(report, null, 2));

  if (expiring.length === 0) {
    console.error(
      `No allowances expiring within the next ${ALERT_WINDOW_LEDGERS} ledgers.`,
    );
    process.exit(0);
  }

  console.error(
    `${expiring.length} allowance(s) expiring within ${ALERT_WINDOW_LEDGERS} ledgers.`,
  );

  // Send webhook unless --dry-run is set.
  if (WEBHOOK_URL && !dryRun) {
    const delivered = await sendWebhook(WEBHOOK_URL, report);
    // Exit 1 regardless of webhook success — the expiring allowances are the signal.
    if (!delivered) {
      // Already logged the error inside sendWebhook; still exit 1 below.
    }
  } else if (dryRun) {
    console.error("Dry-run mode: webhook not sent.");
  } else if (!WEBHOOK_URL) {
    console.error("WEBHOOK_URL not set: skipping webhook delivery.");
  }

  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(
    `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
