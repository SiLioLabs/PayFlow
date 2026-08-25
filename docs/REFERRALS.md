# Referral System Architecture and Integration

This document is the canonical reference for PayFlow's referral tracking architecture, fee/payout mechanics for integrators, referral link and code workflows, on-chain APIs, and frontend TypeScript integration.

A shorter usage overview also lives in [`REFERRAL.md`](./REFERRAL.md). For storage TTL details see [`architecture/storage_and_ttl.md`](./architecture/storage_and_ttl.md). For the full function catalog see [`API.md`](./API.md).

---

## Table of Contents

- [Design Summary](#design-summary)
- [Architecture Overview](#architecture-overview)
- [On-Chain Data Model](#on-chain-data-model)
- [Lifecycle and State Transitions](#lifecycle-and-state-transitions)
- [Integration Points](#integration-points)
- [Fee Distribution and Payout Mechanics](#fee-distribution-and-payout-mechanics)
- [Generating and Tracking Referral Links and Codes](#generating-and-tracking-referral-links-and-codes)
- [API Reference](#api-reference)
- [CLI Examples](#cli-examples)
- [Frontend Integration (TypeScript)](#frontend-integration-typescript)
- [Indexer and Analytics Patterns](#indexer-and-analytics-patterns)
- [Error Handling](#error-handling)
- [Security Considerations](#security-considerations)
- [Related Source Files](#related-source-files)

---

## Design Summary

PayFlow's referral feature is an **on-chain attribution layer**, not an on-chain reward vault.

| Concern                                | On-chain? | Where                                                                   |
| -------------------------------------- | --------- | ----------------------------------------------------------------------- |
| Record who referred a subscriber       | Yes       | `DataKey::Referral(user)` + `Subscription.referrer`                     |
| Emit attribution event                 | Yes       | `referred` event                                                        |
| Reject self-referral                   | Yes       | `ContractError::SelfReferral` (code `11`)                               |
| Split protocol fees to a fee collector | Yes       | `fee.rs` (`FeeCollector` / `FeeBps`) — **not** referrer-aware           |
| Pay referrer bonuses / commissions     | **No**    | Off-chain (or a separate reward contract) using events + `get_referrer` |

The contract stores a single optional referrer address per subscriber and emits a `referred` event when that address is set. Integrators use that attribution signal to run signup bonuses, recurring commissions, or tiered rewards outside the core FlowPay transfer path.

---

## Architecture Overview

```text
┌─────────────────┐     referral code / link      ┌──────────────────┐
│  Referrer       │ ─────────────────────────────▶│  Referred user   │
│  (Stellar addr) │                               │  (wallet / dApp) │
└────────┬────────┘                               └────────┬─────────┘
         │                                                 │
         │ off-chain tracking                              │ subscribe(..., referrer)
         ▼                                                 ▼
┌─────────────────┐                               ┌──────────────────┐
│ Analytics /     │◀──── referred + charged ──────│ FlowPay contract │
│ rewards worker  │      events (RPC / indexer)   │ referral.rs      │
└────────┬────────┘                               └────────┬─────────┘
         │                                                 │
         │ optional payout                                 │ persistent
         ▼                                                 ▼
┌─────────────────┐                               DataKey::Referral(user)
│ Token transfer  │                               Subscription.referrer
│ to referrer     │
└─────────────────┘
```

### Module responsibilities

| Layer                                                     | Responsibility                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `contract/src/referral.rs`                                | Store, read, and clear `DataKey::Referral(user)`; reject self-referral; emit `referred`.      |
| `contract/src/lib.rs` (`subscribe_inner`, `cancel_inner`) | Pass `referrer` into storage on subscribe; remove referral on cancel; expose `get_referrer`.  |
| `contract/src/events.rs`                                  | `publish_referred(env, user, referrer)`.                                                      |
| Frontend / integrator                                     | Resolve a referral **code or link** to a Stellar address; pass it as `referrer` on subscribe. |
| Off-chain rewards service                                 | Index `referred` / `charged` events; compute commissions; pay referrers.                      |

---

## On-Chain Data Model

### Storage key

```rust
// DataKey variant in contract/src/lib.rs
Referral(Address), // keyed by subscriber (referred user)
```

| Property     | Value                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Storage type | **Persistent**                                                                                                            |
| Value type   | `Address` (the referrer)                                                                                                  |
| Written by   | `referral::store_referral` during `subscribe` / `subscribe_with_metadata`                                                 |
| Removed by   | `referral::remove_referral` during `cancel` / `cancel_and_refund_prorated`, or `store_referral(..., None)` on resubscribe |
| Read by      | `get_referrer(user)` and off-chain indexers                                                                               |

### Subscription struct field

The same optional address is also mirrored on the subscription record:

```rust
pub struct Subscription {
    // ...
    pub referrer: Option<Address>,
    // ...
}
```

`get_subscription(user)` therefore returns the referrer snapshot that was written at the last successful subscribe. Prefer `get_referrer(user)` when you only need attribution — it reads the dedicated referral key and returns `None` after cancellation clears it.

### Dual write on subscribe

```text
subscribe(user, ..., referrer: Some(R))
        │
        ├─▶ Subscription { referrer: Some(R), ... }   // persistent Subscription(user)
        ├─▶ DataKey::Referral(user) = R               // persistent Referral(user)
        └─▶ event referred(user) → R
```

---

## Lifecycle and State Transitions

```text
                    subscribe(referrer=None)
   [no referral] ─────────────────────────────▶ [no referral]
         │
         │ subscribe(referrer=R)
         ▼
   [Referral(user)=R]
         │
         ├─ subscribe(referrer=R2) ──────────▶ [Referral(user)=R2]   // replaced
         ├─ subscribe(referrer=None) ────────▶ [cleared]
         └─ cancel / cancel_and_refund_* ───▶ [cleared]
```

Rules enforced by the running contract (`contract/src/referral.rs` + `subscribe_inner` / `cancel_inner`):

1. **Optional.** Omitting a referrer (`None` / CLI `null`) stores nothing.
2. **No self-referral.** If `referrer == user`, the call panics with `SelfReferral` (error `11`).
3. **Resubscribe updates.** A later `subscribe` with a different referrer overwrites the stored address and emits a new `referred` event.
4. **Resubscribe with `None` clears.** Passing `referrer: None` removes `DataKey::Referral(user)`.
5. **Cancel clears referral storage.** `cancel_inner` calls `referral::remove_referral`. The cancelled `Subscription` record may still show a historical `referrer` field until the user resubscribes; `get_referrer` returns `None` after cancel.

> **Note:** Older lifecycle notes that describe referrals as “immutable after first write” or “surviving cancel” do not match the current implementation. Treat this document and `referral.rs` as authoritative.

---

## Integration Points

### 1. Subscription creation

Entry points that accept `referrer: Option<Address>`:

- `subscribe(env, user, merchant, amount, interval, token, trial_period, referrer)`
- `subscribe_with_metadata(..., referrer, label)`

Both funnel into `subscribe_inner`, which calls `referral::store_referral`.

### 2. Cancellation

`cancel` and `cancel_and_refund_prorated` remove the referral key so a cancelled subscriber is no longer attributed for new commission calculations that key off `get_referrer`.

### 3. Read path

`get_referrer(user) -> Option<Address>` — no auth required.

### 4. Events

| Event        | Topics                 | Payload                         | When                                                         |
| ------------ | ---------------------- | ------------------------------- | ------------------------------------------------------------ |
| `referred`   | `("referred", user)`   | `referrer: Address`             | Referrer successfully stored on subscribe                    |
| `subscribed` | `("subscribed", user)` | subscription fields             | Every successful subscribe                                   |
| `charged`    | `("charged", user)`    | `(merchant, amount, timestamp)` | Successful recurring charge — used for recurring commissions |
| `cancelled`  | `("cancelled", user)`  | `()`                            | Subscription cancelled                                       |

---

## Fee Distribution and Payout Mechanics

### What the contract pays on-chain

On each successful `charge()` / eligible transfer, FlowPay may split the gross amount using the **protocol fee** configured by admin:

```text
gross = subscription.amount
fee   = gross * FeeBps / 10_000     // if FeeCollector set and bps > 0
net   = gross - fee

user ──transfer_from──▶ FeeCollector   (fee)
user ──transfer_from──▶ Merchant       (net)
```

This split is **independent of referrals**. The referrer address is never an argument to `fee::transfer_subscription_charge`. Referrers do not automatically receive a share of protocol fees or merchant revenue inside FlowPay.

### Building referral payouts (integrator responsibility)

Use on-chain attribution + off-chain (or companion-contract) settlement.

#### Model A — One-time signup bonus

1. Index `referred` events.
2. Optionally wait until the first `charged` event for that `user` (anti-sybil / proof of payment).
3. Transfer a fixed bonus (or credit) to the referrer from a rewards treasury.

```text
referred(user → referrer)
        │
        ▼
 optional: wait for charged(user)
        │
        ▼
 treasury ──token──▶ referrer   (fixed bonus)
```

#### Model B — Recurring commission on charges

1. Index `charged` events `(user, merchant, amount, timestamp)`.
2. Call `get_referrer(user)` (or use a cached map built from `referred`).
3. If a referrer exists, pay `commission = amount * commission_bps / 10_000` from merchant or treasury funds.

```text
charged(user, amount)
        │
        ▼
 get_referrer(user) → Some(R)
        │
        ▼
 commission = amount * bps / 10_000
 treasury / merchant ──token──▶ R
```

Example numbers (off-chain, not enforced by FlowPay):

| Charge amount               | Commission bps | Payout to referrer |
| --------------------------- | -------------- | ------------------ |
| 50_0000000 stroops (50 XLM) | 500 (5%)       | 2_5000000 stroops  |
| 10_0000000 stroops (10 XLM) | 250 (2.5%)     | 2500000 stroops    |

#### Model C — Tiered rewards

1. Maintain an off-chain count of successful referrals per referrer (from `referred`, optionally filtered by first charge).
2. Map count → commission bps (e.g. 1–5 referrals → 3%, 6+ → 5%).
3. Apply Model B with the tiered rate.

#### Relationship to protocol fees

Integrators sometimes fund referral commissions from the protocol fee collector wallet: admin sets `FeeBps`, collector receives fees on every charge, and an off-chain job redistributes a portion to referrers. That redistribution is an operational choice — FlowPay does not automate it.

---

## Generating and Tracking Referral Links and Codes

Referral **codes and links are off-chain**. The contract only understands Stellar addresses.

### Step 1 — Assign a stable code to a referrer

```text
referrer address: GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOP
referral code:    alice-pro   (or short hash / UUID)
```

Store the mapping in your backend:

```sql
-- illustrative
referrers(code TEXT PRIMARY KEY, stellar_address TEXT NOT NULL UNIQUE);
```

### Step 2 — Publish a shareable link

```text
https://app.example.com/subscribe?ref=alice-pro
```

Deep-link variants:

```text
https://app.example.com/r/alice-pro
payflow://subscribe?ref=alice-pro
```

### Step 3 — Capture the code in the frontend

On landing, persist the code for the subscribe flow:

```typescript
// Capture ?ref= from the URL and keep it until subscribe succeeds
const params = new URLSearchParams(window.location.search);
const referralCode = params.get("ref");
if (referralCode) {
  sessionStorage.setItem("payflow_ref", referralCode);
}
```

### Step 4 — Resolve code → Stellar address before subscribe

```typescript
async function resolveReferrer(code: string | null): Promise<string | null> {
  if (!code) return null;
  const res = await fetch(`/api/referrals/${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { address: string };
  return body.address; // G... or C... address string
}
```

### Step 5 — Pass the address into `subscribe`

```typescript
const code = sessionStorage.getItem("payflow_ref");
const referrer = await resolveReferrer(code);
// pass `referrer` into the contract call (see TypeScript section below)
```

### Step 6 — Track conversions

| Signal                                    | Use                                       |
| ----------------------------------------- | ----------------------------------------- |
| Landing with `?ref=`                      | Click / visit analytics                   |
| Successful `subscribe` + `referred` event | Attribution confirmed on-chain            |
| First `charged` event                     | Paid conversion (recommended for rewards) |
| `get_referrer(user)`                      | Ad-hoc lookup / support tooling           |

### Validation checklist for links

1. Code resolves to exactly one referrer address.
2. Resolved address ≠ subscriber address (contract also enforces this).
3. Clear or ignore the stored code after a successful subscribe to avoid accidental re-attribution on later plan changes (unless product intent is to update referrer on resubscribe).

---

## API Reference

### `subscribe` — write referral

```
subscribe(
  env: Env,
  user: Address,
  merchant: Address,
  amount: i128,
  interval: u64,
  token: Address,
  trial_period: Option<u64>,
  referrer: Option<Address>
)
```

| Parameter  | Type              | Referral role                                                              |
| ---------- | ----------------- | -------------------------------------------------------------------------- |
| `user`     | `Address`         | Subscriber (must sign). Cannot equal `referrer`.                           |
| `referrer` | `Option<Address>` | Optional referrer to store. `None` clears any prior referral on overwrite. |

Auth: `user.require_auth()`.

Side effects when `referrer` is `Some(R)`:

- Writes `DataKey::Referral(user) = R`
- Sets `Subscription.referrer = Some(R)`
- Emits `referred`

Errors: `SelfReferral` if `referrer == user`; plus standard subscribe errors (`MerchantNotWhitelisted`, `IntervalTooShort`, etc.).

### `subscribe_with_metadata` — write referral + label

Same referral semantics as `subscribe`, with an additional `label: String` (max 64 bytes).

### `get_referrer` — read referral

```
get_referrer(env: Env, user: Address) -> Option<Address>
```

| Parameter | Type      | Description                          |
| --------- | --------- | ------------------------------------ |
| `user`    | `Address` | Subscriber whose referrer to look up |

Auth: none.

Returns: `Some(referrer)` if `DataKey::Referral(user)` exists; `None` otherwise (never set, cleared on resubscribe, or removed on cancel).

### Internal helpers (not public entry points)

| Function          | Module        | Behavior                                        |
| ----------------- | ------------- | ----------------------------------------------- |
| `store_referral`  | `referral.rs` | Set or clear referral; emit `referred` when set |
| `get_referrer`    | `referral.rs` | Persistent read                                 |
| `remove_referral` | `referral.rs` | Delete key (used by cancel)                     |

---

## CLI Examples

Replace placeholders with your Testnet values.

### Subscribe with a referrer

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source-account <USER_SECRET> \
  --network testnet \
  -- \
  subscribe \
  --user <USER_ADDRESS> \
  --merchant <MERCHANT_ADDRESS> \
  --amount 50000000 \
  --interval 2592000 \
  --token <TOKEN_ADDRESS> \
  --trial_period null \
  --referrer <REFERRER_ADDRESS>
```

### Subscribe without a referrer

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source-account <USER_SECRET> \
  --network testnet \
  -- \
  subscribe \
  --user <USER_ADDRESS> \
  --merchant <MERCHANT_ADDRESS> \
  --amount 50000000 \
  --interval 2592000 \
  --token <TOKEN_ADDRESS> \
  --trial_period null \
  --referrer null
```

### Read the stored referrer

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- \
  get_referrer \
  --user <USER_ADDRESS>
```

### Clear a referrer by resubscribing

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source-account <USER_SECRET> \
  --network testnet \
  -- \
  subscribe \
  --user <USER_ADDRESS> \
  --merchant <MERCHANT_ADDRESS> \
  --amount 50000000 \
  --interval 2592000 \
  --token <TOKEN_ADDRESS> \
  --trial_period null \
  --referrer null
```

### Subscribe with metadata and a referrer

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source-account <USER_SECRET> \
  --network testnet \
  -- \
  subscribe_with_metadata \
  --user <USER_ADDRESS> \
  --merchant <MERCHANT_ADDRESS> \
  --amount 50000000 \
  --interval 2592000 \
  --token <TOKEN_ADDRESS> \
  --trial_period null \
  --referrer <REFERRER_ADDRESS> \
  --label "pro-plan"
```

---

## Frontend Integration (TypeScript)

The in-repo helper `buildSubscribeTx` in `frontend/src/stellar.ts` already accepts `referrer: string | null`. The default subscribe form currently passes `null`; the snippets below show how to wire referral links end-to-end.

### Resolve URL code and subscribe

```typescript
import {
  Contract,
  TransactionBuilder,
  rpc,
  nativeToScVal,
  Address,
  Networks,
  BASE_FEE,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID as string;

const server = new rpc.Server(RPC_URL);

function addressVal(addr: string): xdr.ScVal {
  return Address.fromString(addr).toScVal();
}

function optionAddress(addr: string | null): xdr.ScVal {
  if (!addr) {
    return nativeToScVal(null, { type: "option" });
  }
  return nativeToScVal(
    { tag: "Some", val: addressVal(addr) },
    { type: "option" },
  );
}

/** Read ?ref= and map to a Stellar address via your backend. */
export async function referrerFromUrl(
  lookup: (code: string) => Promise<string | null>,
): Promise<string | null> {
  const code =
    new URLSearchParams(window.location.search).get("ref") ??
    sessionStorage.getItem("payflow_ref");
  if (!code) return null;
  sessionStorage.setItem("payflow_ref", code);
  return lookup(code);
}

/** Build a subscribe transaction that includes referral attribution. */
export async function buildSubscribeWithReferrer(params: {
  user: string;
  merchant: string;
  amountStroops: bigint;
  intervalSec: bigint;
  token: string;
  referrer: string | null;
  trialPeriodSec?: bigint | null;
}): Promise<string> {
  const account = await server.getAccount(params.user);
  const contract = new Contract(CONTRACT_ID);

  const trial =
    params.trialPeriodSec == null
      ? nativeToScVal(null, { type: "option" })
      : nativeToScVal(
          {
            tag: "Some",
            val: nativeToScVal(params.trialPeriodSec, { type: "u64" }),
          },
          { type: "option" },
        );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "subscribe",
        addressVal(params.user),
        addressVal(params.merchant),
        nativeToScVal(params.amountStroops, { type: "i128" }),
        nativeToScVal(params.intervalSec, { type: "u64" }),
        addressVal(params.token),
        trial,
        optionAddress(params.referrer),
      ),
    )
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(simulated.error);
  }
  return rpc.assembleTransaction(tx, simulated).build().toXDR();
}
```

### Using the in-repo `buildSubscribeTx` helper

```typescript
import { buildSubscribeTx, DEFAULT_TOKEN } from "../stellar";

async function subscribeWithReferral(
  userKey: string,
  merchant: string,
  amountXlm: number,
  intervalSec: number,
  referrerAddress: string | null,
  onSign: (xdr: string) => Promise<string>,
) {
  const stroops = BigInt(Math.round(amountXlm * 10_000_000));
  const xdr = await buildSubscribeTx(
    userKey,
    merchant,
    stroops,
    BigInt(intervalSec),
    DEFAULT_TOKEN,
    referrerAddress, // null = no referral
    "", // label / symbol placeholder used by current helper
  );
  return onSign(xdr);
}
```

### Read referrer for dashboards

```typescript
export async function getReferrer(user: string): Promise<string | null> {
  const account = await server.getAccount(user);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_referrer", addressVal(user)))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(result)) {
    throw new Error(result.error);
  }

  const retval = result.result?.retval;
  if (!retval || retval.switch().name === "scvVoid") return null;

  // Decode Option<Address> — adjust to your project's ScVal helpers
  const opt = nativeToScVal; // placeholder: use your ScValDecoder.decodeOption
  void opt;
  return Address.fromScVal(retval).toString();
}
```

### Listen for `referred` events (indexer sketch)

```typescript
export async function pollReferredEvents(startLedger: number) {
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
        topics: [["AAAADwAAAAhyZWZlcnJlZA=="]], // scvSymbol("referred") XDR base64
      },
    ],
    limit: 100,
  });

  for (const event of response.events) {
    // topic[1] = referred user, value = referrer address
    console.log("referred event", event.id, event.topic, event.value);
  }
}
```

Prefer constructing topic filters with `xdr.ScVal.scvSymbol("referred").toXDR("base64")` in production rather than hard-coding XDR strings.

---

## Indexer and Analytics Patterns

Recommended off-chain tables:

```text
referral_attributions
  subscriber_address  PK
  referrer_address
  subscribed_at
  first_charged_at    NULL
  status              active | cancelled | superseded

referral_commissions
  id
  subscriber_address
  referrer_address
  charge_amount
  commission_amount
  charge_tx
  paid_tx             NULL until settled
```

Pipeline:

1. On `referred` → upsert `referral_attributions`.
2. On `charged` → if attribution exists and `get_referrer` still matches, enqueue commission.
3. On `cancelled` → mark attribution cancelled; stop new commissions (historical payouts stay).
4. Periodically reconcile with `get_referrer` for support disputes.

---

## Error Handling

| Code | Name           | Cause                           | Integrator action                                  |
| ---- | -------------- | ------------------------------- | -------------------------------------------------- |
| `11` | `SelfReferral` | `referrer == user` in subscribe | Drop self codes; show “You cannot refer yourself.” |

See [`ERROR-CODES.md`](./ERROR-CODES.md) for the full catalog.

---

## Security Considerations

1. **Attribution ≠ payment.** Anyone who can persuade a user to sign `subscribe` with their address as `referrer` claims attribution. Validate codes server-side; rate-limit rewards; prefer paying after first successful charge.
2. **Self-referral is blocked on-chain**, but circular rings (A refers B, B refers A via two accounts) are not. Detect graphs off-chain if needed.
3. **Resubscribe can change the referrer.** Product policy should decide whether plan changes keep the original referrer (always pass the same address) or allow updates.
4. **Cancel removes `DataKey::Referral`.** Do not assume `get_referrer` remains set after cancellation.
5. **No auth on `get_referrer`.** Referral relationships are public on-chain data.

---

## Related Source Files

| Path                                                      | Role                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`contract/src/referral.rs`](../contract/src/referral.rs) | Store / get / remove referral; self-referral check; event                 |
| [`contract/src/lib.rs`](../contract/src/lib.rs)           | `subscribe`, `get_referrer`, `DataKey::Referral`, `Subscription.referrer` |
| [`contract/src/events.rs`](../contract/src/events.rs)     | `publish_referred`                                                        |
| [`contract/src/errors.rs`](../contract/src/errors.rs)     | `SelfReferral = 11`                                                       |
| [`contract/src/fee.rs`](../contract/src/fee.rs)           | Protocol fee split (not referrer-aware)                                   |
| [`frontend/src/stellar.ts`](../frontend/src/stellar.ts)   | `buildSubscribeTx(..., referrer, ...)`                                    |
| [`docs/REFERRAL.md`](./REFERRAL.md)                       | Short usage guide                                                         |
| [`docs/EVENTS.md`](./EVENTS.md)                           | `referred` event schema                                                   |
| [`docs/API.md`](./API.md)                                 | Full API reference                                                        |

---

## See Also

- [Architecture](./ARCHITECTURE.md) — module map and storage strategy
- [Subscriber lifecycle](./SUBSCRIBER-LIFECYCLE.md) — cancel / resubscribe behavior
- [Integration guide](./INTEGRATION-GUIDE.md) — general SDK patterns
- [Event-driven guide](./EVENT-DRIVEN-GUIDE.md) — indexing `referred` for analytics
