# Subscription Lifecycle State Specification

**Document Version:** 1.0  
**Contract Version:** 2.x  
**Last Updated:** 2026-06-25

---

## Overview

This document defines the formal state transition model for subscription lifecycle management in the FlowPay contract. It serves as the canonical reference for all valid subscription states and the precise conditions under which transitions occur.

---

## Core Subscription State Model

### Data Structure

```rust
pub struct Subscription {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub last_charged: u64,
    pub active: bool,
    pub paused: bool,
    pub token: Address,
}
```

### State Dimensions

A subscription exists in a multi-dimensional state space defined by:

1. **Existence**: `Some(Subscription)` or `None`
2. **Activity**: `active: bool`
3. **Pause**: `paused: bool`
4. **Trial Status**: Derived from `last_charged` vs current timestamp
5. **Charge Eligibility**: Derived from `last_charged + interval` vs current timestamp
6. **Grace Period Status**: Derived from `last_charged + interval + grace_period` vs current timestamp

---

## State Definitions

### 1. Nonexistent

**Storage Condition:**
```rust
env.storage().persistent().get(&DataKey::Subscription(user)) == None
```

**Characteristics:**
- No subscription data exists for the user
- Cannot be charged
- Cannot be cancelled
- Can be created via `subscribe()` or `subscribe_with_metadata()`

**Valid Transitions:**
- → **Active (Standard)** via `subscribe()` or `subscribe_with_metadata()`
- → **Active (Trial)** via `subscribe()` or `subscribe_with_metadata()` with `trial_period: Some(u64)`

---

### 2. Active (Standard)

**Storage Condition:**
```rust
Subscription {
    active: true,
    paused: false,
    last_charged: now,  // where now = env.ledger().timestamp() at subscribe time
    ..
}
```

**Characteristics:**
- Fully operational subscription
- `last_charged` equals subscription creation timestamp
- Eligible for charge when `current_time >= last_charged + interval`
- No trial period active

**Valid Transitions:**
- → **Active (Chargeable)** when `current_time >= last_charged + interval`
- → **Paused** via `pause()`
- → **Cancelled** via `cancel()`
- → **Active (Standard)** via `subscribe()` (overwrites existing subscription)

**Operations Allowed:**
- `pay_per_use()`: ✅
- `charge()`: ❌ (IntervalNotElapsed until chargeable)
- `pause()`: ✅
- `cancel()`: ✅

---

### 3. Active (Trial)

**Storage Condition:**
```rust
Subscription {
    active: true,
    paused: false,
    last_charged: now + trial_period,  // future timestamp
    ..
}
```

**Characteristics:**
- Subscription is active but billing is deferred
- `last_charged` is set to a future timestamp (`subscribe_time + trial_period`)
- User can use `pay_per_use()` immediately
- Cannot be charged until trial expires

**Valid Transitions:**
- → **Active (Standard)** when `current_time >= last_charged` (trial expires)
- → **Active (Chargeable)** when `current_time >= last_charged + interval` (trial expires + interval elapses)
- → **Paused** via `pause()`
- → **Cancelled** via `cancel()`

**Operations Allowed:**
- `pay_per_use()`: ✅
- `charge()`: ❌ (IntervalNotElapsed until trial expires)
- `pause()`: ✅
- `cancel()`: ✅

---

### 4. Active (Chargeable)

**Storage Condition:**
```rust
Subscription {
    active: true,
    paused: false,
    last_charged: T,
}
where current_time >= T + interval
```

**Characteristics:**
- Billing interval has elapsed
- Eligible for immediate charge
- Still within grace period (if configured)

**Valid Transitions:**
- → **Active (Standard)** via `charge()` (resets `last_charged` to current timestamp)
- → **Active (Grace Expired)** when `current_time > last_charged + interval + grace_period` (if grace period > 0)
- → **Paused** via `pause()`
- → **Cancelled** via `cancel()`

**Operations Allowed:**
- `pay_per_use()`: ✅
- `charge()`: ✅
- `pause()`: ✅
- `cancel()`: ✅

