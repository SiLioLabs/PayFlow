#!/usr/bin/env tsx
/**
 * check-allowances.ts — Audit subscriber token allowances against FlowPay subscription amounts
 *
 * Accepts a list of G-addresses (from args or --file) and checks whether each subscriber's
 * allowance for their subscription token covers the next charge amount.
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
} from "@stellar/stellar-sdk";

// ── Configuration ────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID || "";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET) as string;

if (!CONTRACT_ID) {
  console.error("Error: CONTRACT_ID environment variable is required");
  console.error(
    "Usage: CONTRACT_ID=your_contract_id tsx check-allowances.ts [--file subscribers.txt] [--json] [address1 address2 ...]"
  );
  process.exit(1);
}

const server = new Server(RPC_URL);

// ── Helpers ───────────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: string | bigint): string {
  const value = typeof stroops === "bigint" ? Number(stroops) : Number(stroops);
  return (value / 10_000_000).toFixed(7);
}

async function parseAddressListFromFile(path: string): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  try {
    const content = await readFile(path, "utf-8");
    return content
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (err) {
    console.error(`Error reading file ${path}: ${err}`);
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
Usage: tsx check-allowances.ts [options] [addresses...]

Options:
  --file <path>   Read subscriber addresses from a file (one per line, # comments allowed)
  --json          Output machine-readable JSON instead of human-readable table
  --help, -h      Show this help message

Environment:
  CONTRACT_ID           Required. Deployed FlowPay contract ID
  RPC_URL               Optional. Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE    Optional. Network passphrase (default: Test SDF Network ; September 2015)

Examples:
  CONTRACT_ID=CD123... tsx check-allowances.ts GXYZ... GABC...
  CONTRACT_ID=CD123... tsx check-allowances.ts --file subscribers.txt
  CONTRACT_ID=CD123... tsx check-allowances.ts --json --file subscribers.txt > audit.json
  `);
  process.exit(0);
}

// ── Contract Reads ───────────────────────────────────────────────────────────────

const FlowPayAddress = Address.fromString(CONTRACT_ID);

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function getSubscription(
  user: string
): Promise<{ amount: bigint; token: string; active: boolean; paused: boolean } | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(user);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_subscription", addressVal(user)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return null;

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
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
        case "active":
          fields[key] = val.b();
          break;
        case "paused":
          fields[key] = val.b();
          break;
      }
    }

    return {
      amount: fields.amount as bigint,
      token: fields.token as string,
      active: fields.active as boolean,
      paused: fields.paused as boolean,
    };
  } catch {
    return null;
  }
}

async function getAllowance(owner: string, tokenId: string): Promise<bigint> {
  try {
    const tokenContract = new Contract(tokenId);

    const account = await server.getAccount(owner).catch(() => null);
    if (!account) return 0n;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        tokenContract.call(
          "allowance",
          addressVal(owner),
          nativeToScVal(FlowPayAddress, { type: "address" })
        )
      )
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return 0n;

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") return 0n;

    return BigInt(retval.i128().toString());
  } catch {
    return 0n;
  }
}

// ── Audit Logic ──────────────────────────────────────────────────────────────────

interface AuditResult {
  address: string;
  subscriptionAmount: string;
  allowance: string;
  gap: string;
  token: string;
  active: boolean;
  paused: boolean;
  atRisk: boolean;
  error?: string;
}

async function auditSubscriber(address: string): Promise<AuditResult> {
  let isValid = true;
  try {
    Address.fromString(address);
  } catch {
    isValid = false;
  }
  if (!isValid) {
    return {
      address,
      subscriptionAmount: "0",
      allowance: "0",
      gap: "0",
      token: "",
      active: false,
      paused: false,
      atRisk: false,
      error: "invalid_address",
    };
  }

  const sub = await getSubscription(address);
  if (!sub) {
    return {
      address,
      subscriptionAmount: "0",
      allowance: "0",
      gap: "0",
      token: "",
      active: false,
      paused: false,
      atRisk: false,
      error: "no_subscription",
    };
  }

  const allowance = await getAllowance(address, sub.token);
  const gap = sub.amount > allowance ? sub.amount - allowance : 0n;
  const atRisk = sub.active && !sub.paused && gap > 0n;

  return {
    address,
    subscriptionAmount: sub.amount.toString(),
    allowance: allowance.toString(),
    gap: gap.toString(),
    token: sub.token,
    active: sub.active,
    paused: sub.paused,
    atRisk,
  };
}

// ── Output ───────────────────────────────────────────────────────────────────────

function printHumanReadable(results: AuditResult[]): void {
  const atRisk = results.filter((r) => r.atRisk);
  const noSub = results.filter((r) => r.error === "no_subscription");
  const healthy = results.filter((r) => !r.atRisk && !r.error && r.active);

  console.log(`\nAudited ${results.length} subscriber(s)\n`);

  if (noSub.length > 0) {
    console.log(`${noSub.length} with no subscription:`);
    for (const r of noSub) {
      console.log(`  ${r.address}`);
    }
    console.log();
  }

  if (atRisk.length > 0) {
    console.log(`${atRisk.length} at risk of failed charge:`);
    const header =
      "  ADDRESS".padEnd(56) +
      "AMOUNT".padStart(10) +
      "ALLOWANCE".padStart(12) +
      "GAP".padStart(10) +
      "TOKEN".padStart(56);
    console.log(header);
    for (const r of atRisk) {
      const line =
        r.address.padEnd(56) +
        stroopsToXlm(r.subscriptionAmount).padStart(10) +
        stroopsToXlm(r.allowance).padStart(12) +
        stroopsToXlm(r.gap).padStart(10) +
        r.token.padStart(56);
      console.log(`  ${line}`);
    }
    console.log();
  }

  if (healthy.length > 0) {
    console.log(`${healthy.length} healthy:`);
    for (const r of healthy) {
      console.log(
        `  ${r.address.padEnd(56)} ${stroopsToXlm(r.subscriptionAmount).padStart(10)} ${stroopsToXlm(r.allowance).padStart(10)}`
      );
    }
    console.log();
  }

  console.log(
    `Summary: healthy=${healthy.length}, atRisk=${atRisk.length}, noSubscription=${noSub.length}`
  );
}

function printJson(results: AuditResult[]): void {
  console.log(JSON.stringify(results, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const addresses: string[] = [];
  let filePath: string | undefined;
  let jsonOutput = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp();
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--file") {
      filePath = argv[++i];
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      showHelp();
    } else {
      addresses.push(arg);
    }
  }

  if (addresses.length === 0 && !filePath) {
    showHelp();
  }

  const allAddresses = [...addresses];
  if (filePath) {
    const fileAddresses = await parseAddressListFromFile(filePath);
    allAddresses.push(...fileAddresses);
  }

  if (allAddresses.length === 0) {
    console.error("No valid addresses provided.");
    process.exit(1);
  }

  const results: AuditResult[] = [];
  for (const addr of allAddresses) {
    const result = await auditSubscriber(addr);
    results.push(result);
  }

  if (jsonOutput) {
    printJson(results);
  } else {
    printHumanReadable(results);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
