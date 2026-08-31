# Merchant Integration Cookbook

[`docs/INTEGRATION-GUIDE.md`](INTEGRATION-GUIDE.md) covers the **subscriber** side of PayFlow (subscribe, approve allowance, listen for charges). This cookbook is the companion for **merchants** — developers who want to accept subscription revenue, monitor their subscriber base, react to billing events, and withdraw accrued balances.

If you are building a SaaS billing dashboard, a marketplace settlement backend, or a merchant ops panel on Stellar, start here. For exact function signatures and error codes, cross-reference [`docs/API.md`](API.md). For event payload shapes, see [`docs/EVENTS.md`](EVENTS.md).

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Receiving Revenue](#2-receiving-revenue)
3. [Monitoring Subscribers](#3-monitoring-subscribers)
4. [Handling Events](#4-handling-events)
5. [Withdrawing Revenue](#5-withdrawing-revenue)
6. [Troubleshooting](#6-troubleshooting)
7. [Related Docs](#7-related-docs)

---

## 1. Getting Started

### 1.1 Prerequisites

| Requirement                  | Notes                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Stellar account (G…)         | Your merchant wallet. Fund it on Testnet via [Friendbot](https://friendbot.stellar.org).                                 |
| Deployed PayFlow contract ID | Set as `VITE_CONTRACT_ID` in the frontend, or pass `--id` to the Soroban CLI. See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md). |
| Token (SAC) address          | The Stellar Asset Contract subscribers will pay with (e.g. Testnet XLM SAC).                                             |
| Node.js 18+ / TypeScript     | For the examples below. Install `@stellar/stellar-sdk`.                                                                  |
| Soroban / Stellar CLI        | For CLI walkthroughs (`soroban` / `stellar`).                                                                            |

Install the SDK:

```bash
npm install @stellar/stellar-sdk
```

Testnet defaults used throughout this guide:

- **RPC URL:** `https://soroban-testnet.stellar.org`
- **Network passphrase:** `Test SDF Network ; September 2015`

### 1.2 How merchant onboarding works

PayFlow can optionally restrict which addresses may receive subscriptions via a **merchant whitelist**:

| State                                                      | Behavior                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Whitelist **disabled** (`is_whitelist_enabled() == false`) | Any address can be passed as `merchant` in `subscribe()`. No admin action required.                                   |
| Whitelist **enabled**                                      | `subscribe()` panics with `ContractError::MerchantNotWhitelisted` unless the merchant was added via `add_merchant()`. |

Additionally, admins can **freeze** a merchant (`freeze_merchant`). A frozen merchant cannot accept new subscriptions; check status with `is_merchant_frozen`.

### 1.3 Requesting whitelist access

1. Confirm whether the deployment has the whitelist on:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- is_whitelist_enabled
```

2. If it returns `true`, send your merchant public key to the contract admin and ask them to run:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- add_merchant \
  --merchant <MERCHANT_ADDRESS>
```

3. Verify you are on the list:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- is_merchant_whitelisted \
  --merchant <MERCHANT_ADDRESS>
```

A successful add emits a `merchant_added` event (see [EVENTS.md — Merchant Events](EVENTS.md#merchant-events)).

### 1.4 Share your merchant address with subscribers

Once whitelisted (or when the whitelist is off), subscribers call `subscribe` with **your** address as `merchant`. Point them at [INTEGRATION-GUIDE.md § 4](INTEGRATION-GUIDE.md#4-subscribing-a-user-programmatically) or your own checkout UI. Recurring charges only happen when a [keeper](KEEPER.md) (or anyone) calls `charge` / `batch_charge` after the billing interval elapses.

### 1.5 Shared TypeScript setup

The snippets below mirror the patterns in [`frontend/src/stellar.ts`](../frontend/src/stellar.ts): a shared RPC `Server`, `Contract`, and `buildTx` helper that simulates then returns signable XDR.

```typescript
import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? ""; // C...

export const server = new Server(RPC_URL);

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

/** Build, simulate, and return ready-to-sign transaction XDR. */
async function buildTx(
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[],
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

  const assembled = assembleTransaction(tx, simResult) as unknown as {
    toXDR(): string;
  };
  return assembled.toXDR();
}

/** Simulate a read-only contract call and return the raw ScVal retval. */
async function simulateRead(
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[],
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

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);
  return (result as { result?: { retval?: xdr.ScVal } }).result?.retval ?? null;
}
```

---

## 2. Receiving Revenue

### 2.1 How `charge()` routes funds

When a keeper (or any account) successfully calls `charge(user)` / `batch_charge(users)`, the contract executes the shared path in `charge_exec::execute_charge`:

1. **Eligibility** — subscription exists, `active == true`, not paused (or auto-resumed), billing interval elapsed, grace window still open.
2. **Protocol fee** — if a fee collector and non-zero BPS are configured, `fee = amount * bps / 10_000` is transferred from the subscriber to the fee collector via `transfer_from`.
3. **Net to merchant** — `net = amount - fee` is transferred from the subscriber to the merchant destination via `transfer_from`. The destination is `MerchantFeeRecipient(merchant)` if set, otherwise the merchant address itself.
4. **Accounting** — `MerchantRevenue(merchant)` (and daily history buckets) are incremented by `net`.
5. **Event** — a `charged` event is published with `{ merchant, gross, fee, net, charged_at }`.

`pay_per_use(user, amount)` follows the same fee/net split and also increments merchant revenue, then emits `pay_per_use`.

`pay_per_use_to(user, amount, recipient)` works the same way but routes the net payment to `recipient` instead of the subscription's merchant. This enables marketplace settlement, affiliate payouts, or splitting metered revenue. When using `pay_per_use_to`:

1. **Whitelist re-validation:** If the merchant whitelist is enabled, `recipient` must be whitelisted — panics with `MerchantNotWhitelisted` (code 10) if not. This is a stricter check than `pay_per_use`, which trusts the merchant was validated at `subscribe` time.
2. **Self-send prevention:** `recipient` cannot be the contract address — panics with `InvalidRecipient` (code 32).
3. **Fee routing:** Fees are calculated against the `recipient` (not the subscription's merchant). The contract checks for a per-recipient custom fee recipient first, then falls back to the global fee collector (same resolution chain as subscription charges).
4. **Revenue attribution:** `MerchantRevenue(recipient)` is incremented by the net amount, not the subscription merchant's counter.

```text
Subscriber token balance
        │
        ├─ fee ──► Fee collector (optional)
        │
        └─ net ──► Merchant (or MerchantFeeRecipient)
                     │
                     └─ MerchantRevenue counter += net
```

Amounts are always in **stroops** (1 XLM = 10,000,000 stroops). See [API.md — `charge`](API.md#charge) and [API.md — `pay_per_use`](API.md#pay_per_use).

### 2.2 When is revenue “available”?

There are two related notions:

| Concept                                      | Meaning                                                                                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wallet balance**                           | After a successful `charge` / `pay_per_use`, the **net** tokens are already in your Stellar account (or fee-recipient address). You can spend them immediately like any other token balance. |
| **Tracked revenue (`get_merchant_revenue`)** | A persistent on-chain counter of cumulative net revenue. Useful for dashboards and for `withdraw_merchant_revenue`.                                                                          |

`withdraw_merchant_revenue` transfers the **tracked** amount from the **contract’s** token balance to the merchant, then resets the counter to zero. It is available when:

1. `get_merchant_revenue(merchant) > 0`, and
2. The contract account holds enough of the configured global token to cover that amount.

> **Note:** The current charge path pays the merchant wallet directly while still incrementing the tracking counter. Withdrawal is the settlement step for balances held by the contract (pooled / escrow-style deployments). Always check both your wallet balance and `get_merchant_revenue` when reconciling. See [§ 5](#5-withdrawing-revenue).

### 2.3 Optional fee recipient

Merchants can redirect net proceeds to a different address via `set_merchant_fee_recipient`. This affects both subscription charges and `pay_per_use` / `pay_per_use_to` calls routed through the merchant.

**Setting a custom fee recipient (CLI):**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <MERCHANT_KEY> \
  --network testnet \
  -- set_merchant_fee_recipient \
  --merchant <MERCHANT_ADDRESS> \
  --recipient <FEE_RECIPIENT_ADDRESS>
```

**Setting a custom fee recipient (TypeScript):**

```typescript
async function setMerchantFeeRecipient(merchantKeypair, recipientAddress) {
  const source = await server.getAccount(merchantKeypair.publicKey());
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(CONTRACT_ID).call(
        "set_merchant_fee_recipient",
        addressVal(merchantKeypair.publicKey()),
        addressVal(recipientAddress),
      ),
    )
    .setTimeout(30)
    .build();
  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(merchantKeypair);
  return await server.sendTransaction(preparedTx);
}
```

**Important notes:**

- The `recipient` cannot be the contract address — this panics with `InvalidRecipient` (code 32).
- The call requires merchant authentication (`merchant.require_auth()`).
- Revenue counters still key off the **merchant** identity used in `subscribe`, not the fee recipient wallet. The fee recipient only changes where protocol fees are routed.
- For `pay_per_use_to`, fee routing resolves against the **recipient** (the custom pay-per-use target), not the subscription merchant. This means a `pay_per_use_to` call to a different merchant will use that merchant's fee recipient configuration.

Revenue counters still key off the **merchant** identity used in `subscribe`, not the recipient wallet. See [`docs/MULTI-TOKEN.md`](MULTI-TOKEN.md) for the full fee resolution chain.

---

## 3. Monitoring Subscribers

### 3.1 On-chain counters

| Function                                                                              | Returns     | Use                                                                                        |
| ------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| [`get_merchant_sub_count(merchant)`](API.md#get_merchant_sub_count)                   | `u32`       | Active subscriber count for your merchant address.                                         |
| [`get_merchant_subscriber_count(merchant)`](API.md#get_merchant_subscriber_count)     | `u64`       | Same underlying `MerchantSubCount` storage (wider type). Prefer either; both stay in sync. |
| [`get_merchant_revenue(merchant)`](API.md#get_merchant_revenue)                       | `i128`      | Cumulative tracked net revenue in stroops.                                                 |
| [`get_merchant_revenue_history(merchant, days)`](API.md#get_merchant_revenue_history) | `Vec<i128>` | Recent per-charge / daily history entries (oldest → newest).                               |
| [`get_merchant_revenue_day(merchant, day)`](API.md#get_merchant_revenue_day)          | `i128`      | Single day bucket (`day = ledger_timestamp / 86400`).                                      |

CLI:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_merchant_sub_count \
  --merchant <MERCHANT_ADDRESS>

soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_merchant_revenue \
  --merchant <MERCHANT_ADDRESS>
```

TypeScript (read helpers, same style as `getMerchantRevenue` in `stellar.ts`):

```typescript
export async function getMerchantSubCount(merchant: string): Promise<number> {
  const retval = await simulateRead(merchant, "get_merchant_sub_count", [
    addressVal(merchant),
  ]);
  if (!retval) return 0;
  // ScVal u32 / u64 depending on binding — coerce safely:
  try {
    return Number(retval.u32());
  } catch {
    try {
      return Number(retval.u64());
    } catch {
      return 0;
    }
  }
}

export async function getMerchantRevenue(merchant: string): Promise<bigint> {
  const retval = await simulateRead(merchant, "get_merchant_revenue", [
    addressVal(merchant),
  ]);
  if (!retval) return 0n;
  // Prefer the project ScValDecoder in production; this is the shape:
  // return ScValDecoder.decodeI128(retval);
  const parts = retval.i128();
  const lo = BigInt(parts.lo().toString());
  const hi = BigInt(parts.hi().toString());
  return (hi << 64n) + (lo < 0n ? lo + (1n << 64n) : lo);
}
```

The frontend already exports `getMerchantRevenue`, `getMerchantRevenueHistory`, and `getMerchantSubscribers` from [`frontend/src/stellar.ts`](../frontend/src/stellar.ts) — reuse those in a merchant dashboard when possible.

### 3.2 Reconstructing the live subscriber list from events

There is no on-chain “list all my subscribers” entrypoint keyed by merchant. The reference approach (used by `getMerchantSubscribers`) is:

1. Poll contract events.
2. Keep the latest `subscribed` per user (with merchant, amount, interval).
3. Drop users whose latest `cancelled` is at or after that subscribe.
4. Filter to rows where `merchant === yourAddress`.

```typescript
import { fetchEvents, getMerchantSubscribers } from "../frontend/src/stellar";
// or copy the getMerchantSubscribers implementation into your backend

const mine = await getMerchantSubscribers("<MERCHANT_ADDRESS>");
for (const row of mine) {
  console.log(
    row.subscriber,
    `amount=${row.amount}`,
    `next=${new Date(row.nextChargeAt * 1000).toISOString()}`,
  );
}
```

For production-grade cursor pagination, gap detection, and deduplication, follow [`docs/EVENT-DRIVEN-GUIDE.md`](EVENT-DRIVEN-GUIDE.md). Operational scripts such as [`scripts/export-merchant-report.ts`](../scripts/export-merchant-report.ts) and [`scripts/watch-events.ts`](../scripts/watch-events.ts) are ready-made starting points.

### 3.3 Health checks merchants should run

| Check                | Call                                      | Healthy signal                |
| -------------------- | ----------------------------------------- | ----------------------------- |
| Still whitelisted    | `is_merchant_whitelisted`                 | `true` when whitelist is on   |
| Not frozen           | `is_merchant_frozen`                      | `false`                       |
| Contract not paused  | `is_contract_paused`                      | `false`                       |
| Subscribers accruing | `get_merchant_sub_count`                  | Matches your off-chain index  |
| Revenue moving       | `get_merchant_revenue` / `charged` events | Increases after keeper cycles |

---

## 4. Handling Events

Merchants should subscribe (via RPC polling) to four core events. Full schemas live in [`docs/EVENTS.md`](EVENTS.md).

| Event         | Topics                  | What it means for you                                                                              | Suggested action                                                                                            |
| ------------- | ----------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `subscribed`  | `["subscribed", user]`  | A user just started (or switched to) billing **you**. Payload includes merchant, amount, interval. | Upsert subscriber in your DB; schedule entitlement provisioning; verify `merchant` is your address.         |
| `charged`     | `["charged", user]`     | A recurring charge succeeded. Payload: `{ merchant, gross, fee, net, charged_at }`.                | Credit the user for the billing period; append to revenue ledger; reconcile against `get_merchant_revenue`. |
| `cancelled`   | `["cancelled", user]`   | Subscription deactivated.                                                                          | Revoke access; decrement local active count; stop expecting further charges.                                |
| `pay_per_use` | `["pay_per_use", user]` | One-time / metered payment. Payload: `(merchant, amount)`.                                         | Deliver the metered unit of work; update usage counters.                                                    |

Also watch (ops / risk):

- `merchant_frozen` / `merchant_removed` — stop marketing new checkouts until resolved.
- `merchant_withdrawal` — confirm treasury movements.
- `paused` / `resumed` on your subscribers — charges will skip while paused.

### 4.1 Polling example

```typescript
/** Poll recent events and handle the merchant-relevant set. */
export async function pollMerchantEvents(merchant: string, cursor?: string) {
  const interesting = [
    "subscribed",
    "charged",
    "cancelled",
    "pay_per_use",
  ] as const;

  for (const name of interesting) {
    // fetchEvents filters by topic[0] === eventName (see stellar.ts)
    const { events, nextCursor } = await fetchEvents(name, undefined, cursor);

    for (const ev of events) {
      const data: any = ev.data;
      const eventMerchant =
        data?._value?.merchant?.toString?.() ??
        data?.merchant?.toString?.() ??
        (Array.isArray(data) ? data[0]?.toString?.() : undefined);

      // subscribed / charged / pay_per_use carry merchant in the payload;
      // cancelled is user-scoped — confirm via your subscriber index.
      if (eventMerchant && eventMerchant !== merchant && name !== "cancelled") {
        continue;
      }

      switch (name) {
        case "subscribed":
          console.log("new sub", ev.address, data);
          break;
        case "charged":
          console.log(
            "charged",
            ev.address,
            "net=",
            data?._value?.net ?? data?.net,
          );
          break;
        case "cancelled":
          console.log("cancelled", ev.address);
          break;
        case "pay_per_use":
          console.log("ppu", ev.address, data);
          break;
      }
    }

    void nextCursor; // persist per event stream in production
  }
}
```

For a continuous terminal watcher:

```bash
npx tsx scripts/watch-events.ts
```

### 4.2 Webhook Notifications

`scripts/watch-events.ts` supports forwarding deduplicated contract events to an external system via signed webhooks.

#### Configuration
Set the following environment variables (e.g. in `scripts/.env`):
* `WEBHOOK_URL`: The HTTP POST endpoint of your server.
* `WEBHOOK_SECRET`: A shared secret string used to sign request bodies.
* `WEBHOOK_DLQ_FILE`: Optional path to write failed deliveries after retry exhaustion (default: `data/webhook-dlq.jsonl`).

#### Signature Verification
Each request is signed with a deterministic HMAC-SHA256 signature calculated over the exact raw JSON request body bytes using `WEBHOOK_SECRET` as the key. The signature is sent as a hexadecimal string in the `X-PayFlow-Signature` header.

To verify a webhook delivery:
1. Read the raw request body buffer.
2. Compute the HMAC-SHA256 hash using your configured shared secret.
3. Compare the computed signature to the value in the `X-PayFlow-Signature` header using constant-time comparison.

Example verification in Node.js:
```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhook(body: string, secret: string, headerSignature: string): boolean {
  const computed = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(headerSignature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

#### Reliability & Retry Logic
Webhook delivery handles network/server errors automatically:
* **Transient errors** (HTTP 408, 429, 5xx, or network dropouts) are retried up to 5 times (6 attempts total) with exponential backoff.
* The script respects the `Retry-After` header for rate-limiting (up to a maximum delay of 30 seconds).
* **Permanent failures** (HTTP 4xx client errors) are aborted immediately without retry.
* Failed payloads are logged to the Dead Letter Queue (DLQ) file without exposing the shared secret. Webhook failures do not disrupt the event polling daemon.

---

## 5. Withdrawing Revenue

### 5.1 Preconditions

1. You are the `merchant` address (auth required).
2. `get_merchant_revenue(merchant) > 0`.
3. The contract is not paused.
4. The global token is initialized (`initialize` was called).
5. The contract account holds ≥ tracked amount of that token.

Calling with a zero balance panics with `ContractError::ZeroBalanceAvailable` (code 21) — see [`docs/ERROR-CODES.md`](ERROR-CODES.md).

### 5.2 CLI walkthrough

```bash
# 1. Inspect tracked balance
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_merchant_revenue \
  --merchant <MERCHANT_ADDRESS>

# 2. Withdraw (signs as the merchant)
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <MERCHANT_KEY> \
  --network testnet \
  -- withdraw_merchant_revenue \
  --merchant <MERCHANT_ADDRESS>

# 3. Confirm counter reset
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_merchant_revenue \
  --merchant <MERCHANT_ADDRESS>
# → 0
```

A successful withdrawal emits `merchant_withdrawal` with the amount transferred.

### 5.3 TypeScript walkthrough

```typescript
/** Build a signable withdraw_merchant_revenue transaction (merchant must sign). */
export async function buildWithdrawMerchantRevenueTx(
  merchant: string,
): Promise<string> {
  return buildTx(merchant, "withdraw_merchant_revenue", [addressVal(merchant)]);
}

/**
 * Example end-to-end flow for a backend that holds the merchant secret.
 * Prefer Freighter / wallet signing in browser apps.
 */
export async function withdrawMerchantRevenue(merchantSecret: string) {
  const { Keypair, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const kp = Keypair.fromSecret(merchantSecret);
  const merchant = kp.publicKey();

  const tracked = await getMerchantRevenue(merchant);
  if (tracked <= 0n) {
    throw new Error("Nothing to withdraw (tracked revenue is zero)");
  }

  const xdrStr = await buildWithdrawMerchantRevenueTx(merchant);
  const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK_PASSPHRASE);
  tx.sign(kp);

  const send = await server.sendTransaction(tx);
  if (send.status === "ERROR") {
    throw new Error(`submit failed: ${JSON.stringify(send)}`);
  }

  // Poll getTransaction until SUCCESS / FAILED in production.
  return send.hash;
}
```

Browser apps should build XDR with `buildWithdrawMerchantRevenueTx`, then pass it through Freighter / Albedo (same pattern as `buildSubscribeTx` in `stellar.ts`).

---

## 6. Troubleshooting

### Why isn't my subscriber being charged?

Work through this checklist:

1. **Is there an active subscription?** `get_subscription(user)` should return `active: true`, `paused: false`, and `merchant` equal to your address.
2. **Has the interval elapsed?** `is_charge_due(user)` should be `true`, or `next_charge_at(user) <= now`. Keepers that call too early get `interval not elapsed` / `ChargeResult::Skipped`.
3. **Is a keeper running?** Soroban has no native scheduler — without `charge` / `batch_charge`, nothing bills. See [`docs/KEEPER.md`](KEEPER.md).
4. **Grace period?** If grace is configured and the keeper is late, you get `grace period elapsed` / `ChargeResult::GracePeriodElapsed`.
5. **Allowance / balance?** The subscriber must have approved the PayFlow contract and hold enough tokens; otherwise `transfer_from` fails.
6. **Merchant frozen or contract paused?** `is_merchant_frozen(you)` / `is_contract_paused()`.
7. **Trial still running?** During trial, `last_charged` is in the future; the first charge waits until trial end. See [`docs/SUBSCRIBER-LIFECYCLE.md`](SUBSCRIBER-LIFECYCLE.md).

### Why is my revenue lower than expected?

1. **Protocol fee** — `net = gross - fee`. Inspect `charged` events for `gross`, `fee`, and `net`. Fee BPS is set by admin (`propose_fee` / `commit_fee`).
2. **You are comparing gross to `get_merchant_revenue`** — the counter tracks **net** only.
3. **Fee recipient redirect** — funds may land in `MerchantFeeRecipient` while counters still attribute to you.
4. **Multi-token mixing** — revenue counters are token-agnostic integers. If subscribers pay different SACs, do not treat the counter as a single-asset total; rebuild per-token totals from events ([MULTI-TOKEN.md](MULTI-TOKEN.md)).
5. **Cancelled / paused users** — they stop generating `charged` events; `get_merchant_sub_count` should drop on cancel.
6. **Withdrawal already cleared the counter** — after `withdraw_merchant_revenue`, `get_merchant_revenue` is `0` even though historical `charged` events remain.
7. **Direct wallet vs tracked counter** — wallet balance increases on each charge; the counter is a separate ledger. Reconcile both.

### Why did `subscribe` fail with MerchantNotWhitelisted?

The deployment has `set_whitelist_enabled(true)` and your address is not in `MerchantWhitelist`. Ask the admin to `add_merchant`, then retry. See [§ 1.3](#13-requesting-whitelist-access).

### Why did `pay_per_use_to` fail with MerchantNotWhitelisted?

The whitelist is enabled and the `recipient` address you specified is not whitelisted. Unlike `pay_per_use` (which trusts the merchant was validated at subscribe time), `pay_per_use_to` re-validates whitelist membership for the custom recipient. Ask the admin to `add_merchant` for the recipient address first. See [§ 1.3](#13-requesting-whitelist-access).

### Why did `pay_per_use_to` or `set_merchant_fee_recipient` fail with InvalidRecipient?

The `recipient` address is the contract address itself. Both `pay_per_use_to` and `set_merchant_fee_recipient` reject the contract address as a valid recipient. Use a regular Stellar account address (G...) instead.

### Why did `withdraw_merchant_revenue` panic?

| Symptom                      | Cause                          | Fix                                                                   |
| ---------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `ZeroBalanceAvailable` (#21) | Tracked revenue ≤ 0            | Wait for charges, or you already withdrew                             |
| Auth failure                 | Wrong signer                   | Sign as the merchant address                                          |
| Contract paused              | Admin pause                    | Wait for unpause                                                      |
| Transfer failure             | Contract token balance too low | Ensure the contract holds the tracked amount of the initialized token |

---

## 7. Related Docs

| Doc                                                                         | Why                                                         |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`INTEGRATION-GUIDE.md`](INTEGRATION-GUIDE.md)                              | Subscriber-side subscribe / charge / events                 |
| [`API.md`](API.md)                                                          | Full contract reference (merchant + admin entrypoints)      |
| [`EVENTS.md`](EVENTS.md) / [`EVENT-DRIVEN-GUIDE.md`](EVENT-DRIVEN-GUIDE.md) | Event schemas and reliable consumption                      |
| [`KEEPER.md`](KEEPER.md)                                                    | Running the off-chain bill collector merchants depend on    |
| [`SUBSCRIBER-LIFECYCLE.md`](SUBSCRIBER-LIFECYCLE.md)                        | Trial, pause, cancel, grace semantics                       |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                                        | Storage keys, fee path, module map                          |
| [`ERROR-CODES.md`](ERROR-CODES.md)                                          | Numeric contract errors                                     |
| [`SECURITY.md`](SECURITY.md)                                                | Auth matrix for merchant vs admin calls                     |
| [`MULTI-TOKEN.md`](MULTI-TOKEN.md)                                          | Per-subscription tokens and fee recipients                  |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                                            | Deploying / configuring a testnet instance                  |
| [`operations/troubleshooting.md`](operations/troubleshooting.md)            | Common ChargeResult errors, wallet failures, and ops issues |