---

### 5. Active (Grace Expired)

**Storage Condition:**
```rust
Subscription {
    active: true,
    paused: false,
    last_charged: T,
}
where grace_period > 0 && current_time > T + interval + grace_period
```

**Characteristics:**
- Charge window has elapsed
- Grace period has expired
- Charge attempts will fail with `GracePeriodElapsed`
- Subscription remains active but unchargeable until interval advances again

**Valid Transitions:**
- → **Active (Standard)** via `subscribe()` (resets subscription state)
- → **Cancelled** via `cancel()`

**Operations Allowed:**
- `pay_per_use()`: ✅
- `charge()`: ❌ (GracePeriodElapsed)
- `pause()`: ✅
- `cancel()`: ✅

---

### 6. Paused

**Storage Condition:**
```rust
Subscription {
    active: true,
    paused: true,
    ..
}
```

**Characteristics:**
- Subscription exists and is marked active
- All payment operations are blocked
- `last_charged` is frozen (does not advance)
- User retains control and can resume or cancel

**Valid Transitions:**
- → **Active (Standard)** or **Active (Chargeable)** via `resume()` (depends on current time vs `last_charged + interval`)
- → **Cancelled** via `cancel()`

**Operations Allowed:**
- `pay_per_use()`: ❌ (subscription is paused)
- `charge()`: ❌ (subscription is paused)
- `pause()`: ❌ (already paused)
- `resume()`: ✅
- `cancel()`: ✅

---

### 7. Cancelled

**Storage Condition:**
```rust
Subscription {
    active: false,
    ..  // other fields unchanged
}
```

**Characteristics:**
- Subscription exists in storage but is marked inactive
- All payment operations are permanently blocked
- Cannot be resumed
- Can only be replaced by resubscribing

**Valid Transitions:**
- → **Active (Standard)** or **Active (Trial)** via `subscribe()` or `subscribe_with_metadata()` (creates new subscription, overwrites cancelled state)

**Operations Allowed:**
- `pay_per_use()`: ❌ (subscription is not active)
- `charge()`: ❌ (subscription is not active)
- `pause()`: ❌ (subscription is not active)
- `resume()`: ❌ (subscription is not active)
- `cancel()`: ❌ (already cancelled)
- `subscribe()`: ✅ (overwrites)

---

## State Transition Diagram

```
                    ┌─────────────┐
                    │ Nonexistent │
                    └──────┬──────┘
                           │
         subscribe() or subscribe_with_metadata()
                           │
           ┌───────────────┴───────────────┐
           │                               │
           ▼                               ▼
    ┌─────────────┐              ┌────────────────┐
    │   Active    │              │ Active (Trial) │
    │ (Standard)  │              └───────┬────────┘
    └──────┬──────┘                      │
           │                             │ trial expires
           │                             ▼
           │                      ┌─────────────┐
           │                      │   Active    │
           │                      │ (Standard)  │
           │                      └──────┬──────┘
           │                             │
           │ interval elapses            │ interval elapses
           │                             │
           └─────────────┬───────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │     Active       │
              │  (Chargeable)    │
              └────┬─────────────┘
                   │
         ┌─────────┼─────────┐
         │         │         │
    charge()   grace expires │
         │         │         │
         ▼         ▼         │
    ┌─────────┐ ┌─────────┐ │
    │ Active  │ │ Active  │ │
    │(Standard│ │ (Grace  │ │
    │)        │ │ Expired)│ │
    └────┬────┘ └────┬────┘ │
         │           │      │
         └───────┬───┴──────┘
                 │
         pause() │ cancel()
                 │
       ┌─────────┼──────────┐
       │                    │
       ▼                    ▼
  ┌─────────┐        ┌───────────┐
  │ Paused  │        │ Cancelled │
  └────┬────┘        └─────┬─────┘
       │                   │
   resume()                │
       │                   │
       └────────────────┬──┘
                        │
                   subscribe()
                        │
                        ▼
                 ┌─────────────┐
                 │   Active    │
                 │ (Standard)  │
                 └─────────────┘
```

