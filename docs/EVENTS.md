# Events Reference

This document provides a complete reference for all events emitted by the FlowPay smart contract. Events are grouped by functional area for easy navigation.

> **Building on these events?** This file is the payload/schema reference. For polling Soroban RPC, deduplication, reaction patterns (keeper / analytics / notifications / reconciliation), ordering, and reliability, see the companion cookbook: [`docs/EVENT-DRIVEN-GUIDE.md`](EVENT-DRIVEN-GUIDE.md). Reference scripts: [`scripts/watch-events.ts`](../scripts/watch-events.ts), [`scripts/replay-events.ts`](../scripts/replay-events.ts).

---

## Table of Contents

- [Subscription Events](#subscription-events)
- [Charge & Payment Events](#charge--payment-events)
- [Admin Events](#admin-events)
- [Fee Events](#fee-events)
- [Merchant Events](#merchant-events)
- [Daily Limit Events](#daily-limit-events)
- [Grace Period Events](#grace-period-events)
- [Related Documentation](#related-documentation)

---

## Subscription Events

Events related to subscription lifecycle.

### subscribed
- **Trigger**: `subscribe()`
- **Topic keys**: `["subscribed", user_address]`
- **Payload schema**: `(merchant: Address, amount: i128, interval: u64)`
- **JSON example**:
  ```json
  {
    "topic": ["subscribed", "GABC...XYZ"],
    "data": ["GDEF...ABC", 50000000, 2592000]
  }
  ```

### paused
- **Trigger**: `pause()`
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
- **Payload schema**: `()`
- **JSON example**:
  ```json
  {
    "topic": ["cancelled", "GABC...XYZ"],
    "data": []
  }
  ```

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

### subscription_transferred
- **Trigger**: `transfer_subscription()`
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
    charged_at: u64
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
      "charged_at": 1719388800
    }
  }
  ```

### pay_per_use
- **Trigger**: `pay_per_use()`
- **Topic keys**: `["pay_per_use", user_address]`
- **Payload schema**: `(merchant: Address, amount: i128)`
- **JSON example**:
  ```json
  {
    "topic": ["pay_per_use", "GABC...XYZ"],
    "data": ["GDEF...ABC", 1000000]
  }
  ```

---

## Admin Events

Events related to admin operations.

### contract_paused
- **Trigger**: Admin pauses the contract
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
- **Trigger**: Admin unpauses the contract
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
- **Trigger**: Admin transfers ownership
- **Topic keys**: `["admin_transferred"]`
- **Payload schema**: `(old_admin: Address, new_admin: Address)`
- **JSON example**:
  ```json
  {
    "topic": ["admin_transferred"],
    "data": ["GOLD...ADMIN", "GNEW...ADMIN"]
  }
  ```

### upgraded
- **Trigger**: Contract is upgraded
- **Topic keys**: `["upgraded"]`
- **Payload schema**: `new_wasm_hash: BytesN<32>`
- **JSON example**:
  ```json
  {
    "topic": ["upgraded"],
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
- **Trigger**: Propose a new fee (two-step commit)
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
- **Trigger**: Commit a proposed fee
- **Topic keys**: `["fee_committed"]`
- **Payload schema**: `(collector: Address, bps: u32)`
- **JSON example**:
  ```json
  {
    "topic": ["fee_committed"],
    "data": ["GFEE...COLL", 100]
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
- **Trigger**: Merchant withdraws revenue
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
- **Trigger**: Remove daily limit (e.g., set to 0 or via specific function)
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
- **Trigger**: Propose a new grace period (two-step commit)
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
- **Trigger**: Commit a proposed grace period
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

## Related Documentation

| Doc | Role |
| --- | --- |
| [`docs/EVENT-DRIVEN-GUIDE.md`](EVENT-DRIVEN-GUIDE.md) | Cookbook: consume events reliably, react, dedupe, detect gaps |
| [`docs/KEEPER.md`](KEEPER.md) | Keeper operations (primary producer/consumer of charge cycles) |
| [`docs/INTEGRATION-GUIDE.md`](INTEGRATION-GUIDE.md) | Third-party app integration (transactions + reads) |
| [`docs/API.md`](API.md) | Contract function surface |
| [`scripts/watch-events.ts`](../scripts/watch-events.ts) | Live poller reference implementation |
| [`scripts/replay-events.ts`](../scripts/replay-events.ts) | Historical range replay with upsert semantics |
|