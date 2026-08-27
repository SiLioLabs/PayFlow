# Events Reference

This document provides a complete reference for all events emitted by the FlowPay smart contract. Events are grouped by functional area for easy navigation.

> **Building on these events?** This file is the payload/schema reference. For polling Soroban RPC, deduplication, reaction patterns (keeper / analytics / notifications / reconciliation), ordering, and reliability, see the companion cookbook: [`docs/EVENT-DRIVEN-GUIDE.md`](EVENT-DRIVEN-GUIDE.md). Reference scripts: [`scripts/watch-events.ts`](../scripts/watch-events.ts), [`scripts/replay-events.ts`](../scripts/replay-events.ts).

> **Catalog version:** Synchronized with `contract/src/events.rs` as of 2026-08-27. All 40 `publish_*` helpers are documented below.

---

## Table of Contents

- [Subscription Lifecycle Events](#subscription-lifecycle-events)
- [Charge & Payment Events](#charge--payment-events)
- [Subscription Config Events](#subscription-config-events)
- [Admin Events](#admin-events)
- [Fee Events](#fee-events)
- [Merchant Events](#merchant-events)
- [Daily Limit Events](#daily-limit-events)
- [Grace Period Events](#grace-period-events)
- [Referral Events](#referral-events)
- [Migration & Infrastructure Events](#migration--infrastructure-events)
- [Related Documentation](#related-documentation)

---

## Subscription Lifecycle Events

Events related to subscription lifecycle transitions.

### subscribed
- **Trigger**: `subscribe()` or `subscribe_with_metadata()`
- **Topic keys**: `["subscribed", user_address]`
- **Payload schema**:
  ```rust
  {
    merchant: Address,
    amount: i128,
    interval: u64,
    ledger_sequence: u32
  }
  ```
- **JSON example**:
  ```json
  {
    "topic": ["subscribed", "GABC...XYZ"],
    "data": {
      "merchant": "GDEF...ABC",
      "amount": 50000000,
      "interval": 2592000,
      "ledger_sequence": 12345
    }
  }
  ```

### paused
- **Trigger**: `pause()` (user-initiated)
- **Topic keys**: `["paused", user_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["paused", "GABC...XYZ"],
    "data": []
  }
  ```

### resumed
- **Trigger**: `resume()`
- **Topic keys**: `["resumed", user_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["resumed", "GABC...XYZ"],
    "data": []
  }
  ```

### cancelled
- **Trigger**: `cancel()`
- **Topic keys**: `["cancelled", user_address]`
- **Payload schema**:
  ```rust
  {
    ledger_sequence: u32
  }
  ```
- **JSON example**:
  ```json
  {
    "topic": ["cancelled", "GABC...XYZ"],
    "data": {
      "ledger_sequence": 12345
    }
  }
  ```

### cancelled_with_refund
- **Trigger**: `cancel_and_refund_prorated()`
- **Topic keys**: `["cancelled_with_refund", user_address]`
- **Payload schema**:
  ```rust
  {
    refund_amount: i128,
    ledger_sequence: u32
  }
  ```
- **JSON example**:
  ```json
  {
    "topic": ["cancelled_with_refund", "GABC...XYZ"],
    "data": {
      "refund_amount": 25000000,
      "ledger_sequence": 12345
    }
  }
  ```

### subscription_paused
- **Trigger**: `batch_pause_subscriptions()` (admin batch operation)
- **Topic keys**: `["subscription_paused", user_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["subscription_paused", "GABC...XYZ"],
    "data": []
  }
  ```

### subscription_auto_resumed
- **Trigger**: `charge()` or `batch_charge()` when `pause_until` expiry has passed
- **Topic keys**: `["subscription_auto_resumed", user_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["subscription_auto_resumed", "GABC...XYZ"],
    "data": []
  }
  ```

### trial_extended
- **Trigger**: `extend_trial()`
- **Topic keys**: `["trial_extended", user_address]`
- **Payload schema**:
  ```rust
  {
    additional_seconds: u64,
    new_last_charged: u64,
    ledger_sequence: u32
  }
  ```
- **JSON example**:
  ```json
  {
    "topic": ["trial_extended", "GABC...XYZ"],
    "data": {
      "additional_seconds": 604800,
      "new_last_charged": 1719388800,
      "ledger_sequence": 12345
    }
  }
  ```

---

## Charge & Payment Events

Events related to charges and payments.

### charged
- **Trigger**: `charge()` or `batch_charge()`
- **Topic keys**: `["charged", user_address]`
- **Payload schema**:
  ```rust
  {
    merchant: Address,
    gross: i128,
    fee: i128,
    net: i128,
    charged_at: u64,
    ledger_sequence: u32
  }
  ```
- **JSON example**:
  ```json
  {
    "topic": ["charged", "GABC...XYZ"],
    "data": {
      "merchant": "GDEF...ABC",
      "gross": 50000000,
      "fee": 500000,
      "net": 49500000,
      "charged_at": 1719388800,
      "ledger_sequence": 12345
    }
  }
  ```

### batch_charge_skips
- **Trigger**: `batch_charge()` — **only** when the batch contained at least one *interesting* non-success outcome (`NoSubscription`, `Inactive`, `Paused`, `GracePeriodElapsed`, `AllowanceInsufficient`). An all-charged or all-not-due batch emits nothing.
- **Topic keys**: `["batch_charge_skips"]` — batch-level, so there is **no address topic**
- **Payload schema**:
  ```rust
  {
    total: u32,            // addresses submitted
    charged: u32,          // ChargeResult::Charged
    not_due: u32,          // ChargeResult::Skipped (interval not elapsed)
    no_subscription: u32,  // ChargeResult::NoSubscription
    inactive: u32,         // ChargeResult::Inactive
    paused: u32,           // ChargeResult::Paused
    grace_elapsed: u32,    // ChargeResult::GracePeriodElapsed
    allowance_insufficient: u32, // ChargeResult::AllowanceInsufficient
    ledger_sequence: u32
  }
  ```
- **JSON example**:
  ```json
  {
    "topic": ["batch_charge_skips"],
    "data": {
      "total": 5,
      "charged": 1,
      "not_due": 0,
      "no_subscription": 1,
      "inactive": 1,
      "paused": 1,
      "grace_elapsed": 1,
      "allowance_insufficient": 0,
      "ledger_sequence": 12345
    }
  }
  ```

**Parser note for indexers**

- `charged` is **unchanged**; this event is purely additive. Consumers that ignore unknown event names keep working.
- The topic tuple has length 1. Parsers that assume `topic[1]` is a subscriber address (as [`scripts/indexer.ts`](../scripts/indexer.ts) does) will store an empty `address` for this row — that is correct, not a parse failure. Do not drop the event for a missing `topic[1]`.
- Counts reconcile: `charged + not_due + no_subscription + inactive + paused + grace_elapsed + allowance_insufficient == total`. Use this to detect a truncated or mis-decoded payload.
- **Per-user attribution is deliberately not in the event.** One summary per batch keeps event fees and ledger footprint flat in batch size, rather than growing one event per skipped address. To identify *which* subscribers were skipped, read the `batch_charge` return value, or call `get_batch_charge_estimate(users)` — it returns the same per-address `ChargeResult` vector without mutating state.
- **`allowance_insufficient` is the alerting count.** `batch_charge` tolerates a subscriber whose allowance is below the gross amount: it records `ChargeResult::AllowanceInsufficient` for that address and continues the batch (no funds move, the subscription stays active). Those subscribers keep failing every cycle until they re-approve, so a non-zero count here is the signal to notify them. Outside `batch_charge` — single `charge()` and `pay_per_use*()` — an insufficient allowance still aborts the invocation with error `8 InsufficientAllowance` and emits nothing.
- **Instruction impact:** measured on an 11-address batch (10 charged, 1 skipped): **+39,515 CPU instructions and +13,262 memory bytes** versus the same batch without the event — a flat per-batch cost, paid only when the event actually fires.

### pay_per_use
- **Trigger**: `pay_per_use()` or `pay_per_use_to()`
- **Topic keys**: `["pay_per_use", user_address]`
- **Payload schema**:
  ```rust
  {
    merchant: Address,
    amount: i128,
    ledger_sequence: u32
  }
  ```
- **JSON example**:
  ```json
  {
    "topic": ["pay_per_use", "GABC...XYZ"],
    "data": {
      "merchant": "GDEF...ABC",
      "amount": 1000000,
      "ledger_sequence": 12345
    }
  }
  ```

### daily_window_started
- **Trigger**: Daily spending window reset in `spending_limit.rs`
- **Topic keys**: `["daily_window_started", user_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["daily_window_started", "GABC...XYZ"],
    "data": []
  }
  ```

---

## Subscription Config Events

Events related to subscription configuration changes.

### sub_amount_updated
- **Trigger**: `set_subscription_amount()`
- **Topic keys**: `["sub_amount_updated", user_address]`
- **Payload schema**: `(old_amount: i128, new_amount: i128)`
- **JSON example**:
  ```json
  {
    "topic": ["sub_amount_updated", "GABC...XYZ"],
    "data": [50000000, 75000000]
  }
  ```

### sub_interval_updated
- **Trigger**: `set_subscription_interval()`
- **Topic keys**: `["sub_interval_updated", user_address]`
- **Payload schema**: `(old_interval: u64, new_interval: u64)`
- **JSON example**:
  ```json
  {
    "topic": ["sub_interval_updated", "GABC...XYZ"],
    "data": [2592000, 1814400]
  }
  ```

### sub_transferred
- **Trigger**: `transfer_subscription()` (legacy event)
- **Topic keys**: `["sub_transferred", old_user_address]`
- **Payload schema**: `new_user: Address`
- **JSON example**:
  ```json
  {
    "topic": ["sub_transferred", "GOLD...USER"],
    "data": "GNEW...USER"
  }
  ```

### subscription_transferred
- **Trigger**: `transfer_subscription()` (new event, emitted alongside `sub_transferred`)
- **Topic keys**: `["subscription_transferred", from_address, to_address]`
- **Payload schema**: `(merchant: Address, amount: i128, interval: u64, token: Address)`
- **JSON example**:
  ```json
  {
    "topic": ["subscription_transferred", "GFROM...XYZ", "GTO...ABC"],
    "data": ["GMERCH...DEF", 50000000, 2592000, "GTOKEN...GHI"]
  }
  ```

---

## Admin Events

Events related to admin operations.

### contract_paused
- **Trigger**: Admin pauses the contract globally
- **Topic keys**: `["contract_paused"]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["contract_paused"],
    "data": []
  }
  ```

### contract_unpaused
- **Trigger**: Admin unpauses the contract globally
- **Topic keys**: `["contract_unpaused"]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["contract_unpaused"],
    "data": []
  }
  ```

### admin_transferred
- **Trigger**: Two-step admin transfer completed (`accept_admin()`)
- **Topic keys**: `["admin_transferred"]`
- **Payload schema**: `(old_admin: Address, new_admin: Address)`
- **JSON example**:
  ```json
  {
    "topic": ["admin_transferred"],
    "data": ["GOLD...ADMIN", "GNEW...ADMIN"]
  }
  ```

### upgrade
- **Trigger**: Contract WASM upgraded (`commit_upgrade()`)
- **Topic keys**: `["upgrade"]`
- **Payload schema**: `()` — note: the `new_wasm_hash` parameter is accepted but **not** emitted in the event data
- **JSON example**:
  ```json
  {
    "topic": ["upgrade"],
    "data": []
  }
  ```

### upg_proposed
- **Trigger**: WASM upgrade proposed (`propose_upgrade()`)
- **Topic keys**: `["upg_proposed"]`
- **Payload schema**: `new_wasm_hash: BytesN<32>`
- **JSON example**:
  ```json
  {
    "topic": ["upg_proposed"],
    "data": "0xabcdef123456..."
  }
  ```

### min_interval_set
- **Trigger**: `set_min_interval()`
- **Topic keys**: `["min_interval_set"]`
- **Payload schema**:
  ```rust
  {
    old: u64,
    new: u64
  }
  ```
- **JSON example**:
  ```json
  {
    "topic": ["min_interval_set"],
    "data": {
      "old": 3600,
      "new": 86400
    }
  }
  ```

### merch_hist_cleared
- **Trigger**: `clear_merchant_revenue_history()`
- **Topic keys**: `["merch_hist_cleared"]`
- **Payload schema**: `merchant: Address`
- **JSON example**:
  ```json
  {
    "topic": ["merch_hist_cleared"],
    "data": "GDEF...ABC"
  }
  ```

---

## Fee Events

Events related to protocol fee configuration.

### fee_proposed
- **Trigger**: `propose_fee()` (two-step commit)
- **Topic keys**: `["fee_proposed"]`
- **Payload schema**: `(collector: Address, bps: u32)`
- **JSON example**:
  ```json
  {
    "topic": ["fee_proposed"],
    "data": ["GFEE...COLL", 100]
  }
  ```

### fee_committed
- **Trigger**: `commit_fee()` (two-step commit)
- **Topic keys**: `["fee_committed"]`
- **Payload schema**: `(collector: Address, bps: u32)`
- **JSON example**:
  ```json
  {
    "topic": ["fee_committed"],
    "data": ["GFEE...COLL", 100]
  }
  ```

### fee_cleared
- **Trigger**: `clear_fee()`
- **Topic keys**: `["fee_cleared"]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["fee_cleared"],
    "data": []
  }
  ```

### merchant_fee_recipient_set
- **Trigger**: `set_merchant_fee_recipient()`
- **Topic keys**: `["merchant_fee_recipient_set", merchant_address]`
- **Payload schema**: `recipient: Address`
- **JSON example**:
  ```json
  {
    "topic": ["merchant_fee_recipient_set", "GMERCH...ABC"],
    "data": "GFEE...RECV"
  }
  ```

---

## Merchant Events

Events related to merchant management.

### merchant_added
- **Trigger**: `add_merchant()`
- **Topic keys**: `["merchant_added", merchant_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["merchant_added", "GDEF...ABC"],
    "data": []
  }
  ```

### merchant_removed
- **Trigger**: `remove_merchant()`
- **Topic keys**: `["merchant_removed", merchant_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["merchant_removed", "GDEF...ABC"],
    "data": []
  }
  ```

### merchant_frozen
- **Trigger**: `freeze_merchant()`
- **Topic keys**: `["merchant_frozen", merchant_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["merchant_frozen", "GDEF...ABC"],
    "data": []
  }
  ```

### merchant_unfrozen
- **Trigger**: `unfreeze_merchant()`
- **Topic keys**: `["merchant_unfrozen", merchant_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["merchant_unfrozen", "GDEF...ABC"],
    "data": []
  }
  ```

### merchant_withdrawal
- **Trigger**: `withdraw_merchant_revenue()`
- **Topic keys**: `["merchant_withdrawal", merchant_address]`
- **Payload schema**: `amount: i128`
- **JSON example**:
  ```json
  {
    "topic": ["merchant_withdrawal", "GDEF...ABC"],
    "data": 1000000000
  }
  ```

---

## Daily Limit Events

Events related to user daily limit configuration.

### daily_limit_set
- **Trigger**: `set_daily_limit()`
- **Topic keys**: `["daily_limit_set", user_address]`
- **Payload schema**: `limit: i128`
- **JSON example**:
  ```json
  {
    "topic": ["daily_limit_set", "GABC...XYZ"],
    "data": 50000000
  }
  ```

### daily_limit_removed
- **Trigger**: `remove_daily_limit()`
- **Topic keys**: `["daily_limit_removed", user_address]`
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["daily_limit_removed", "GABC...XYZ"],
    "data": []
  }
  ```

---

## Grace Period Events

Events related to grace period configuration.

### grace_period_proposed
- **Trigger**: `propose_grace_period()` (two-step commit)
- **Topic keys**: `["grace_period_proposed"]`
- **Payload schema**: `seconds: u64`
- **JSON example**:
  ```json
  {
    "topic": ["grace_period_proposed"],
    "data": 86400
  }
  ```

### grace_period_committed
- **Trigger**: `commit_grace_period()` (two-step commit)
- **Topic keys**: `["grace_period_committed"]`
- **Payload schema**: `seconds: u64`
- **JSON example**:
  ```json
  {
    "topic": ["grace_period_committed"],
    "data": 86400
  }
  ```

---

## Referral Events

Events related to referral tracking.

### referred
- **Trigger**: `subscribe()` (when referrer is provided)
- **Topic keys**: `["referred", user_address]`
- **Payload schema**: `referrer: Address`
- **JSON example**:
  ```json
  {
    "topic": ["referred", "GABC...XYZ"],
    "data": "GDEF...ABC"
  }
  ```

See the canonical referral guide: [`REFERRALS.md`](./REFERRALS.md#referred-event).

---

## Migration & Infrastructure Events

Events related to contract migration and infrastructure operations.

### migration_completed
- **Trigger**: `migrate()` (schema migration)
- **Topic keys**: `["migration_completed"]`
- **Payload schema**: `(version: u32, user_count: u32)`
- **JSON example**:
  ```json
  {
    "topic": ["migration_completed"],
    "data": [3, 150]
  }
  ```

### subscriber_index_ttl_extended
- **Trigger**: `extend_subscriber_index_ttl()` (admin TTL refresh)
- **Topic keys**: `["subscriber_index_ttl_extended"]`
- **Payload schema**: `count: u64`
- **JSON example**:
  ```json
  {
    "topic": ["subscriber_index_ttl_extended"],
    "data": 150
  }
  ```

### subscriber_index_cleared
- **Trigger**: `clear_subscriber_index_entry()` (admin repair of a stale index slot)
- **Topic keys**: `["subscriber_index_cleared", user_address]`
- **Payload schema**: `index: u64`
- **JSON example**:
  ```json
  {
    "topic": ["subscriber_index_cleared", "GABC...XYZ"],
    "data": 42
  }
  ```

---

## Related Documentation

| Doc | Role |
| --- | --- |
| [`docs/EVENT-DRIVEN-GUIDE.md`](EVENT-DRIVEN-GUIDE.md) | Cookbook: consume events reliably, react, dedupe, detect gaps |
| [`docs/KEEPER.md`](KEEPER.md) | Keeper operations (primary producer/consumer of charge cycles) |
| [`docs/INTEGRATION-GUIDE.md`](INTEGRATION-GUIDE.md) | Third-party app integration (transactions + reads) |
| [`docs/API.md`](API.md) | Contract function surface |
| [`scripts/watch-events.ts`](../scripts/watch-events.ts) | Live poller reference implementation |
| [`scripts/replay-events.ts`](../scripts/replay-events.ts) | Historical range replay with upsert semantics |