---

## Metadata and Storage Extensions

### Subscription Metadata

**Storage Key:** `DataKey::SubscriptionMeta(user)`

**Structure:**
```rust
String // max 64 bytes
```

**Lifecycle:**
- Created via `set_metadata()` or `subscribe_with_metadata()`
- Persists independently of subscription state
- Not deleted on `cancel()`
- Overwritten on subsequent `set_metadata()` or `subscribe_with_metadata()`

### Charge History

**Storage Key:** `DataKey::ChargeHistory(user)`

**Structure:**
```rust
Vec<u64> // last 12 charge timestamps
```

**Lifecycle:**
- Appends a timestamp on each successful `charge()` call
- Capped at 12 entries (FIFO)
- Persists through pause/resume cycles
- Not deleted on `cancel()`

### Referral Data

**Storage Key:** `DataKey::Referral(user)`

**Structure:**
```rust
Address // referrer address
```

**Lifecycle:**
- Set on first `subscribe()` or `subscribe_with_metadata()` call with `referrer: Some(Address)`
- Immutable after first write
- Persists through subscription rewrites
- Not deleted on `cancel()`

---

## Grace Period Behavior

**Global Configuration:** `DataKey::GracePeriod` (instance storage)

**Effect on State Transitions:**

- **When `grace_period == 0` (default):**
  - No grace period enforcement
  - `charge()` succeeds as long as `current_time >= last_charged + interval`
  - No `GracePeriodElapsed` error possible

- **When `grace_period > 0`:**
  - Valid charge window: `[last_charged + interval, last_charged + interval + grace_period]`
  - Before window: `IntervalNotElapsed` error
  - After window: `GracePeriodElapsed` error

**State Integrity:**
- Grace period changes do not retroactively affect existing subscriptions
- Each `charge()` call evaluates grace period against the current global setting

---

## Trial Period Behavior

**Parameter:** `trial_period: Option<u64>` (passed to `subscribe()` or `subscribe_with_metadata()`)

**Implementation:**
```rust
let last_charged = match trial_period {
    Some(period) => now + period,
    None => now,
};
```

**State Implications:**
- Trial subscriptions are immediately **Active** but not **Chargeable**
- `pay_per_use()` works immediately during trial
- First `charge()` can occur at `last_charged + interval` (i.e., `subscribe_time + trial_period + interval`)

---

## Pause/Resume Mechanics

### Pause

**Preconditions:**
- Subscription must exist
- `active == true`

**State Changes:**
```rust
sub.paused = true;
// last_charged unchanged
```

**Effect:**
- Freezes subscription state
- All payment operations blocked
- Time does not advance billing eligibility

### Resume

**Preconditions:**
- Subscription must exist
- `active == true`
- `paused == true`

**State Changes:**
```rust
sub.paused = false;
// last_charged unchanged
```

**Effect:**
- Unfreezes subscription
- Billing eligibility resumes based on original `last_charged` timestamp
- If `current_time >= last_charged + interval` immediately after resume, subscription is **Active (Chargeable)**

---

## Resubscription Behavior

**Operation:** `subscribe()` or `subscribe_with_metadata()` on a user with an existing subscription

**Effect:**
- Completely overwrites the existing subscription struct
- Resets all fields (`merchant`, `amount`, `interval`, `last_charged`, `active`, `paused`, `token`)
- Does not modify `active_count` if previous subscription was active (no double-increment)

**Use Case:**
- Upgrading/downgrading plan
- Switching merchant
- Switching token
- Reactivating a cancelled subscription

---

## Cancel Behavior

**Operation:** `cancel()`

**Preconditions:**
- Subscription must exist

**State Changes:**
```rust
sub.active = false;
// all other fields unchanged
```

**Side Effects:**
- Decrements `ActiveCount` (global counter)
- Emits `cancelled` event
- Does not delete subscription from storage
- Does not delete metadata, charge history, or referral data

---

## Validation and Integrity Constraints

### On Subscribe

