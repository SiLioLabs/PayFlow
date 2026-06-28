/**
 * subscription-snapshot.ts
 *
 * Fetches get_subscription for each address and writes a JSON snapshot.
 *
 * Usage:
 *   node --experimental-require-module scripts/subscription-snapshot.ts \
 *     [--addresses addr1,addr2,...] [--file addresses.txt] [--out snapshot.json]
 *
 * Reads addresses from:
 *   1. --addresses flag (comma-separated)
 *   2. --file <path> (one address per line)
 *   3. stdin (one address per line, if no flag given)
 *
 * Env: CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE
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
import { readFileSync, writeFileSync } from "node:fs";

const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const server = new Server(RPC_URL);

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
  if ("error" in result) throw new Error(`${method}: ${result.error}`);
  return result.result?.retval ?? null;
}

interface SubscriptionEntry {
  address: string;
  found: boolean;
  active?: boolean;
  paused?: boolean;
  amount?: string;
  interval?: string;
  last_charged?: string;
  next_charge_at?: string;
  merchant?: string;
  token?: string;
}

function decodeSubscription(address: string, val: xdr.ScVal): SubscriptionEntry {
  if (val.switch().name === "scvVoid") return { address, found: false };

  // get_subscription returns Option<Subscription>; unwrap if Some
  const inner = val.switch().name === "scvMap" ? val : val;
  const entries: Map<string, xdr.ScVal> = new Map();
  for (const e of (inner.map() ?? [])) {
    entries.set(e.key().sym().toString(), e.val());
  }

  const get = (k: string) => entries.get(k);
  const u64 = (v: xdr.ScVal | undefined) => (v ? BigInt(v.u64().toString()) : 0n);
  const i128 = (v: xdr.ScVal | undefined) => (v ? v.i128().toString() : "0");
  const bool = (v: xdr.ScVal | undefined) => (v ? v.b() : false);
  const addr = (v: xdr.ScVal | undefined) =>
    v ? Address.fromScVal(v).toString() : "";

  const lastCharged = u64(get("last_charged"));
  const interval = u64(get("interval"));
  const nextChargeAt = lastCharged + interval;

  return {
    address,
    found: true,
    active: bool(get("active")),
    paused: bool(get("paused")),
    amount: i128(get("amount")),
    interval: interval.toString(),
    last_charged: lastCharged.toString(),
    next_charge_at: nextChargeAt.toString(),
    merchant: addr(get("merchant")),
    token: addr(get("token")),
  };
}

function readAddresses(): string[] {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf("--addresses");
  if (flagIdx !== -1) return args[flagIdx + 1].split(",").map((a) => a.trim()).filter(Boolean);

  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1) {
    return readFileSync(args[fileIdx + 1], "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  // stdin
  return readFileSync("/dev/stdin", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function main() {
  if (!CONTRACT_ID) { console.error("CONTRACT_ID required"); process.exit(1); }

  const addresses = readAddresses();
  if (addresses.length === 0) { console.error("No addresses provided"); process.exit(1); }

  const subscriptions: SubscriptionEntry[] = [];
  for (const addr of addresses) {
    const addrVal = Address.fromString(addr).toScVal();
    const retval = await simulate("get_subscription", addrVal);
    subscriptions.push(
      retval && retval.switch().name !== "scvVoid"
        ? decodeSubscription(addr, retval)
        : { address: addr, found: false }
    );
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    contract: CONTRACT_ID,
    network: NETWORK_PASSPHRASE,
    count: subscriptions.length,
    subscriptions,
  };

  const outIdx = process.argv.indexOf("--out");
  if (outIdx !== -1) {
    writeFileSync(process.argv[outIdx + 1], JSON.stringify(snapshot, null, 2));
    console.log(`Wrote snapshot to ${process.argv[outIdx + 1]}`);
  } else {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
