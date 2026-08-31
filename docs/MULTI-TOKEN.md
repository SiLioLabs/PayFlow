# Multi-Token Architecture Guide

This guide explains how PayFlow supports multiple Stellar Asset Contract (SAC) tokens, how that capability is implemented at the storage level, how to deploy and operate it, what it means for protocol fees, how a subscriber switches tokens, and — just as importantly — what it does _not_ do.

If you only need the mechanics of approving an allowance and subscribing with a specific token, jump to [Subscribing with Custom Tokens](#subscribing-with-custom-tokens) and the [Full CLI Walkthrough](#full-cli-walkthrough). If you're deciding how to deploy PayFlow for a multi-token product, read [Architecture](#architecture-per-subscription-tokens) and [Deployment Models](#deployment-models) first.

---

## Table of Contents

- [What is a SAC Token?](#what-is-a-sac-token)
- [Architecture: Per-Subscription Tokens](#architecture-per-subscription-tokens)
- [Deployment Models](#deployment-models)
- [Fee Implications](#fee-implications)
- [Volume Accounting and Fee Semantics for Accountants](#volume-accounting-and-fee-semantics-for-accountants)
- [Switching Tokens](#switching-tokens)
- [Pay-Per-Use and Tokens](#pay-per-use-and-tokens)
- [Known Limitations](#known-limitations)
- [Subscribing with Custom Tokens](#subscribing-with-custom-tokens)
- [Allowance Setup](#allowance-setup)
- [Full CLI Walkthrough](#full-cli-walkthrough)

---

## What is a SAC Token?

A Stellar Asset Contract (SAC) is a Soroban smart contract that implements the [Soroban Token Interface](https://developers.stellar.org/docs/build/sdks-and-libraries/soroban-token-interface/), the standard for tokens on Stellar. SAC tokens back custom stablecoins, reward points, utility tokens, or any tokenized asset on Stellar, including classic Stellar assets wrapped as a SAC. PayFlow only ever talks to the [Soroban Token Interface](https://developers.stellar.org/docs/build/sdks-and-libraries/soroban-token-interface/) (`balance`, `allowance`, `transfer_from`, …) — it has no special-cased logic for any particular token, which is what makes per-subscription tokens possible with no contract changes.

---

## Architecture: Per-Subscription Tokens

### The `token` field in `Subscription`

Every subscription record carries its own token address:

```rust
pub struct Subscription {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub last_charged: u64,
    pub active: bool,
    pub paused: bool,
    pub token: Address,            // SAC token used for this subscription
    pub referrer: Option<Address>,
    pub label: Symbol,
    pub trial_duration: u64,
}
```

`token` is set once, at `subscribe()` / `subscribe_with_metadata()` time, and is read back on every subsequent `charge()` and `pay_per_use()` call for that subscriber. There is no global "the payment token" that all subscribers share — each `Subscription(user)` persistent record is self-describing. This is a deliberate design choice: it means one deployed contract instance can serve subscribers paying in USDC, subscribers paying in a game's reward token, and subscribers paying in wrapped XLM, all at the same time, with no per-token configuration step required from the admin.

### How a charge resolves its token

`fee.rs::transfer_subscription_charge` never receives a token as a parameter — it reads `sub.token` directly from the loaded subscription and builds a `token::Client` from it:

```rust
pub fn transfer_subscription_charge(env: &Env, user: &Address, sub: &Subscription) -> i128 {
    // ...
    let token_client = token::Client::new(env, &sub.token);
    // fee transfer_from(...) and merchant transfer_from(...) both use sub.token
}
```

This is why "multi-token" in PayFlow is accurate to describe as **per-subscription token routing**, not a shared liquidity pool: each charge is a straight `transfer_from(user, destination, amount)` call against whatever SAC contract that one subscriber's record points to.

### Architecture diagram

```text
                     ┌─────────────────────────────┐
                     │   FlowPay contract instance   │
                     │                                │
                     │  Subscription(alice)           │
                     │    token = USDC_SAC ───────────┼──┐
                     │  Subscription(bob)              │  │
                     │    token = XLM_SAC ─────────────┼──┼──┐
                     │  Subscription(carol)            │  │  │
                     │    token = REWARD_SAC ──────────┼──┼──┼──┐
                     └─────────────────────────────────┘  │  │  │
                                                            │  │  │
                        ┌───────────────────────────────────┘  │  │
                        │            ┌──────────────────────────┘  │
                        ▼            ▼                              ▼
                 ┌───────────┐ ┌───────────┐                 ┌────────────┐
                 │ USDC SAC  │ │  XLM SAC  │                 │ REWARD SAC │
                 │ contract  │ │ contract  │                 │  contract  │
                 └───────────┘ └───────────┘                 └────────────┘
```

One `charge(alice)` call transfers USDC; one `charge(bob)` call transfers XLM. Neither call touches the other token contract. The FlowPay instance itself never holds a token balance — it only spends through the allowance each subscriber granted via `approve()`.

### `initialize()`'s token is only a default hint

```rust
pub fn initialize(env: Env, token: Address, admin: Address) {
    // ...
    env.storage().instance().set(&DataKey::Token, &token);
    admin::initialize_admin(&env, &admin);
}
```

The `token` passed to `initialize()` is stored once under `DataKey::Token` and exposed read-only via `get_token()`. It is **not** enforced anywhere in `subscribe()`, `charge()`, or `pay_per_use()` — none of those functions read `DataKey::Token` at all. In the current implementation it functions purely as a UI/documentation default (e.g., what a frontend pre-fills in a subscribe form), not an access-control allowlist. Any subscriber can pass any valid SAC address to `subscribe()`, regardless of what `initialize()` was called with.

### Token address validation

`subscribe_inner` does perform one structural check before accepting a `token` address — it inspects byte 7 of the address's XDR encoding to reject classic Stellar account addresses (`G...` accounts) and accept only contract addresses (`C...`):

```rust
use soroban_sdk::xdr::ToXdr;
if token.clone().to_xdr(env).get(7) == Some(0) {
    env.panic_with_error(ContractError::InvalidTokenAddress);
}
```

This check confirms the address is _shaped like_ a contract address. It does **not** verify the contract actually implements the token interface, has been initialized, or is a genuine SAC rather than an arbitrary Soroban contract — that failure mode surfaces later, as a panic inside `check_allowance()` or the first `transfer_from()`, when the non-token contract's `allowance`/`transfer_from` entry points don't exist or misbehave.

---

## Deployment Models

There are two ways to offer multiple tokens to your users, and they are not mutually exclusive.

### Model A: Single instance, multiple tokens (the built-in model)

Deploy one FlowPay contract instance. Subscribers choose their own `token` per `subscribe()` call, as described above. No extra deployment work is required — this is simply how the contract already behaves.

**Pros:**

- One contract to deploy, upgrade (via [`propose_upgrade`/`commit_upgrade`](./architecture/two-step-auth.md)), and monitor.
- One `ActiveCount`, one whitelist, one grace period, one admin — all protocol-wide settings apply uniformly regardless of which token a subscriber uses.
- Merchants can accept multiple tokens without deploying anything themselves.

**Cons:**

- The admin, `fee_collector`, and every merchant must be prepared to receive and manage balances in however many distinct tokens their subscribers choose. There is no on-chain aggregation across tokens (see [Fee Implications](#fee-implications)).
- A bug or pause (`pause_contract()`) affects subscribers across _all_ tokens simultaneously, since it's one instance.
- Per-token analytics (e.g., "total USDC-denominated revenue") must be computed off-chain by filtering `charged` events on the token address emitted in `subscribe`/`subscribed` events, since `merchant_stats.rs` revenue counters are token-agnostic integers.

### Model B: Separate contract instance per base token

Deploy multiple FlowPay instances (`soroban contract deploy` once per instance), each initialized with a different default `token`. Steer subscribers to the instance matching their preferred token (e.g., `payflow-usdc.example.com` vs `payflow-xlm.example.com`).

**Pros:**

- Clean separation: each instance's `ActiveCount`, whitelist, and grace period apply only to that token's subscriber base.
- A pause or upgrade on one instance does not affect the others.
- Simpler mental model for merchants who only want to accept one token.

**Cons:**

- N contract IDs to track, fund with an admin, and monitor.
- No shared subscriber identity or global stats across instances — a user subscribed on both instances looks like two unrelated subscribers.
- More deployment and keeper-configuration overhead (the keeper must know about every instance).

### Choosing between them

|                                    | Model A: single instance                        | Model B: per-token instances                                               |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| Contract deployments               | 1                                               | N                                                                          |
| Subscriber can mix tokens freely   | Yes, per-subscription                           | No — must pick an instance                                                 |
| Admin/whitelist/grace period scope | Shared across all tokens                        | Isolated per token                                                         |
| Best for                           | Consumer apps where users bring their own token | Businesses that want strict per-asset isolation (e.g., regulatory reasons) |

Nothing prevents combining them: deploy a handful of instances for tokens you want isolated (e.g., a regulated stablecoin), while letting a shared "general" instance accept anything else.

---

## Fee Implications

The protocol fee is configured once, contract-wide, as a basis-points percentage:

```rust
pub fn get_fee_bps(env: &Env) -> u32 { /* DataKey::FeeBps, default 0 */ }
pub fn calculate_fee_amount(amount: i128, bps: u32) -> i128 {
    if bps == 0 || amount <= 0 { return 0; }
    amount * (bps as i128) / 10_000
}
```

`fee_bps` is a pure percentage — it has no notion of currency. When a charge executes, the fee is computed as `sub.amount * fee_bps / 10_000` **in that subscription's own token**, then transferred to `fee_collector` in that same token:

```rust
let token_client = token::Client::new(env, &sub.token);
token_client.transfer_from(&env.current_contract_address(), user, &collector, &fee);
```

### Worked example

Assume `fee_bps = 250` (2.5%) and `fee_collector = F`.

| Subscriber | `sub.token` | `sub.amount`        | Fee transferred to `F` | Net to merchant    |
| ---------- | ----------- | ------------------- | ---------------------- | ------------------ |
| Alice      | USDC SAC    | 100.0000000 USDC    | 2.5000000 USDC         | 97.5000000 USDC    |
| Bob        | XLM SAC     | 50.0000000 XLM      | 1.2500000 XLM          | 48.7500000 XLM     |
| Carol      | REWARD SAC  | 1000.0000000 REWARD | 25.0000000 REWARD      | 975.0000000 REWARD |

`F` ends up holding balances in three unrelated tokens. **PayFlow never converts, swaps, or nets these against each other** — `get_fee(env) -> Option<(Address, u32)>` returns one collector address and one bps value for the whole contract; it has no per-token override. If you need per-token fee rates or per-token fee collectors, that requires either Deployment Model B (a separate instance, and therefore a separate `propose_fee`/`commit_fee` pair, per token) or a contract change — it is not configurable today.

### Merchant-level fee recipient override

Independently of the token, a merchant can redirect _their own_ net proceeds to a different address via `DataKey::MerchantFeeRecipient(merchant)`:

```rust
let merchant_dest: Address = env
    .storage()
    .persistent()
    .get(&DataKey::MerchantFeeRecipient(sub.merchant.clone()))
    .unwrap_or_else(|| sub.merchant.clone());
token_client.transfer_from(&env.current_contract_address(), user, &merchant_dest, &net);
```

This override is per-merchant, not per-token — if a merchant accepts subscriptions in three different tokens, all three still route their net amount to the same configured `merchant_dest`.

---

## Volume Accounting and Fee Semantics for Accountants

This section explains how multi-token volume accounting and per-token fee transfers behave in practice. It is intended for accountants, auditors, and indexer developers who need to understand the on-chain data model precisely.

### How volume is tracked

The contract maintains a rolling hourly volume cap via `check_and_update_global_volume`:

```rust
pub(crate) fn check_and_update_global_volume(env: &Env, amount: i128) {
    // ...
    let new_volume = window.accumulated_volume.checked_add(amount).unwrap_or_else(|| /* panic */);
    if new_volume > GLOBAL_MAX_VOLUME_PER_HOUR {
        env.panic_with_error(ContractError::GlobalVolumeExceeded);
    }
    // ...
}
```

**Key fact:** `amount` is the raw `i128` value from the subscription (or pay-per-use call), denominated in the subscription's own token's stroops. All amounts from all tokens are summed into a **single `i128` accumulator** (`GlobalVolumeWindow.accumulated_volume`). There is no per-token dimension.

This means a charge of 50,000,000 stroops of USDC and a charge of 50,000,000 stroops of XLM both add `50_000_000` to the same counter, even though 50M USDC stroops ≈ $50 while 50M XLM stroops ≈ $5 (approximate, real prices vary).

### How fees are calculated and transferred

Fee calculation is token-agnostic — it operates on raw `i128` values:

```rust
pub fn calculate_fee_amount(amount: i128, bps: u32) -> i128 {
    if bps == 0 || amount <= 0 { return 0; }
    amount * (bps as i128) / 10_000
}
```

Fee transfers are per-token. Each charge transfers the fee in the subscription's own token to the fee recipient:

```rust
let token_client = token::Client::new(env, &sub.token);
token_client.transfer_from(&env.current_contract_address(), user, &collector, &fee);
```

The fee recipient priority is:

1. `MerchantFeeRecipient(merchant)` — per-merchant override, if set
2. `FeeCollector` — global fallback

**Key fact:** Fee transfers are always in the subscription's own token. There is no conversion, no swap, and no netting across tokens.

### Worked examples

#### Example 1: Single-token scenario (XLM only)

Assume `fee_bps = 250` (2.5%), `fee_collector = F`, and all subscriptions use XLM.

| Subscriber | Token | Amount (stroops) | Fee to F (stroops) | Net to merchant (stroops) |
| ---------- | ----- | ---------------- | ------------------ | ------------------------- |
| Alice      | XLM   | 50,000,000       | 1,250,000          | 48,750,000                |
| Bob        | XLM   | 100,000,000      | 2,500,000          | 97,500,000                |

**Global volume window** after both charges: `150,000,000` stroops.
**`TotalProtocolFees`** after both charges: `3,750,000` stroops.
**Merchant revenue** (`MerchantRevenue`): `146,250,000` stroops.

All counters are in XLM stroops. This is internally consistent — every value uses the same token.

#### Example 2: Single-token scenario (USDC only)

Same `fee_bps = 250` (2.5%), all subscriptions use USDC (7 decimal places).

| Subscriber | Token | Amount (stroops) | Fee to F (stroops) | Net to merchant (stroops) |
| ---------- | ----- | ---------------- | ------------------ | ------------------------- |
| Alice      | USDC  | 100,000,000      | 2,500,000          | 97,500,000                |
| Bob        | USDC  | 50,000,000       | 1,250,000          | 48,750,000                |

**Global volume window**: `150,000,000` stroops.
**`TotalProtocolFees`**: `3,750,000` stroops.
**Merchant revenue**: `146,250,000` stroops.

Again internally consistent — all values are USDC stroops.

#### Example 3: Mixed-token scenario (XLM + USDC)

Same `fee_bps = 250` (2.5%). Alice pays in XLM, Bob pays in USDC.

| Subscriber | Token | Amount (stroops) | Fee to F (stroops) | Net to merchant (stroops) |
| ---------- | ----- | ---------------- | ------------------ | ------------------------- |
| Alice      | XLM   | 50,000,000       | 1,250,000          | 48,750,000                |
| Bob        | USDC  | 100,000,000      | 2,500,000          | 97,500,000                |

**Fee transfers:**

- Alice's fee: 1,250,000 XLM stroops transferred to F via XLM SAC contract
- Bob's fee: 2,500,000 USDC stroops transferred to F via USDC SAC contract
- F receives two separate token balances — these are **not** summed on-chain

**On-chain counters (all in raw `i128`, no token dimension):**

| Counter                                 | Value         | Meaning                                                                                            |
| --------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `GlobalVolumeWindow.accumulated_volume` | `150,000,000` | Sum of 50M XLM stroops + 100M USDC stroops — **semantically meaningless as a combined figure**     |
| `TotalProtocolFees`                     | `3,750,000`   | Sum of 1.25M XLM stroops + 2.5M USDC stroops — **semantically meaningless as a combined figure**   |
| `MerchantRevenue(merchant)`             | `146,250,000` | Sum of 48.75M XLM stroops + 97.5M USDC stroops — **semantically meaningless as a combined figure** |

### Limitations of global stroop-denominated volume

The global volume cap (`GLOBAL_MAX_VOLUME_PER_HOUR = 50_000_000_000_000` stroops) compares heterogeneous token amounts in a single integer. This has specific implications:

1. **The cap is economically meaningless across different tokens.** 50 trillion stroops of USDC ≈ $50M. 50 trillion stroops of an illiquid meme token ≈ effectively nothing. The contract treats them as equivalent.

2. **Per-token volume tracking must be done off-chain.** The `charged` and `pay_per_use` events include the token address (via the subscription's `token` field at charge time), so indexers can reconstruct per-token totals by filtering events.

3. **The cap override (`set_global_volume_cap`) is stored but not enforced.** The `check_and_update_global_volume` function hardcodes `GLOBAL_MAX_VOLUME_PER_HOUR` rather than reading the override. This is a known gap — the override value is stored under `DataKey::GlobalVolumeCapOverride` but has no effect on enforcement.

### Per-token fee transfer semantics

For accountants reconciling fee income:

- **Each fee transfer is a separate `transfer_from` call** against the subscription's token contract. There is no batched or netted transfer.
- **The fee collector receives separate balances per token.** If a merchant accepts USDC and XLM subscriptions, the fee collector's USDC balance increases by USDC fees and their XLM balance increases by XLM fees — these are independent on-chain operations.
- **`TotalProtocolFees` is a cross-token integer sum** stored in instance storage. It is only meaningful if all subscriptions use the same token. For multi-token deployments, reconstruct per-token fee totals from events.
- **Merchant revenue counters (`MerchantRevenue`, `MerchantRevenueDay`) are also cross-token integer sums.** Same limitation — only meaningful for single-token deployments.

### Implications for auditors and accountants

| What you need                  | Where to get it                                                                         | What to watch out for                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Per-token fee income           | Filter `charged` events by token address; sum `fee` field per token                     | `TotalProtocolFees` on-chain counter mixes tokens — do not use for multi-token deployments  |
| Per-token merchant revenue     | Filter `charged` events by (merchant, token); sum `net` field                           | `MerchantRevenue` on-chain counter mixes tokens — do not use for multi-token deployments    |
| Global volume (per-token)      | Filter `charged`/`pay_per_use` events by token; sum `amount`/`gross` per token per hour | `GlobalVolumeWindow` on-chain counter mixes tokens — do not use for cross-token comparisons |
| Daily spend per user per token | Filter `pay_per_use` events by (user, token) per day                                    | `DailySpent` on-chain counter mixes tokens — do not use for multi-token daily limits        |

### Volume and fee API references

| Function                         | Location            | Purpose                                          |
| -------------------------------- | ------------------- | ------------------------------------------------ |
| `check_and_update_global_volume` | `lib.rs`            | Enforce hourly volume cap (cross-token)          |
| `get_global_volume_window`       | `lib.rs`            | Read current window start and accumulated volume |
| `calculate_fee_amount`           | `fee.rs`            | Compute fee from amount and basis points         |
| `transfer_subscription_charge`   | `fee.rs`            | Fee-aware transfer for recurring charges         |
| `transfer_pay_per_use`           | `fee.rs`            | Fee-aware transfer for one-time charges          |
| `accumulate_protocol_fees`       | `fee.rs`            | Add fee to cumulative total (cross-token sum)    |
| `get_total_protocol_fees`        | `fee.rs`            | Read cumulative fee total                        |
| `increment_revenue_with_daily`   | `merchant_stats.rs` | Update merchant revenue (cross-token sum)        |

---

## Switching Tokens

There is no dedicated "change my subscription's token" entry point. A subscriber switches tokens by calling `subscribe()` (or `subscribe_with_metadata()`) again with a different `token` argument. `subscribe_inner` treats this as a full overwrite of the stored `Subscription` record:

```rust
let existing = storage::get_subscription(env, &user);
let should_increment = existing.as_ref().is_none_or(|s| !s.active);
// ... existing record, including its old `token`, is replaced entirely
```

Practical implications:

1. **All fields reset, not just `token`.** You must resupply `merchant`, `amount`, `interval`, `trial_period`, and `referrer` (referral is actually preserved separately via `DataKey::Referral`, immutable after first write — see the [lifecycle spec](./spec/lifecycle_spec.md#referral-data) — but `amount`/`interval`/`trial_period` are not carried over from the old record). There's no partial "just update the token" call.
2. **A new allowance is required.** The subscriber must call `approve()` on the _new_ token contract before the new `subscribe()` call, or it fails with `ContractError::InsufficientAllowance`. The allowance previously granted on the _old_ token is untouched by this call — it isn't revoked automatically. If you want to stop the contract from being able to pull the old token, the subscriber should separately reduce that allowance to zero on the old token contract.
3. **Charge history and cancellation state are token-agnostic and persist.** `ChargeHistory(user)` and `SubscriptionMeta(user)` are keyed by user address, not by token, so switching tokens does not reset or fork your charge history — old charges recorded in the old token remain in the same paged history alongside new charges in the new token, with no field distinguishing which token each timestamp was charged in. If you need per-token charge auditing, reconstruct it off-chain from `charged` events (which do include `sub.token` implicitly via the subscription state at charge time) rather than from `get_charge_history_page`.
4. **`active_count` is not double-counted.** Because the subscriber already had an active subscription, `should_increment` evaluates to `false`, so switching tokens does not inflate `ActiveCount`.

### Example: switching from USDC to XLM

```bash
# 1. Approve the new token
soroban contract invoke \
  --id $XLM_TOKEN_ADDRESS --source user --network testnet \
  -- approve --from $USER_ADDRESS --spender $PAYFLOW_CONTRACT_ADDRESS \
  --amount 50000000 --expiration_ledger 999999999

# 2. Re-subscribe with the new token (overwrites the USDC subscription)
soroban contract invoke \
  --id $PAYFLOW_CONTRACT_ADDRESS --source user --network testnet \
  -- subscribe --user $USER_ADDRESS --merchant $MERCHANT_ADDRESS \
  --amount 5000000 --interval 2592000 --token $XLM_TOKEN_ADDRESS \
  --trial_period null --referrer null
```

---

## Pay-Per-Use and Tokens

`pay_per_use(user, amount)` and `pay_per_use_to(user, amount, recipient)` never take a token argument. Both read `sub.token` from the caller's existing subscription and charge through that same token:

```rust
let fee_amount = fee::transfer_pay_per_use(env, &user, &sub.token, amount, &recipient);
```

There is no way to make a one-off `pay_per_use` payment in a token different from your active subscription's token — if you need that, the subscriber has to switch their subscription's token first (see above), or you deploy a separate FlowPay instance for that token (Model B). A subscriber with **no** active subscription cannot call `pay_per_use` at all — it requires an existing `Subscription` record purely to know which token and merchant to use, even though it is billed as a one-time charge.

---

## Known Limitations

PayFlow's multi-token support is **per-subscription token selection**, not a multi-token AMM or payment router. Concretely, it does **not**:

- **Convert or swap between tokens.** There is no price oracle, no liquidity pool, and no exchange-rate logic anywhere in the contract. A merchant configured with `amount = 100` receives exactly 100 units of whatever token each subscriber picked — 100 USDC from one subscriber and 100 of an illiquid reward token from another are treated identically by the contract, with wildly different real value.
- **Aggregate revenue across tokens.** `merchant_stats.rs` (`MerchantRevenue`, `MerchantRevenueDay`, `MerchantRevenueHistory`) stores plain `i128` sums with no token dimension. If a merchant accepts both USDC and XLM, their on-chain revenue counters silently mix unit-incompatible integers. See [Volume Accounting and Fee Semantics for Accountants](#volume-accounting-and-fee-semantics-for-accountants) for worked examples and the recommended approach for per-token reconciliation.
- **Aggregate global volume in a meaningful cross-token way.** `GlobalVolumeWindow` sums stroop amounts from all tokens into a single `i128`. The 50 trillion stroop cap compares economically heterogeneous values. Per-token volume must be reconstructed from events off-chain.
- **Enforce that `token` is a real SAC.** As noted in [Token address validation](#token-address-validation), the only on-chain check is an address-shape check, not an interface check.
- **Let one payment satisfy multiple tokens' worth of fee.** The fee bps is applied once, in the charge's own token, full stop.
- **Support per-token fee rates or per-token fee collectors** within a single instance — see [Fee Implications](#fee-implications).
- **Migrate a subscription's charge history between tokens** as a distinguishable record — see point 3 under [Switching Tokens](#switching-tokens).

If a true multi-token AMM (with conversion, pooled liquidity, or a single "quote currency" abstraction) is required, it would need to be built as a new layer on top of PayFlow — e.g., a swap step before `transfer_from`, or an oracle-driven amount computed off-chain and passed as `amount` at charge time — not something the current contract does natively.

---

## Subscribing with Custom Tokens

PayFlow supports custom SAC tokens natively. When creating a subscription, specify the token address in the `token` parameter of `subscribe()`:

### Key Points

- Each subscription uses its own token (stored in the `Subscription` struct — see [Architecture](#architecture-per-subscription-tokens)).
- The `initialize()` function sets a default token, but as explained above it is informational only; any valid SAC token address can be used for an individual subscription.
- The token must be a valid SAC contract address (not a classic Stellar asset issuer/asset-code pair) — see [Token address validation](#token-address-validation).

---

## Allowance Setup

Before subscribing with a custom token, the user must first approve an allowance for the PayFlow contract on that token. This allows PayFlow to transfer tokens from the user's account to the merchant and fee collector.

### Approving Allowance via CLI

```bash
soroban contract invoke \
  --id YOUR_TOKEN_ADDRESS \
  --source YOUR_USER_KEY \
  --network testnet \
  -- approve \
  --from YOUR_USER_ADDRESS \
  --spender PAYFLOW_CONTRACT_ADDRESS \
  --amount YOUR_SUBSCRIPTION_AMOUNT \
  --expiration_ledger 999999999
```

---

## Full CLI Walkthrough

Here's a complete end-to-end example of using a custom SAC token with PayFlow (Deployment Model A: single instance).

### 1. Deploy PayFlow Contract (if not already deployed)

```bash
soroban contract deploy \
  --wasm path/to/payflow.wasm \
  --source deployer \
  --network testnet
```

### 2. Initialize PayFlow

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source deployer \
  --network testnet \
  -- initialize \
  --token DEFAULT_SAC_TOKEN_ADDRESS \
  --admin ADMIN_ADDRESS
```

### 3. Deploy (or Identify) a Custom SAC Token

```bash
TOKEN_ADDRESS=$(soroban contract deploy \
  --wasm path/to/soroban_token_contract.wasm \
  --source token-admin \
  --network testnet)
```

### 4. Mint Tokens to User

```bash
soroban contract invoke \
  --id $TOKEN_ADDRESS \
  --source token-admin \
  --network testnet \
  -- mint \
  --to USER_ADDRESS \
  --amount 1000000000
```

### 5. Approve Allowance

```bash
soroban contract invoke \
  --id $TOKEN_ADDRESS \
  --source user \
  --network testnet \
  -- approve \
  --from USER_ADDRESS \
  --spender PAYFLOW_CONTRACT_ADDRESS \
  --amount 50000000 \
  --expiration_ledger 999999999
```

### 6. Add Merchant to Whitelist (if enabled)

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source admin \
  --network testnet \
  -- add_merchant \
  --merchant MERCHANT_ADDRESS
```

### 7. Subscribe with the Custom Token

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source user \
  --network testnet \
  -- subscribe \
  --user USER_ADDRESS \
  --merchant MERCHANT_ADDRESS \
  --amount 5000000 \
  --interval 2592000 \
  --token $TOKEN_ADDRESS \
  --trial_period null \
  --referrer null
```

### 8. Charge the Subscription

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source keeper \
  --network testnet \
  -- charge \
  --user USER_ADDRESS
```

### TypeScript: subscribing with an explicit token

```typescript
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { server, CONTRACT_ID, NETWORK_PASSPHRASE } from "./stellar";

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

/** Subscribes `user` to `merchant`, paying in `tokenAddress` instead of the default token. */
async function subscribeWithToken(
  user: string,
  merchant: string,
  amountStroops: bigint,
  intervalSeconds: number,
  tokenAddress: string,
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(user);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "subscribe",
        addressVal(user),
        addressVal(merchant),
        nativeToScVal(amountStroops, { type: "i128" }),
        nativeToScVal(intervalSeconds, { type: "u64" }),
        addressVal(tokenAddress), // per-subscription token — see Architecture above
        nativeToScVal(null, { type: "option" }), // trial_period: None
        nativeToScVal(null, { type: "option" }), // referrer: None
      ),
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) throw new Error(sim.error);

  return tx.toXDR(); // sign and submit with the user's wallet
}
```

---

## Notes

- All amounts are in stroops (the smallest unit of whichever token is in use — decimal precision is defined by that token's contract, typically 7 for SAC-wrapped classic assets).
- The protocol fee, if enabled, is always charged in the same token as the subscription it's deducted from (see [Fee Implications](#fee-implications)).
- A single user address can hold multiple independent subscriptions to different merchants, each with its own token — the one-subscription-per-user limit is per `(user)` key, so a second `subscribe()` call to a _different_ merchant while the first is still active is what [Switching Tokens](#switching-tokens) describes; PayFlow does not key subscriptions by `(user, merchant)`, so there is exactly one active `Subscription` slot per user at a time.
- The token address must be a valid SAC contract, not a classic Stellar asset issuer/asset-code pair (see [Token address validation](#token-address-validation)).