1. `amount > 0` — enforced via `assert!`
2. `interval > 0` — enforced via `assert!`
3. `token.allowance(user, contract) >= amount` — enforced via `assert!`
4. If whitelist enabled, `merchant` must be whitelisted — enforced via `ContractError::MerchantNotWhitelisted`

### On Charge

1. Subscription must exist — enforced via `ContractError::NoSubscriptionFound`
2. `active == true` — enforced via `assert!`
3. `paused == false` — enforced via `assert!`
4. `current_time >= last_charged + interval` — enforced via `ContractError::IntervalNotElapsed`
5. If `grace_period > 0`, `current_time <= last_charged + interval + grace_period` — enforced via `ContractError::GracePeriodElapsed`
6. Global volume cap not exceeded — enforced via `ContractError::GlobalVolumeExceeded`

### On Pay-Per-Use

1. `amount > 0` — enforced via `assert!`
2. Subscription must exist — enforced via `expect("no subscription found")`
3. `active == true` — enforced via `assert!`
4. `paused == false` — enforced via `assert!`
5. Daily spending limit not exceeded (if set) — enforced via panic message
6. Global volume cap not exceeded — enforced via `ContractError::GlobalVolumeExceeded`

---

## Global Volume Cap

**Storage:** `DataKey::GlobalVolumeWindow` (instance storage)

**Structure:**
```rust
pub struct GlobalVolumeWindow {
    pub current_window_start: u64,
    pub accumulated_volume: i128,
}
```

**Threshold:** `GLOBAL_MAX_VOLUME_PER_HOUR = 50_000_000_000_000` stroops

**Window Duration:** `HOUR_IN_SECONDS = 3600`

**Behavior:**
- Tracks cumulative transaction volume across all users
- Window resets when `current_time >= current_window_start + 3600`
- Increments on every successful `charge()` and `pay_per_use()` transfer
- Panics with `GlobalVolumeExceeded` if accumulated volume exceeds threshold
- Uses `checked_add` to prevent overflow

**State Integrity:**
- Only successful transfers contribute to volume tracking
- Failed transactions (e.g., insufficient balance) do not increment volume
- Volume check occurs **after** `transfer_from()` succeeds

---

## Contract Pause

**Storage:** `DataKey::ContractPaused` (instance storage, `bool`)

**Effect:**
- When `true`, all protocol operations can be blocked (implementation-dependent)
- Readable via `get_protocol_stats().contract_paused`
- Controlled by admin via `pause_contract()` and `unpause_contract()`

**Current Implementation:**
- No operations currently check `ContractPaused` flag
- Reserved for future emergency stop functionality

---

## Summary of State Flags

| State | `active` | `paused` | Chargeable | PPU Allowed |
|---|---|---|---|---|
| Nonexistent | N/A | N/A | ❌ | ❌ |
| Active (Standard) | `true` | `false` | ❌ | ✅ |
| Active (Trial) | `true` | `false` | ❌ | ✅ |
| Active (Chargeable) | `true` | `false` | ✅ | ✅ |
| Active (Grace Expired) | `true` | `false` | ❌ | ✅ |
| Paused | `true` | `true` | ❌ | ❌ |
| Cancelled | `false` | * | ❌ | ❌ |

---

## Appendix: Storage Schema

| Key | Type | Scope | TTL |
|---|---|---|---|
| `Subscription(user)` | `Subscription` | Persistent | 6307200 ledgers (~1 year) |
| `SubscriptionMeta(user)` | `String` | Persistent | Not extended by charge |
| `ChargeHistory(user)` | `Vec<u64>` | Persistent | Not extended by charge |
| `Referral(user)` | `Address` | Persistent | Not extended by charge |
| `ActiveCount` | `u64` | Instance | Contract lifetime |
| `GracePeriod` | `u64` | Instance | Contract lifetime |
| `GlobalVolumeWindow` | `GlobalVolumeWindow` | Instance | Contract lifetime |
| `ContractPaused` | `bool` | Instance | Contract lifetime |

---

**End of Specification**
