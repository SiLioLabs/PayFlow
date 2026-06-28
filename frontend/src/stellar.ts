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
import { ScValDecoder } from "./services/scval";
import { dedupedCall } from "./services/rpcCache";

// ── Config ────────────────────────────────────────────────────────────────────

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

// Replace with your deployed contract ID after `soroban contract deploy`
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? "";
export const TOKEN_CONTRACT_ID = import.meta.env.VITE_TOKEN_CONTRACT_ID ?? "";

// Default token address (XLM) - replace with your actual token
export const DEFAULT_TOKEN = import.meta.env.VITE_DEFAULT_TOKEN ?? "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

export const server = new Server(RPC_URL);

// Stellar.expert explorer link for a transaction, on the active network.
export function explorerTxUrl(hash: string): string {
  const network = NETWORK_PASSPHRASE === Networks.PUBLIC ? "public" : "testnet";
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

export interface MerchantSubscriber {
  subscriber: string;
  amount: string;
  interval: number;
  lastCharged: number;
  nextChargeAt: number;
}

export interface ContractEvent {
  eventName: string;
  address: string;
  data: unknown;
  ledger: number;
  timestamp: string;
  txHash: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
  intervalSec: bigint,
  tokenAddr: string,
  referrer: string | null,
  label: string
): Promise<string> {
  const referrerVal = referrer ? { tag: "Some", val: addressVal(referrer) } : { tag: "None" };
  return buildTx(user, "subscribe", [
    addressVal(user),
    addressVal(merchant),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(intervalSec, { type: "u64" }),
    addressVal(tokenAddr),
    nativeToScVal(referrerVal, { type: "option" }),
    nativeToScVal(label, { type: "symbol" }),
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

export async function buildPauseTx(user: string): Promise<string> {
  return buildTx(user, "pause", [addressVal(user)]);
}

export async function buildResumeTx(user: string): Promise<string> {
  return buildTx(user, "resume", [addressVal(user)]);
}

export async function buildSetDailyLimitTx(user: string, amount: bigint): Promise<string> {
  return buildTx(user, "set_daily_limit", [
    addressVal(user),
    nativeToScVal(amount, { type: "i128" }),
  ]);
}

export type BatchChargeOutcome =
  | "Charged"
  | "Skipped"
  | "NoSubscription"
  | "Inactive"
  | "Paused"
  | "GracePeriodElapsed"
  | "Failed";

export async function buildBatchChargeTx(
  merchantWallet: string,
  users: string[]
): Promise<string> {
  return buildTx(merchantWallet, "batch_charge", [
    // batch_charge(users: Vec<Address>)
    users.map((u) => addressVal(u)),
  ] as unknown as xdr.ScVal[]);
}

export async function simulateBatchCharge(
  merchantWallet: string,
  users: string[]
): Promise<BatchChargeOutcome[]> {
  if (users.length === 0) return [];

  const account = await server.getAccount(merchantWallet);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      // call batch_charge(users: Vec<Address>)
      contract.call("batch_charge", [users.map((u) => addressVal(u))] as any)
    )
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult) throw new Error(simResult.error);

  // Best-effort decode of return Vec<ChargeResult>
  try {
    const retval = (simResult as any)?.result?.[0]?.retval ?? (simResult as any)?.result?.retval;
    if (!retval) return [];

    // ScVal Vec access patterns differ across SDK versions; do best-effort.
    const vecItems =
      typeof retval.vec === "function"
        ? (retval.vec() as any[])
        : retval._value?.vec ?? retval._value?.vec;

    if (!Array.isArray(vecItems)) return [];

    return vecItems.map((item: any) => {
      const variantName = item?.switch?.()?.name ?? item?.switch?.().name ?? item?.name;
      if (
        variantName === "Charged" ||
        variantName === "Skipped" ||
        variantName === "NoSubscription" ||
        variantName === "Inactive" ||
        variantName === "Paused" ||
        variantName === "GracePeriodElapsed"
      ) {
        return variantName;
      }
      return "Failed";
    });
  } catch {
    return [];
  }
}


export function getDailyLimit(user: string): Promise<bigint | null> {
  return dedupedCall(`getDailyLimit:${user}`, async () => {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(user);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_daily_limit", addressVal(user)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) throw new Error((result as { error: string }).error);

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval) return null;

    return ScValDecoder.decodeOption(retval, ScValDecoder.decodeI128);
  });
}

export function getDailySpent(user: string): Promise<bigint> {
  return dedupedCall(`getDailySpent:${user}`, async () => {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(user);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_daily_spent", addressVal(user)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) throw new Error((result as { error: string }).error);

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval) return 0n;

    try {
      return ScValDecoder.decodeI128(retval);
    } catch {
      return 0n;
    }
  });
}

