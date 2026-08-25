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
  Account,
  xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import type { Subscription, ChargeEvent, SubscriptionValidationReport } from "./types";
import { ScValDecoder } from "./services/scval";
import { dedupedCall } from "./services/rpcCache";

// ── Config ────────────────────────────────────────────────────────────────────

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

// Replace with your deployed contract ID after `soroban contract deploy`
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? "";
export const TOKEN_CONTRACT_ID = import.meta.env.VITE_TOKEN_CONTRACT_ID ?? "";

// Default token address (XLM) - replace with your actual token
export const DEFAULT_TOKEN =
  import.meta.env.VITE_DEFAULT_TOKEN ?? "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

export const server = new Server(RPC_URL);

/**
 * Returns a Server instance pointing at the active RPC URL.
 * If the user has saved a custom RPC URL in localStorage it takes precedence;
 * otherwise the build-time VITE_RPC_URL (or its fallback) is used.
 *
 * Every call creates a new Server instance so callers always get the latest URL.
 * For high-frequency work (polling hooks) the module-level `server` singleton is
 * still appropriate, but one-off transaction calls should prefer getServer().
 */
export function getServer(): Server {
  try {
    const stored = window.localStorage.getItem("flowpay_custom_rpc_url");
    const customUrl: string | null = stored ? (JSON.parse(stored) as string) : null;
    if (customUrl) return new Server(customUrl);
  } catch {
    // localStorage unavailable or invalid JSON
  }
  return server;
}

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
  return buildTx(user, "pay_per_use", [addressVal(user), nativeToScVal(amount, { type: "i128" })]);
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

export async function buildBatchChargeTx(merchantWallet: string, users: string[]): Promise<string> {
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
        : (retval._value?.vec ?? retval._value?.vec);

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

/**
 * Returns the trial end timestamp (Unix seconds) for a user's subscription,
 * or null if no trial is active (contract returns None).
 *
 * The contract encodes the trial end directly in `last_charged` — it returns
 * `Some(last_charged)` when `last_charged > now`, and `None` once the trial
 * has expired.
 */
export function getTrialEnd(user: string): Promise<bigint | null> {
  return dedupedCall(`getTrialEnd:${user}`, async () => {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(user);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_trial_end", addressVal(user)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) throw new Error((result as { error: string }).error);

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval) return null;

    return ScValDecoder.decodeOption(retval, ScValDecoder.decodeU64);
  });
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

export async function buildApproveTx(
  user: string,
  tokenId: string,
  spender: string,
  amount: bigint
): Promise<string> {
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
    if ("error" in result) throw new Error((result as { error: string }).error);

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") return null;

    const subscriptionData = ScValDecoder.decodeStruct(retval, {
      merchant: ScValDecoder.decodeAddress,
      amount: (v) => ScValDecoder.decodeI128(v).toString(),
      interval: (v) => Number(ScValDecoder.decodeU64(v)),
      last_charged: (v) => Number(ScValDecoder.decodeU64(v)),
      active: ScValDecoder.decodeBool,
      paused: ScValDecoder.decodeBool,
      token: ScValDecoder.decodeAddress,
      referrer: (v) => ScValDecoder.decodeOption(v, ScValDecoder.decodeAddress),
      label: ScValDecoder.decodeSymbol,
      trial_duration: (v) => Number(ScValDecoder.decodeU64(v)),
    });

    const label = await getSubscriptionMetadata(user);

    return {
      merchant: subscriptionData.merchant,
      amount: subscriptionData.amount,
      interval: subscriptionData.interval,
      last_charged: subscriptionData.last_charged,
      active: subscriptionData.active,
      paused: subscriptionData.paused,
      trial_duration: subscriptionData.trial_duration,
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

export interface SubscriptionHealth {
  charged_up: boolean;
  allowance_ok: boolean;
  trial_active: boolean;
  paused: boolean;
  charge_due: boolean;
}

export function getSubscriptionHealth(user: string): Promise<SubscriptionHealth | null> {
  return dedupedCall(`getSubscriptionHealth:${user}`, async () => {
    try {
      const contract = new Contract(CONTRACT_ID);
      const account = await server.getAccount(user);

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call("get_subscription_health", addressVal(user)))
        .setTimeout(30)
        .build();

      const result = await server.simulateTransaction(tx);
      if ("error" in result) throw new Error((result as { error: string }).error);

      const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
      if (!retval || retval.switch().name === "scvVoid") return null;

      return ScValDecoder.decodeStruct(retval, {
        charged_up: ScValDecoder.decodeBool,
        allowance_ok: ScValDecoder.decodeBool,
        trial_active: ScValDecoder.decodeBool,
        paused: ScValDecoder.decodeBool,
        charge_due: ScValDecoder.decodeBool,
      });
    } catch {
      return null;
    }
  });
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
      const lastCharged = Math.max(
        subscribe.timestamp,
        latestChargeByUserAndMerchant.get(chargeKey) ?? 0
      );
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
        .addOperation(contract.call("get_merchant_revenue", addressVal(merchant)))
        .setTimeout(30)
        .build();

      const result = await server.simulateTransaction(tx);
      if ("error" in result) return 0n;

      const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
      if (!retval) return 0n;

      try {
        return ScValDecoder.decodeI128(retval);
      } catch {
        return 0n;
      }
    } catch {
      return 0n;
    }
  });
}

