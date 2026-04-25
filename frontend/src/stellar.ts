/**
 * stellar.ts — thin wrapper around @stellar/stellar-sdk for FlowPay
 *
 * All contract interactions go through here so the UI stays clean.
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
import type { Subscription } from "./types";

// ── Config ────────────────────────────────────────────────────────────────────

export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = 
  import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

// Replace with your deployed contract ID after `soroban contract deploy`
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? "";

export const server = new Server(RPC_URL);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a Stellar public key string to an ScVal Address */
function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

/** Build, simulate, and return a ready-to-sign XDR transaction */
async function buildTx(
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[]
): Promise<string> {
  const account = await server.getAccount(sourcePublicKey);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult) throw new Error(simResult.error);

  // assembleTransaction attaches the soroban data / auth entries
  const { assembleTransaction } = await import("@stellar/stellar-sdk/rpc");
  const assembled = assembleTransaction(tx, simResult) as unknown as { toXDR(): string };
  return assembled.toXDR();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the XDR of a `subscribe` transaction ready for wallet signing.
 * @param user        subscriber public key
 * @param merchant    merchant public key
 * @param amount      amount in stroops (1 XLM = 10_000_000 stroops)
 * @param intervalSec seconds between charges (e.g. 2_592_000 = 30 days)
 */
export async function buildSubscribeTx(
  user: string,
  merchant: string,
  amount: bigint,
  intervalSec: bigint
): Promise<string> {
  return buildTx(user, "subscribe", [
    addressVal(user),
    addressVal(merchant),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(intervalSec, { type: "u64" }),
  ]);
}

/** Returns the XDR of a `cancel` transaction ready for wallet signing. */
export async function buildCancelTx(user: string): Promise<string> {
  return buildTx(user, "cancel", [addressVal(user)]);
}

/** Returns the XDR of a `pay_per_use` transaction ready for wallet signing. */
export async function buildPayPerUseTx(user: string, amount: bigint): Promise<string> {
  return buildTx(user, "pay_per_use", [addressVal(user), nativeToScVal(amount, { type: "i128" })]);
}

/** Read-only: fetch a user's subscription from the contract. */
export async function getSubscription(user: string) {
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
  if ("error" in result) throw new Error(result.error);

  // result.result?.retval is an xdr.ScVal — parse it
  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return null;

  // ScVal Option<Subscription> — void means None
  if (retval.switch().name === "scvVoid") return null;

  // Unwrap the Option and map struct fields
  const inner = retval.value(); // ScVal of the inner struct
  const fields: Record<string, unknown> = {};
  for (const entry of inner.map() ?? []) {
    const key = entry.key().sym().toString();
    const val = entry.val();
    switch (key) {
      case "merchant":
        fields[key] = Address.fromScVal(val).toString();
        break;
      case "amount":
        fields[key] = val.i128().toString();
        break;
      case "interval":
      case "last_charged":
        fields[key] = Number(val.u64());
        break;
      case "active":
        fields[key] = val.b();
        break;
    }
  }
  return fields as unknown as Subscription;
}