export async function buildApproveTx(user: string, tokenId: string, spender: string, amount: bigint): Promise<string> {
  const tokenContract = new Contract(tokenId);
  const account = await server.getAccount(user);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      tokenContract.call(
        "approve",
        addressVal(user),
        addressVal(spender),
        nativeToScVal(amount, { type: "i128" }),
        nativeToScVal(999999999n, { type: "u64" })
      )
    )
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult) throw new Error(simResult.error);

  const assembled = assembleTransaction(tx, simResult) as unknown as { toXDR(): string };
  return assembled.toXDR();
}

export function getSubscription(user: string): Promise<Subscription | null> {
  return dedupedCall(`getSubscription:${user}`, async () => {
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

    const fields: Record<string, unknown> = {};

    for (const entry of retval.map() ?? []) {
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
        case "trial_duration":
          fields[key] = Number(val.u64());
          break;
        case "active":
        case "paused":
          fields[key] = val.b();
          break;
        case "token":
          fields[key] = Address.fromScVal(val).toString();
          break;
        case "referrer":
          if (val.switch().name === "scvVoid") {
            fields[key] = null;
          } else {
            fields[key] = Address.fromScVal(val).toString();
          }
          break;
        case "label":
          fields[key] = val.sym().toString();
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
        paused: boolean;
        trial_duration?: number;
      }),
      label: label || undefined,
    };
  });
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
    if (!retval) return null;

    return ScValDecoder.decodeOption(retval, ScValDecoder.decodeString);
  } catch {
    return null;
  }
}

function parseEventValueField(value: any, field: string): string {
  if (!value) return "";
  const base = value._value?.[field] ?? value[field];
  if (base == null) return "";
  if (typeof base === "string") return base;
  if (typeof base === "number" || typeof base === "bigint") return base.toString();
  if (typeof base.toString === "function") return base.toString();
  return "";
}

function parseEventTime(event: any): number {
  if (typeof event.ledgerCloseTime === "number") return event.ledgerCloseTime;
  if (typeof event.ledgerCloseTime === "string") return Number(event.ledgerCloseTime) || 0;
  if (typeof event.timestamp === "string") return Math.floor(Date.parse(event.timestamp) / 1000);
  return 0;
}

export async function getMerchantSubscribers(merchant: string): Promise<MerchantSubscriber[]> {
  try {
    const response = await server.getEvents({
      startLedger: undefined,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 1000,
    });

    const latestSubscribeByUser = new Map<
      string,
      {
        merchant: string;
        amount: string;
        interval: number;
        timestamp: number;
      }
    >();
    const latestCancelByUser = new Map<string, number>();
    const latestChargeByUserAndMerchant = new Map<string, number>();

    for (const event of response.events) {
      if (!event.topic || event.topic.length < 2) continue;
      const eventType = event.topic[0]?.toString();
      const userAddress = event.topic[1]?.toString();
      if (!userAddress) continue;

      const eventTime = parseEventTime(event);
      switch (eventType) {
        case "subscribed": {
          const subscribedMerchant = parseEventValueField(event.value, "merchant");
          const amount = parseEventValueField(event.value, "amount");
          const intervalString = parseEventValueField(event.value, "interval");
          const interval = Number(intervalString) || 0;
          const existing = latestSubscribeByUser.get(userAddress);
          if (!existing || eventTime > existing.timestamp) {
            latestSubscribeByUser.set(userAddress, {
              merchant: subscribedMerchant,
              amount,
              interval,
              timestamp: eventTime,
            });
          }
          break;
        }
        case "cancelled": {
          const existingCancel = latestCancelByUser.get(userAddress) || 0;
          if (eventTime > existingCancel) {
            latestCancelByUser.set(userAddress, eventTime);
          }
          break;
        }
        case "charged": {
          const chargedMerchant = parseEventValueField(event.value, "merchant");
          const key = `${userAddress}:${chargedMerchant}`;
          const existingCharge = latestChargeByUserAndMerchant.get(key) || 0;
          if (eventTime > existingCharge) {
            latestChargeByUserAndMerchant.set(key, eventTime);
          }
          break;
        }
      }
    }

    const subscribers: MerchantSubscriber[] = [];

    for (const [userAddress, subscribe] of latestSubscribeByUser.entries()) {
      if (subscribe.merchant !== merchant) continue;
      const cancelAt = latestCancelByUser.get(userAddress) ?? 0;
      if (cancelAt >= subscribe.timestamp) continue;

      const chargeKey = `${userAddress}:${merchant}`;
      const lastCharged = Math.max(subscribe.timestamp, latestChargeByUserAndMerchant.get(chargeKey) ?? 0);
      const nextChargeAt = lastCharged + subscribe.interval;

      subscribers.push({
        subscriber: userAddress,
        amount: subscribe.amount,
        interval: subscribe.interval,
        lastCharged,
        nextChargeAt,
      });
    }

    return subscribers.sort((a, b) => a.subscriber.localeCompare(b.subscriber));
  } catch {
    return [];
  }
}