export async function getBalance(
  publicKey: string,
  fields?: { asset_type?: string }
): Promise<string> {
  try {
    // Note: Horizon /accounts/{id} endpoint does not support filtering by asset_type,
    // so we append the query parameter but still parse client-side.
    const query = fields?.asset_type ? `?asset_type=${fields.asset_type}` : "";
    const resp = await fetch(`https://horizon-testnet.stellar.org/accounts/${publicKey}${query}`);
    if (!resp.ok) throw new Error(`Horizon API error: ${resp.status}`);
    const data = await resp.json();

    const assetType = fields?.asset_type ?? "native";
    const nativeBalance = data.balances?.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === assetType
    );
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

      try {
        return ScValDecoder.decodeI128(retval);
      } catch {
        return 0n;
      }
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
      nextCursor:
        response.latestLedger > 0 && response.events.length > 0
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

// ── Contract pause state ─────────────────────────────────────────────────────

/**
 * Returns true if the contract is currently paused, false if not.
 * Returns null if the RPC call fails — callers must treat null as "unknown"
 * and must NOT show the pause banner when the result is uncertain.
 *
 * Uses a static read-only simulation source; no wallet connection required.
 */
export async function getContractPaused(): Promise<boolean | null> {
  if (!CONTRACT_ID) return null;

  try {
    // Soroban simulates read-only calls without requiring a funded source account.
    // We supply a static source; the node ignores sequence/balance for pure
    // view-function simulations.
    const source = new Account(
      // Well-known Stellar "zero" address — safe to use as a sim-only source.
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      "0"
    );

    const contract = new Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("is_contract_paused"))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return null;

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") return null;

    return retval.b?.() ?? false;
  } catch {
    return null;
  }
}

// ── Admin diagnostics ───────────────────────────────────────────────────────

export interface ContractHealthReport {
  rpcReachable: boolean;
  contractPaused: boolean;
  tokenConfigured: boolean;
  activeSubscriptions: number;
  subscriptionTtlLedgers: number | null;
  checkedAt: Date;
}

export async function getContractHealth(caller: string): Promise<ContractHealthReport> {
  const report: ContractHealthReport = {
    rpcReachable: false,
    contractPaused: false,
    tokenConfigured: false,
    activeSubscriptions: 0,
    subscriptionTtlLedgers: null,
    checkedAt: new Date(),
  };

  try {
    await server.getHealth();
    report.rpcReachable = true;
  } catch {
    return report;
  }

  const contract = new Contract(CONTRACT_ID);

  async function simCall(method: string, args: xdr.ScVal[] = []): Promise<xdr.ScVal | null> {
    try {
      const account = await server.getAccount(caller);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();
      const result = await server.simulateTransaction(tx);
      if ("error" in result) return null;
      return (result as { result?: { retval?: xdr.ScVal } }).result?.retval ?? null;
    } catch {
      return null;
    }
  }

  // Check if contract is paused
  const pausedVal = await simCall("is_contract_paused");
  if (pausedVal && pausedVal.switch().name !== "scvVoid") {
    report.contractPaused = pausedVal.b?.() ?? false;
  }

  // Check token configured: get_active_count succeeds only when initialized
  const countVal = await simCall("get_active_count");
  if (countVal && countVal.switch().name !== "scvVoid") {
    report.tokenConfigured = true;
    try {
      report.activeSubscriptions = Number(countVal.u64());
    } catch {
      report.activeSubscriptions = 0;
    }
  }

  return report;
}

const VALIDATION_TIMEOUT_MS = 30_000;

function parseScString(val: xdr.ScVal): string {
  switch (val.switch().name) {
    case "scvString":
      return val.str().toString();
    case "scvSymbol":
      return val.sym().toString();
    default:
      return val.toString();
  }
}

