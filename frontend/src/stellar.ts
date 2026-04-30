/**
 * stellar.ts — thin wrapper around @stellar/stellar-sdk for FlowPay
 *
 * All contract interactions go through here so the UI stays clean.
 */

import {
  Contract,
  Networks,
  TransactionBuilder,
  Transaction,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import type { Subscription, ChargeEvent } from "./types";

// ── Config ────────────────────────────────────────────────────────────────────

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

// Replace with your deployed contract ID after `soroban contract deploy`
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? "";

export const server = new Server(RPC_URL);

export interface MerchantSubscriber {
  subscriber: string;
  amount: string;
  interval: number;
  lastCharged: number;
  nextChargeAt: number;
  nextChargeDate: string;
}

export interface ContractEvent {
  eventName: string;
  address: string;
  data: unknown;
  ledger: number;
  timestamp: string;
  txHash: string;
}

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

  const assembled = assembleTransaction(tx, simResult) as unknown as { toXDR(): string };
  return assembled.toXDR();
}

// ── Public API ────────────────────────────────────────────────────────────────

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

export async function buildCancelTx(user: string): Promise<string> {
  return buildTx(user, "cancel", [addressVal(user)]);
}

export async function buildPayPerUseTx(user: string, amount: bigint): Promise<string> {
  return buildTx(user, "pay_per_use", [
    addressVal(user),
    nativeToScVal(amount, { type: "i128" }),
  ]);
}

export async function getSubscription(user: string): Promise<Subscription | null> {
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

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return null;

  if (retval.switch().name === "scvVoid") return null;

  const inner = retval.value();
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

  const label = await getSubscriptionMetadata(user);

  return {
    ...(fields as {
      merchant: string;
      amount: string;
      interval: number;
      last_charged: number;
      active: boolean;
    }),
    label: label || undefined,
  };
}

export async function getSubscriptionMetadata(user: string): Promise<string | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(user);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_metadata", addressVal(user)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return null;

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") return null;

    return retval.str().toString();
  } catch {
    return null;
  }
}

export async function getMerchantSubscribers(_merchant: string): Promise<MerchantSubscriber[]> {
  // Placeholder: this would ideally fetch from an indexer or contract events.
  return [];
}

export async function getBalance(publicKey: string): Promise<string> {
  try {
    const resp = await fetch(`https://horizon-testnet.stellar.org/accounts/${publicKey}`);
    const data = await resp.json();
    const nativeBalance = data.balances?.find((b: { asset_type: string }) => b.asset_type === "native");
    return nativeBalance ? nativeBalance.balance : "0";
  } catch {
    return "0";
  }
}

export async function getAllowance(owner: string, tokenId: string): Promise<bigint> {
  try {
    const tokenContract = new Contract(tokenId);
    const account = await server.getAccount(owner);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        tokenContract.call(
          "allowance",
          addressVal(owner),
          nativeToScVal(CONTRACT_ID, { type: "address" })
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

// ── Event Fetching ────────────────────────────────────────────────────────────

/**
 * Fetch contract events by event name, optionally filtered by address.
 * eventName matches the first topic (e.g. "subscribed", "charged", "cancelled", "pay_per_use").
 */
export async function fetchEvents(
  eventName: string,
  address?: string
): Promise<ContractEvent[]> {
  try {
    const response = await server.getEvents({
      startLedger: undefined,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 100,
    });

    return response.events
      .filter((event: any) => {
        if (!event.topic || event.topic.length < 1) return false;
        if (event.topic[0]?.toString() !== eventName) return false;
        if (address && event.topic[1]?.toString() !== address) return false;
        return true;
      })
      .map((event: any) => ({
        eventName,
        address: event.topic[1]?.toString() ?? "",
        data: event.value,
        ledger: event.ledger ?? 0,
        timestamp: event.ledgerCloseTime
          ? new Date(event.ledgerCloseTime * 1000).toISOString()
          : new Date().toISOString(),
        txHash: event.txHash ?? event.id ?? "",
      }));
  } catch {
    return [];
  }
}

// ── Charge History ────────────────────────────────────────────────────────────

export async function getChargeHistory(user: string): Promise<ChargeEvent[]> {
  try {
    const response = await server.getEvents({
      startLedger: undefined,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 50,
    });

    return response.events
      .filter((event: any) => {
        if (!event.topic || event.topic.length < 2) return false;
        const eventType = event.topic[0]?.toString();
        if (eventType !== "charged") return false;
        return event.topic[1]?.toString() === user;
      })
      .map((event: any) => {
        let merchant = "";
        let amount = "0";
        let timestamp = 0;

        try {
          const val = event.value;
          if (val?._value?.merchant) merchant = val._value.merchant.toString();
          if (val?._value?.amount) amount = val._value.amount.toString();
          if (val?._value?.charged_at) timestamp = Number(val._value.charged_at);
          if (timestamp === 0 && event.ledgerCloseTime) timestamp = event.ledgerCloseTime;
        } catch (e) {
          console.warn("Charge event parsing failed:", e);
        }

        return {
          date: new Date(timestamp * 1000),
          amount,
          txHash: event.txHash || event.id || "",
          merchant,
        };
      })
      .sort((a: ChargeEvent, b: ChargeEvent) => b.date.getTime() - a.date.getTime());
  } catch {
    return [];
  }
}