export async function getMerchantRevenueHistory(merchant: string, days = 7): Promise<bigint[]> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(merchant);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "get_merchant_revenue_history",
          addressVal(merchant),
          nativeToScVal(days, { type: "u32" })
        )
      )
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return [];

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval) return [];

    return ScValDecoder.decodeVec(retval, ScValDecoder.decodeI128);
  } catch {
    return [];
  }
}

export function getMerchantRevenue(merchant: string): Promise<bigint> {
  return dedupedCall(`getMerchantRevenue:${merchant}`, async () => {
    try {
      const contract = new Contract(CONTRACT_ID);
      const account = await server.getAccount(merchant);

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "get_merchant_revenue",
            addressVal(merchant)
          )
        )
        .setTimeout(30)
        .build();

      const result = await server.simulateTransaction(tx);
      if ("error" in result) return 0n;

      const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
      if (!retval) return 0n;

      return ScValDecoder.decodeI128(retval);
    } catch {
      return 0n;
    }
  });
}

export async function getBalance(publicKey: string, fields?: { asset_type?: string }): Promise<string> {
  try {
    // Note: Horizon /accounts/{id} endpoint does not support filtering by asset_type,
    // so we append the query parameter but still parse client-side.
    const query = fields?.asset_type ? `?asset_type=${fields.asset_type}` : "";
    const resp = await fetch(`https://horizon-testnet.stellar.org/accounts/${publicKey}${query}`);
    if (!resp.ok) throw new Error(`Horizon API error: ${resp.status}`);
    const data = await resp.json();
    
    const assetType = fields?.asset_type ?? "native";
    const nativeBalance = data.balances?.find((b: { asset_type: string; balance: string }) => b.asset_type === assetType);
    return nativeBalance?.balance ?? "0";
  } catch {
    return "0";
  }
}

export function getAllowance(owner: string, tokenId = TOKEN_CONTRACT_ID): Promise<bigint> {
  if (!tokenId) return Promise.reject(new Error("VITE_TOKEN_CONTRACT_ID is not configured."));

  return dedupedCall(`getAllowance:${owner}:${tokenId}`, async () => {
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
      if (!retval) return 0n;

      return ScValDecoder.decodeI128(retval);
    } catch {
      return 0n;
    }
  });
}

// ── Event Fetching ────────────────────────────────────────────────────────────

/**
 * Fetch contract events by event name, optionally filtered by address.
 * eventName matches the first topic (e.g. "subscribed", "charged", "cancelled", "pay_per_use").
 */
export async function fetchEvents(
  eventName: string,
  address?: string,
  cursor?: string
): Promise<{ events: ContractEvent[]; nextCursor?: string }> {
  try {
    const response = await server.getEvents({
      cursor,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 100,
    });

    const events = response.events
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

    return {
      events,
      nextCursor: response.latestLedger > 0 && response.events.length > 0
        ? response.events[response.events.length - 1].pagingToken
        : undefined,
    };
  } catch {
    return { events: [] };
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