function parseStringVec(val: xdr.ScVal | undefined): string[] {
  if (!val || val.switch().name === "scvVoid") return [];

  const items =
    typeof (val as any).vec === "function"
      ? ((val as any).vec() as xdr.ScVal[])
      : ((val as any)._value?.vec as xdr.ScVal[] | undefined);

  if (!Array.isArray(items)) return [];
  return items.map(parseScString).filter(Boolean);
}

function parseValidationReport(retval: xdr.ScVal): SubscriptionValidationReport {
  const report: SubscriptionValidationReport = {
    isValid: true,
    violations: [],
    missingRecords: [],
    invalidStateTransitions: [],
    corruptedReferences: [],
  };

  if (retval.switch().name === "scvVoid") {
    return report;
  }

  for (const entry of retval.map() ?? []) {
    const key = entry.key().sym().toString();
    const val = entry.val();

    switch (key) {
      case "is_valid":
        report.isValid = val.b();
        break;
      case "violations":
        report.violations = parseStringVec(val);
        break;
      case "missing_records":
        report.missingRecords = parseStringVec(val);
        break;
      case "invalid_state_transitions":
        report.invalidStateTransitions = parseStringVec(val);
        break;
      case "corrupted_references":
        report.corruptedReferences = parseStringVec(val);
        break;
    }
  }

  return report;
}

async function simulateContractRead(
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[],
  timeoutMs = VALIDATION_TIMEOUT_MS
): Promise<xdr.ScVal | null> {
  const account = await server.getAccount(sourcePublicKey);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simPromise = server.simulateTransaction(tx);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Validation request timed out")), timeoutMs);
  });

  const result = await Promise.race([simPromise, timeoutPromise]);
  if ("error" in result) throw new Error(result.error);

  return (result as { result?: { retval?: xdr.ScVal } }).result?.retval ?? null;
}

/** Returns the configured contract admin address, or null if unset. */
export async function getContractAdmin(sourcePublicKey: string): Promise<string | null> {
  if (!CONTRACT_ID) throw new Error("VITE_CONTRACT_ID is not configured.");

  try {
    const retval = await simulateContractRead(sourcePublicKey, "get_admin", []);
    if (!retval || retval.switch().name === "scvVoid") return null;

    if (retval.switch().name === "scvAddress") {
      return Address.fromScVal(retval).toString();
    }

    // Option<Address>
    const inner = (retval as any).value?.() ?? (retval as any)._value;
    if (inner) {
      return Address.fromScVal(inner).toString();
    }

    return null;
  } catch {
    return null;
  }
}

/** Runs on-chain subscription integrity diagnostics for a user address. */
export async function validateSubscription(
  sourcePublicKey: string,
  userAddress: string
): Promise<SubscriptionValidationReport> {
  if (!CONTRACT_ID) throw new Error("VITE_CONTRACT_ID is not configured.");

  const retval = await simulateContractRead(sourcePublicKey, "validate_subscription", [
    addressVal(userAddress),
  ]);

  if (!retval) {
    throw new Error("Contract returned no validation result");
  }

  return parseValidationReport(retval);
}

export async function buildRepairSubscriptionTx(
  adminPublicKey: string,
  userAddress: string
): Promise<string> {
  return buildTx(adminPublicKey, "repair_subscription", [addressVal(userAddress)]);
}

function parseFixedInconsistenciesFromEventValue(value: unknown): number | null {
  if (value == null) return null;

  const raw = value as any;

  if (typeof raw === "number") return raw;
  if (typeof raw === "bigint") return Number(raw);

  const direct =
    raw?._value?.fixed_inconsistencies ?? raw?.fixed_inconsistencies ?? raw?._value ?? raw;

  if (typeof direct === "number") return direct;
  if (typeof direct === "bigint") return Number(direct);

  if (typeof direct?.u32 === "function") return Number(direct.u32());
  if (typeof direct?.toString === "function" && /^\d+$/.test(direct.toString())) {
    return Number(direct.toString());
  }

  return null;
}

