/**
 * services/builders.ts — Transaction builder functions for FlowPay contract invocations
 */

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { assembleTransaction } from "@stellar/stellar-sdk/rpc";
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  getServer,
  isValidContractIdShape,
  addressVal,
} from "./rpc";

/** Build, simulate, and return a ready-to-sign XDR transaction */
export async function buildTx(
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[]
): Promise<string> {
  if (!CONTRACT_ID) {
    throw new Error("VITE_CONTRACT_ID environment variable is not set");
  }

  if (!isValidContractIdShape(CONTRACT_ID)) {
    throw new Error("VITE_CONTRACT_ID is not a valid Soroban contract address");
  }

  if (typeof window !== "undefined" && window.freighter) {
    try {
      const { networkPassphrase } = await window.freighter.getNetwork();
      if (networkPassphrase !== NETWORK_PASSPHRASE) {
        throw new Error(
          "Wallet network passphrase mismatch with configured VITE_NETWORK_PASSPHRASE"
        );
      }
    } catch {
      // Older Freighter or getNetwork failure
    }
  }

  const s = getServer();
  const account = await s.getAccount(sourcePublicKey);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await s.simulateTransaction(tx);
  if ("error" in simResult) throw new Error(simResult.error);

  const assembled = assembleTransaction(tx, simResult) as unknown as { toXDR(): string };
  return assembled.toXDR();
}

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

/**
 * Builds a `pay_per_use_to` transaction that routes a one-shot payment to an
 * alternate `recipient` instead of the subscription's merchant. The contract
 * re-validates the merchant whitelist for the explicit recipient (panics with
 * `MerchantNotWhitelisted` when the whitelist is enabled and the recipient is
 * not listed), so callers should surface that error clearly on failure.
 */
export async function buildPayPerUseToTx(
  user: string,
  amount: bigint,
  recipient: string
): Promise<string> {
  return buildTx(user, "pay_per_use_to", [
    addressVal(user),
    nativeToScVal(amount, { type: "i128" }),
    addressVal(recipient),
  ]);
}

export async function buildPauseTx(user: string): Promise<string> {
  return buildTx(user, "pause", [addressVal(user)]);
}

/**
 * Builds a `pause_until` transaction that pauses the subscription up to a
 * specific Unix timestamp (seconds). The contract rejects (InvalidPauseExpiry)
 * any `expiry` that is not strictly in the future, so callers should validate
 * client-side before building the transaction to avoid a wasted round trip.
 */
export async function buildPauseUntilTx(user: string, expiry: bigint): Promise<string> {
  return buildTx(user, "pause_until", [addressVal(user), nativeToScVal(expiry, { type: "u64" })]);
}

export async function buildResumeTx(user: string): Promise<string> {
  return buildTx(user, "resume", [addressVal(user)]);
}

export async function buildTransferSubscriptionTx(user: string, newUser: string): Promise<string> {
  return buildTx(user, "transfer_subscription", [addressVal(user), addressVal(newUser)]);
}

export async function buildSetDailyLimitTx(user: string, amount: bigint): Promise<string> {
  return buildTx(user, "set_daily_limit", [
    addressVal(user),
    nativeToScVal(amount, { type: "i128" }),
  ]);
}

export async function buildBatchChargeTx(merchantWallet: string, users: string[]): Promise<string> {
  return buildTx(merchantWallet, "batch_charge", [
    users.map((u) => addressVal(u)),
  ] as unknown as xdr.ScVal[]);
}

export async function buildApproveTx(
  user: string,
  tokenId: string,
  spender: string,
  amount: bigint
): Promise<string> {
  const tokenContract = new Contract(tokenId);
  const s = getServer();
  const account = await s.getAccount(user);

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

  const simResult = await s.simulateTransaction(tx);
  if ("error" in simResult) throw new Error(simResult.error);

  const assembled = assembleTransaction(tx, simResult) as unknown as { toXDR(): string };
  return assembled.toXDR();
}

export async function buildRepairSubscriptionTx(
  adminPublicKey: string,
  userAddress: string
): Promise<string> {
  return buildTx(adminPublicKey, "repair_subscription", [addressVal(userAddress)]);
}

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

/**
 * Builds a transaction that calls `extend_subscription_ttl(subscriber)` on the
 * contract. The transaction can be signed by anyone — no admin auth is needed.
 */
export async function buildExtendSubscriptionTtlTx(
  callerPublicKey: string,
  subscriberAddress: string
): Promise<string> {
  return buildTx(callerPublicKey, "extend_subscription_ttl", [addressVal(subscriberAddress)]);
}