/** Extracts the fixed inconsistency count from a `subscription_repaired` contract event. */
export async function parseSubscriptionRepairedEvent(txHash: string): Promise<number | null> {
  try {
    const tx = await server.getTransaction(txHash);
    if (tx.status !== "SUCCESS") return null;

    const events = (tx as { events?: Array<{ topic?: unknown[]; value?: unknown }> }).events ?? [];

    for (const event of events) {
      const topicName = event.topic?.[0]?.toString?.() ?? String(event.topic?.[0] ?? "");
      if (topicName !== "subscription_repaired") continue;

      const count = parseFixedInconsistenciesFromEventValue(event.value);
      if (count != null && !Number.isNaN(count)) {
        return count;
      }
    }

    // Fallback: scan recent contract events tied to this transaction hash.
    const response = await server.getEvents({
      startLedger: undefined,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 50,
    });

    for (const event of response.events) {
      if ((event as any).txHash !== txHash && (event as any).id !== txHash) continue;
      const topicName = event.topic?.[0]?.toString?.() ?? "";
      if (topicName !== "subscription_repaired") continue;

      const count = parseFixedInconsistenciesFromEventValue(event.value);
      if (count != null && !Number.isNaN(count)) {
        return count;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── Admin Batch Operations ────────────────────────────────────────────────────

/**
 * Builds an XDR transaction for `batch_pause_subscriptions`.
 * Admin-only. Contract limit: 25 addresses per call.
 */
export async function buildBatchPauseSubscriptionsTx(
  adminPublicKey: string,
  users: string[]
): Promise<string> {
  return buildTx(adminPublicKey, "batch_pause_subscriptions", [
    nativeToScVal(
      users.map((u) => Address.fromString(u)),
      { type: "vec" }
    ),
  ]);
}

/**
 * Builds an XDR transaction for `whitelist_batch_add`.
 * Admin-only. Contract limit: 50 addresses per call.
 */
export async function buildWhitelistBatchAddTx(
  adminPublicKey: string,
  merchants: string[]
): Promise<string> {
  return buildTx(adminPublicKey, "whitelist_batch_add", [
    nativeToScVal(
      merchants.map((m) => Address.fromString(m)),
      { type: "vec" }
    ),
  ]);
}

/**
 * Builds an XDR transaction for `whitelist_batch_remove`.
 * Admin-only. Contract limit: 50 addresses per call.
 */
export async function buildWhitelistBatchRemoveTx(
  adminPublicKey: string,
  merchants: string[]
): Promise<string> {
  return buildTx(adminPublicKey, "whitelist_batch_remove", [
    nativeToScVal(
      merchants.map((m) => Address.fromString(m)),
      { type: "vec" }
    ),
  ]);
}
// ── TTL / Archived-state helpers ──────────────────────────────────────────────

/**
 * Soroban RPC error codes and message patterns that indicate a contract entry
 * has been archived by the network's state-expiry mechanism.
 *
 * The canonical indicator is error code -32700 ("entryExpired") or the string
 * "archived" appearing in the RPC error message.  Both are treated identically
 * from the UI's perspective: the user must call `extend_subscription_ttl`.
 */
const ARCHIVED_ERROR_PATTERNS = [
  /entryexpired/i,
  /entry.*expired/i,
  /archived/i,
  /ttl.*expired/i,
  /state.*expir/i,
  /-32700/,
] as const;

/**
 * Returns true when an error message or object originates from a Soroban RPC
 * "entry archived / TTL expired" condition.
 */
export function isArchivedError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err ?? "");

  return ARCHIVED_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

/**
 * Builds a transaction that calls `extend_subscription_ttl(subscriber)` on the
 * contract.  The transaction can be signed by anyone — no admin auth is needed.
 *
 * @param callerPublicKey - The Stellar public key used to build/fund the tx (can be the user themselves)
 * @param subscriberAddress - The subscriber whose persistent storage entry should be extended
 * @returns XDR-encoded transaction ready for signing
 */
export async function buildExtendSubscriptionTtlTx(
  callerPublicKey: string,
  subscriberAddress: string
): Promise<string> {
  return buildTx(callerPublicKey, "extend_subscription_ttl", [addressVal(subscriberAddress)]);
}

/**
 * Estimates the fee (in stroops) for an `extend_subscription_ttl` call by
 * running a simulation and reading back the min-resource-fee.
 *
 * Returns `null` when the simulation cannot be completed (e.g. RPC unavailable).
 */
export async function estimateExtendTtlFee(
  callerPublicKey: string,
  subscriberAddress: string
): Promise<bigint | null> {
  try {
    const account = await server.getAccount(callerPublicKey);
    const contract = new Contract(CONTRACT_ID);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("extend_subscription_ttl", addressVal(subscriberAddress)))
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if ("error" in simResult) return null;

    // The minResourceFee field is returned as a string by the RPC
    const minFee = (simResult as { minResourceFee?: string }).minResourceFee;
    if (minFee) return BigInt(minFee);

    return null;
  } catch {
    return null;
  }
}
