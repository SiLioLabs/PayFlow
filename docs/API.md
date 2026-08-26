# Contract API Reference

This document tracks the current public contract surface in [contract/src/lib.rs](../contract/src/lib.rs). For error codes, see [ERROR-CODES.md](./ERROR-CODES.md), which contains the CONTRACT-34 table. For events, see [EVENTS.md](./EVENTS.md). For the propose/commit and propose/accept pattern shared by `transfer_admin`/`accept_admin`, `propose_fee`/`commit_fee`, `propose_grace_period`/`commit_grace_period`, and `propose_upgrade`/`commit_upgrade`, see [architecture/two-step-auth.md](./architecture/two-step-auth.md).

---

## Table of Contents

- [Bounded API delta (Issue 110)](#bounded-api-delta-issue-110)
- [Data Types](#data-types)
  - [Subscription](#subscription)
  - [ChargeResult](#chargeresult)
  - [ChargeSimResult](#chargesimresult)
  - [ProtocolStats](#protocolstats)
  - [HealthReport](#healthreport)
  - [DataKey](#datakey)
- [Functions](#functions)
  - [initialize](#initialize)
  - [subscribe](#subscribe)
  - [subscribe\_with\_metadata](#subscribe_with_metadata)
  - [charge](#charge)
  - [simulate\_charge](#simulate_charge)
  - [extend\_subscription\_ttl](#extend_subscription_ttl)
  - [pay\_per\_use](#pay_per_use)
  - [cancel](#cancel)
  - [pause](#pause)
  - [pause\_until](#pause_until)
  - [resume](#resume)
  - [transfer\_admin](#transfer_admin)
  - [accept\_admin](#accept_admin)
  - [is\_contract\_paused](#is_contract_paused)
  - [get\_admin](#get_admin)
  - [get\_token](#get_token)
  - [upgrade](#upgrade)
  - [propose_upgrade](#propose_upgrade)
  - [cancel_pending_upgrade](#cancel_pending_upgrade)
  - [commit_upgrade](#commit_upgrade)
  - [get_pending_upgrade](#get_pending_upgrade)
  - [get\_subscription](#get_subscription)
  - [next\_charge\_at](#next_charge_at)
  - [is\_charge\_due](#is_charge_due)
  - [get\_trial\_end](#get_trial_end)
  - [propose\_grace\_period](#propose_grace_period)
  - [commit\_grace\_period](#commit_grace_period)
  - [get\_grace\_period](#get_grace_period)
  - [set\_subscription\_amount](#set_subscription_amount)
  - [set\_subscription\_interval](#set_subscription_interval)
  - [set\_min\_interval](#set_min_interval)
  - [get\_min\_interval](#get_min_interval)
  - [add\_merchant](#add_merchant)
  - [remove\_merchant](#remove_merchant)
  - [set\_whitelist\_enabled](#set_whitelist_enabled)
  - [is\_whitelist\_enabled](#is_whitelist_enabled)
  - [is\_merchant\_whitelisted](#is_merchant_whitelisted)
  - [freeze\_merchant](#freeze_merchant)
  - [unfreeze\_merchant](#unfreeze_merchant)
  - [bump\_merchant\_revenue\_day](#bump_merchant_revenue_day)
  - [prune\_merchant\_revenue\_days](#prune_merchant_revenue_days)
  - [get\_merchant\_revenue\_day](#get_merchant_revenue_day)
  - [is\_merchant\_frozen](#is_merchant_frozen)
  - [get\_fee](#get_fee)
  - [propose\_fee](#propose_fee)
  - [commit\_fee](#commit_fee)
  - [set\_fee\_bounds](#set_fee_bounds)
  - [get\_fee\_bounds](#get_fee_bounds)
  - [batch\_charge](#batch_charge)
  - [get\_batch\_charge\_estimate](#get_batch_charge_estimate)
  - [get\_active\_count](#get_active_count)
  - [get\_subscriber\_count](#get_subscriber_count)
  - [get\_subscriber\_at](#get_subscriber_at)
  - [get\_subscriber\_page](#get_subscriber_page)
  - [get\_active\_subscriber\_page](#get_active_subscriber_page)
  - [get\_merchant\_revenue](#get_merchant_revenue)
  - [get\_merchant\_revenue\_history](#get_merchant_revenue_history)
  - [clear\_merchant\_revenue\_history](#clear_merchant_revenue_history)
  - [get\_merchant\_subscriber\_count](#get_merchant_subscriber_count)
  - [reset\_merchant\_revenue](#reset_merchant_revenue)
  - [withdraw\_merchant\_revenue](#withdraw_merchant_revenue)
  - [set\_daily\_limit](#set_daily_limit)
  - [remove\_daily\_limit](#remove_daily_limit)
  - [get\_daily\_limit](#get_daily_limit)
  - [get\_daily\_spent](#get_daily_spent)
  - [get\_referrer](#get_referrer)
  - [migrate](#migrate)
  - [get\_schema\_version](#get_schema_version)
  - [set\_metadata](#set_metadata)
  - [get\_metadata](#get_metadata)
  - [get\_subscription\_label](#get_subscription_label)
  - [clear\_metadata](#clear_metadata)
  - [get\_charge\_history](#get_charge_history)
  - [get\_protocol\_stats](#get_protocol_stats)
  - [pause\_contract](#pause_contract)
  - [unpause\_contract](#unpause_contract)
  - [set\_initial\_admin](#set_initial_admin)
  - [contract\_health\_check](#contract_health_check)
  - [clear\_charge\_history](#clear_charge_history)
  - [get\_charge\_history\_page](#get_charge_history_page)
  - [transfer\_subscription](#transfer_subscription)
  - [validate\_subscription](#validate_subscription)
  - [repair\_subscription](#repair_subscription)
- [Units & Conversions](#units--conversions)
- [Events Reference](#events-reference)
- [Error Codes](#error-codes)

---

## Bounded API delta (Issue 110)

This revision documents only the following symbols against `contract/src/lib.rs`, `contract/src/charge_exec.rs`, `contract/src/batch.rs`, `contract/src/fee.rs`, `contract/src/errors.rs`, and `contract/src/storage.rs`. It is **not** a full API audit.

- [x] `contract_health_check`
- [x] `HealthReport`
- [x] `simulate_charge`
- [x] `get_batch_charge_estimate`
- [x] `ChargeResult`
- [x] `ChargeSimResult`
- [x] `set_fee_bounds`
- [x] `get_fee_bounds`
- [x] `pause_until`
- [x] pause-expiry getter — **not exposed** (internal `storage::get_pause_expiry` only; no public contract method)
- [x] `get_active_subscriber_page`

Related ops: [`EVENTS.md`](./EVENTS.md) (`paused`, `subscription_auto_resumed`, `charged`), [`KEEPER.md`](./KEEPER.md) (`batch_charge`), [`MAINNET-DEPLOYMENT.md`](./MAINNET-DEPLOYMENT.md) (fee bounds / health gates).

---

## Data Types

### `Subscription`

```rust
pub struct Subscription {
  pub merchant: Address,
  pub amount: i128,
  pub interval: u64,
  pub last_charged: u64,
  pub active: bool,
  pub paused: bool,
  pub token: Address,
  pub referrer: Option<Address>,
  pub label: Symbol,
  pub trial_duration: u64,
}
```

### `ChargeResult`

Returned by live `batch_charge` and by `get_batch_charge_estimate`. Defined in `contract/src/batch.rs` (re-exported from `lib.rs`).

```rust
pub enum ChargeResult {
  Charged,            // live: funds transferred; estimate: would charge (see caveats)
  Skipped,            // interval has not elapsed
  NoSubscription,     // no subscription record
  Inactive,           // cancelled / inactive
  Paused,             // still paused
  GracePeriodElapsed, // past the grace window
}
```

| Variant | Meaning on `batch_charge` | Meaning on `get_batch_charge_estimate` |
| --- | --- | --- |
| `Charged` | Transfer succeeded | Precheck passed (or auto-resume short-circuit; **no transfer**) |
| `Skipped` | Interval not elapsed | Same (via `precheck_charge`) |
| `NoSubscription` | No record | Same |
| `Inactive` | Cancelled / inactive | Same |
| `Paused` | Still paused | Same |
| `GracePeriodElapsed` | Past grace window | Same |

This type is **not** the dry-run enum. Single-user simulation uses [`ChargeSimResult`](#chargesimresult).

### `ChargeSimResult`

Returned only by `simulate_charge`. Defined in `contract/src/charge_exec.rs`.

```rust
pub enum ChargeSimResult {
  WouldSucceed,
  NotDue,
  Inactive,
  InsufficientAllowance,
  GracePeriodElapsed,
  ContractPaused,
  SubscriptionPaused,
}
```

| Variant | Meaning |
| --- | --- |
| `WouldSucceed` | Prechecks including SAC allowance would pass |
| `NotDue` | Ledger time is before next charge |
| `Inactive` | Missing subscription **or** inactive (no separate `NoSubscription`) |
| `InsufficientAllowance` | `allowance(user, contract) < amount` |
| `GracePeriodElapsed` | Past grace window |
| `ContractPaused` | Protocol paused (`storage::is_contract_paused`) |
| `SubscriptionPaused` | User pause, including unexpired `pause_until` |

`simulate_charge` never panics with a `ContractError` for these outcomes; they are return values.

### `ProtocolStats`

```rust
pub struct ProtocolStats {
  pub active_count: u64,
  pub fee_bps: u32,
  pub fee_collector: Option<Address>,
  pub grace_period: u64,
  pub whitelist_enabled: bool,
  pub schema_version: u32,
  pub contract_paused: bool,
}
```

### `HealthReport`

Returned by [`contract_health_check`](#contract_health_check). There is no separate health-status enum: interpret `is_healthy` plus the component flags.

```rust
pub struct HealthReport {
  pub is_healthy: bool,
  pub contract_paused: bool,
  pub token_configured: bool,
  pub admin_configured: bool,
  pub instance_ttl_ledgers: u32,
  pub active_subscription_count: u64,
  pub schema_version: u32,
  pub fee_collector_set: bool,
  pub global_volume_utilization_pct: u32,
  pub pending_merchant_rev_count: u32,
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `is_healthy` | `bool` | `!contract_paused && token_configured && admin_configured && instance_ttl_ledgers > 17_280` |
| `contract_paused` | `bool` | Protocol pause flag |
| `token_configured` | `bool` | Instance token is set |
| `admin_configured` | `bool` | Admin is set |
| `instance_ttl_ledgers` | `u32` | **On-chain:** hardcoded `100_000` (Soroban does not expose `get_ttl()` outside tests). **Test/testutils:** real instance TTL. Do not treat the on-chain value as precise remaining TTL. |
| `active_subscription_count` | `u64` | Active subscription counter |
| `schema_version` | `u32` | Migration schema version |
| `fee_collector_set` | `bool` | Protocol fee collector is set |
| `global_volume_utilization_pct` | `u32` | `(accumulated * 100) / cap`, clamped to ≤ 100; `0` if cap is 0. Cap is `GlobalVolumeCapOverride` or `GLOBAL_MAX_VOLUME_PER_HOUR`. |
| `pending_merchant_rev_count` | `u32` | Merchants in `MerchantIndex` with unwithdrawn revenue `> 0` |

**How to interpret:** treat `is_healthy == false` as “do not send production traffic” until pause, token, admin, or TTL flags are understood. `fee_collector_set` and volume utilization are informational and do **not** enter the `is_healthy` formula. `global_volume_utilization_pct` uses the stored cap override when present; charge-time enforcement still uses the compile-time constant (see [`MAINNET-DEPLOYMENT.md`](./MAINNET-DEPLOYMENT.md#2-volume-cap)).

### `DataKey`

```rust
pub enum DataKey {
  Subscription(Address),
  Token,
  Admin,
  GracePeriod,
  MerchantWhitelist(Address),
  WhitelistEnabled,
  MerchantFrozen(Address),
  FeeCollector,
  FeeBps,
  PendingFee,
  PendingAdmin,
  ActiveCount,
  MerchantRevenue(Address),
  MerchantRevenueDay(Address, u64),
  DailyLimit(Address),
  DailySpent(Address),
  Referral(Address),
  SchemaVersion,
  SubscriptionMeta(Address),
  ChargeHistory(Address),
  GlobalVolumeWindow,
  ContractPaused,
  MinInterval,
  MerchantRevenueHistory(Address),
  SubscriberIndex(u64),
  SubscriberIndexSize,
  MerchantSubCount(Address),
  PendingGracePeriod,
}
```

---

## Functions

### `initialize`

```
initialize(env: Env, token: Address, admin: Address)
```

| Name | Type | Description |
| --- | --- | --- |
| `token` | `Address` | SAC token used for subscription payments. |
| `admin` | `Address` | Initial contract admin. |

Auth: none.

Returns: `()`.

Errors: `ContractError::AlreadyInitialized`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source deployer --network testnet -- initialize --token <TOKEN_ADDRESS> --admin <ADMIN_ADDRESS>
```

### `subscribe`

```
subscribe(env: Env, user: Address, merchant: Address, amount: i128, interval: u64, token: Address, trial_period: Option<u64>, referrer: Option<Address>)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber and transaction signer. |
| `merchant` | `Address` | Merchant receiving funds. |
| `amount` | `i128` | Recurring amount in stroops. |
| `interval` | `u64` | Billing interval in seconds. |
| `token` | `Address` | Token contract used for this subscription. |
| `trial_period` | `Option<u64>` | Optional delay before the first charge. |
| `referrer` | `Option<Address>` | Optional referrer address. |

Auth: `user.require_auth()`.

Returns: `()`.

Errors: `ContractError::AmountMustBePositive`, `ContractError::IntervalMustBePositive`, `ContractError::MerchantNotWhitelisted`, `ContractError::ContractPausedError`, `ContractError::InvalidTokenAddress`, `ContractError::IntervalTooShort`, `ContractError::InsufficientAllowance`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- subscribe --user <USER_ADDRESS> --merchant <MERCHANT_ADDRESS> --amount 50000000 --interval 2592000 --token <TOKEN_ADDRESS>
```

### `subscribe_with_metadata`

```
subscribe_with_metadata(env: Env, user: Address, merchant: Address, amount: i128, interval: u64, token: Address, trial_period: Option<u64>, referrer: Option<Address>, label: String)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber and transaction signer. |
| `merchant` | `Address` | Merchant receiving funds. |
| `amount` | `i128` | Recurring amount in stroops. |
| `interval` | `u64` | Billing interval in seconds. |
| `token` | `Address` | Token contract used for this subscription. |
| `trial_period` | `Option<u64>` | Optional delay before the first charge. |
| `referrer` | `Option<Address>` | Optional referrer address. |
| `label` | `String` | Subscription label, max 64 bytes. |

Auth: `user.require_auth()`.

Returns: `()`.

Errors: same as `subscribe()`, plus `ContractError::MetadataLabelTooLong`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- subscribe_with_metadata --user <USER_ADDRESS> --merchant <MERCHANT_ADDRESS> --amount 50000000 --interval 2592000 --token <TOKEN_ADDRESS> --label pro
```

### `charge`

```
charge(env: Env, user: Address)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber to charge. |

Auth: none. This is permissionless for keeper use.

Returns: `()`.

Errors: `ContractError::NoSubscriptionFound`, `ContractError::SubscriptionNotActive`, `ContractError::SubscriptionPaused`, `ContractError::IntervalNotElapsed`, `ContractError::GracePeriodElapsed`, `ContractError::NotInitialized`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <KEEPER_KEY> --network testnet -- charge --user <USER_ADDRESS>
```

### `simulate_charge`

Dry-run of a single `charge()` for `user`. **No storage writes** and **no token transfer**. Outcomes are [`ChargeSimResult`](#chargesimresult) variants, not panics.

```
simulate_charge(env: Env, user: Address) -> ChargeSimResult
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber to simulate. |

**Auth:** none.

**Returns:** `ChargeSimResult`.

**Success behavior:** evaluates contract pause, subscription presence, `pause_until` expiry (in memory only — does not persist auto-resume), due time, grace window, then SAC `allowance(user, contract)` vs `amount`. Returns `WouldSucceed` if all pass.

**Error conditions:** none as `ContractError` panics. Failure reasons are enum variants (`ContractPaused`, `Inactive`, `SubscriptionPaused`, `NotDue`, `GracePeriodElapsed`, `InsufficientAllowance`).

**Distinguish from live charge and batch estimate:**

| | `charge` / `batch_charge` | `simulate_charge` | `get_batch_charge_estimate` |
| --- | --- | --- | --- |
| Transfers | Yes | No | No |
| Storage writes | Yes on success / auto-resume | No (auto-resume is memory-only) | **Yes** if `try_auto_resume` fires |
| Contract pause | Enforced (panic / skip) | `ContractPaused` | **Ignored** |
| Allowance | Required for success | Checked | **Not checked** |
| Return | void / `ChargeResult` | `ChargeSimResult` | `Vec<ChargeResult>` |

Keeper ops still use live `batch_charge`; see [`KEEPER.md`](./KEEPER.md). Events for a real charge are in [`EVENTS.md`](./EVENTS.md).

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- simulate_charge --user <USER_ADDRESS>
```

### `extend_subscription_ttl`

```
extend_subscription_ttl(env: Env, user: Address)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber whose TTL should be refreshed. |

Auth: none.

Returns: `()`.

Errors: none beyond storage access.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- extend_subscription_ttl --user <USER_ADDRESS>
```

### `pay_per_use`

```
pay_per_use(env: Env, user: Address, amount: i128)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber and signer. |
| `amount` | `i128` | One-time payment amount in stroops. |

Auth: `user.require_auth()`.

Returns: `()`.

Errors: `ContractError::AmountMustBePositive`, `ContractError::AmountExceedsMaximum`, `ContractError::NoSubscriptionFound`, `ContractError::SubscriptionNotActive`, `ContractError::SubscriptionPaused`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- pay_per_use --user <USER_ADDRESS> --amount 1000000
```

### `cancel`

```
cancel(env: Env, user: Address)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber and signer. |

Auth: `user.require_auth()`.

Returns: `()`.

Errors: `ContractError::NoSubscriptionFound`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- cancel --user <USER_ADDRESS>
```

### `pause`

```
pause(env: Env, user: Address)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber and signer. |

Auth: `user.require_auth()`.

Returns: `()`.

Errors: `ContractError::NoSubscriptionFound`, `ContractError::SubscriptionNotActive`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- pause --user <USER_ADDRESS>
```

### `pause_until`

Bounded user pause. The subscription auto-resumes on a later `charge` or `batch_charge` when ledger time `>= expiry`. Unlike indefinite [`pause`](#pause), this path sets `paused = true` **and** `active = false`.

```
pause_until(env: Env, user: Address, expiry: u64)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber and signer. |
| `expiry` | `u64` | Unix ledger timestamp; must be **strictly greater than** current ledger time. |

**Auth:** `user.require_auth()`.

**Returns:** `()`.

**Success behavior:** writes the subscription, stores pause expiry internally, emits `paused` (`("paused", user)`). See [`EVENTS.md`](./EVENTS.md).

**Errors:**

| Condition | Code | Symbol |
| --- | --- | --- |
| `expiry <= now` | 27 | `InvalidPauseExpiry` |
| No subscription | 4 | `NoSubscriptionFound` |
| `!sub.active` | 16 | `SubscriptionNotActive` |

**Pause-expiry read API:** there is **no** public `get_pause_expiry`, `get_pause`, or `paused_until` contract method. Expiry is stored via internal `storage::set_pause_expiry` / `storage::get_pause_expiry` only.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- pause_until --user <USER_ADDRESS> --expiry <UNIX_TIMESTAMP>
```

### `resume`

```
resume(env: Env, user: Address)
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber and signer. |

Auth: `user.require_auth()`.

Returns: `()`.

Errors: `ContractError::NoSubscriptionFound`, `ContractError::SubscriptionNotActive`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- resume --user <USER_ADDRESS>
```

### `transfer_admin`

```
transfer_admin(env: Env, new_admin: Address)
```

| Name | Type | Description |
| --- | --- | --- |
| `new_admin` | `Address` | Proposed admin address. |

Auth: current admin only.

Returns: `()`.

Errors: none beyond auth.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- transfer_admin --new_admin <NEW_ADMIN_ADDRESS>
```

### `accept_admin`

```
accept_admin(env: Env)
```

Auth: proposed admin only.

Returns: `()`.

Errors: `expect("no pending admin")` if no proposal exists.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <NEW_ADMIN_KEY> --network testnet -- accept_admin
```

### `is_contract_paused`

```
is_contract_paused(env: Env) -> bool
```

Auth: none.

Returns: `bool`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- is_contract_paused
```

### `get_admin`

```
get_admin(env: Env) -> Option<Address>
```

Auth: none.

Returns: `Option<Address>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_admin
```

### `get_token`

```
get_token(env: Env) -> Option<Address>
```

Auth: none.

Returns: `Option<Address>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_token
```

### `upgrade`

```
upgrade(env: Env, new_wasm_hash: BytesN<32>)
```

| Name | Type | Description |
| --- | --- | --- |
| `new_wasm_hash` | `BytesN<32>` | New contract WASM hash. |

Auth: none in the current implementation.

Returns: `()`.

Errors: none beyond host/deployer failures.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- upgrade --new_wasm_hash <WASM_HASH>
```

### `propose_upgrade`

```
propose_upgrade(env: Env, new_wasm_hash: BytesN<32>)
```

Queues a WASM hash for the two-step upgrade flow. Auth: admin. The pending
proposal is stored temporarily and refreshed to a 17,280-ledger TTL.

### `cancel_pending_upgrade`

```
cancel_pending_upgrade(env: Env)
```

Clears the pending upgrade proposal. Auth: admin.

### `commit_upgrade`

```
commit_upgrade(env: Env)
```

Commits the pending WASM hash and clears the proposal. Auth: admin. Panics
with `NoPendingProposal` when the proposal was cancelled or expired.

### `get_pending_upgrade`

```
get_pending_upgrade(env: Env) -> Option<BytesN<32>>
```

Returns the pending upgrade hash, or `None` when no proposal exists. Auth: none.

### `get_subscription`

```
get_subscription(env: Env, user: Address) -> Option<Subscription>
```

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | Subscriber address to look up. |

Auth: none.

Returns: `Option<Subscription>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_subscription --user <USER_ADDRESS>
```

### `next_charge_at`

Read-only view. Returns the Unix timestamp of the next scheduled charge for a user.

```
next_charge_at(env: Env, user: Address) -> Option<u64>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `Option<u64>` — `Some(last_charged + interval)` if the subscription is active and not paused. Returns `None` when:
- No subscription exists for `user`
- The subscription is inactive (cancelled, `active == false`)
- The subscription is paused (`paused == true`)

The returned timestamp does not change between charges; it reflects the scheduled billing time regardless of whether the charge has been triggered yet.

**Storage read:** `DataKey::Subscription(user)` in persistent storage.

**See also:** [`is_charge_due`](#is_charge_due) to test whether the charge window is open right now; [`get_subscription`](#get_subscription) to inspect the full record.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- next_charge_at \
  --user <USER_ADDRESS>
```

---

### `is_charge_due`

Read-only predicate. Returns `true` when a subscriber has a charge due at the current ledger timestamp — that is, when calling `charge(user)` right now would succeed rather than panic.

```
is_charge_due(env: Env, user: Address) -> bool
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to test. |

**Auth:** None.

**Returns:** `bool` — `true` when all of the following conditions hold simultaneously:
- A subscription exists for `user`
- The subscription is active (`active == true`) and not paused (`paused == false`)
- `now >= next_charge_at` — the billing interval has elapsed
- `now <= next_charge_at + grace_period` — the charge is still within the grace window (this condition is skipped when `grace_period == 0`)

Returns `false` for any absent subscription, inactive or paused subscription, interval not yet elapsed, or expired grace window.

**Storage read:** `DataKey::Subscription(user)` in persistent storage; `DataKey::GracePeriod` in instance storage.

**Usage for keepers:** Poll `is_charge_due` for each subscriber before deciding whether to submit a `charge()` transaction, saving gas on calls that would revert.

**See also:** [`next_charge_at`](#next_charge_at) for the exact scheduled timestamp; [`get_grace_period`](#get_grace_period) for the contract-wide grace window; [`charge`](#charge) for the write operation.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- is_charge_due \
  --user <USER_ADDRESS>
```

---

### `get_trial_end`

Read-only view. Returns the Unix timestamp when a subscriber's trial period ends, or `None` if the subscriber is not currently in a trial or has no subscription.

```
get_trial_end(env: Env, user: Address) -> Option<u64>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `Option<u64>` — Unix timestamp (seconds) of trial expiry when `last_charged > now`, otherwise `None`.

**How trials work:** When `subscribe()` is called with a `trial_period` of `N` seconds, the contract sets `last_charged = now + N` instead of `now`. This pushes the first eligible charge forward by the trial duration. `get_trial_end` returns `Some(last_charged)` while that timestamp is still in the future, indicating the subscriber is actively in a trial. Once the trial expires — that is, once `last_charged <= now` — this function returns `None` because the first charge window has opened. No separate storage key is used; the trial end is encoded directly in `last_charged`.

Returns `None` if no subscription exists for `user`.

**Storage read:** `DataKey::Subscription(user)` in persistent storage (reads `last_charged` field).

**See also:** [`subscribe`](#subscribe) for the `trial_period` parameter; [`next_charge_at`](#next_charge_at) which returns `Some(last_charged + interval)` once the trial ends.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_trial_end \
  --user <USER_ADDRESS>
```

---

### `propose_grace_period`

```
propose_grace_period(env: Env, seconds: u64)
```

| Name | Type | Description |
| --- | --- | --- |
| `seconds` | `u64` | Proposed grace period in seconds. |

Auth: admin only.

Returns: `()`.

Errors: `ContractError::NoPendingProposal` is not used here; `seconds` is validated in the helper.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- propose_grace_period --seconds 86400
```

### `commit_grace_period`

```
commit_grace_period(env: Env)
```

Auth: admin only.

Returns: `()`.

Errors: `ContractError::NoPendingProposal`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- commit_grace_period
```

### `get_grace_period`

Read-only view. Returns the current contract-wide grace period in seconds.

```
get_grace_period(env: Env) -> u64
```

**Auth:** None.

**Returns:** `u64` — grace period in seconds. Returns `0` when no grace period has been configured, which means charges must arrive exactly at or after `next_charge_at` with no tolerance window.

**What the grace period means:** After a billing interval elapses, keepers have a window of `grace_period` seconds in which to submit `charge()`. Concretely, `charge()` accepts a call only while `now` falls within `[next_charge_at, next_charge_at + grace_period]`. Calls that arrive after this window panic with `"grace period elapsed"`. In `batch_charge`, users whose grace window has closed are returned as `ChargeResult::GracePeriodElapsed` without aborting the batch.

**Storage read:** `DataKey::GracePeriod` in instance storage. Defaults to `0` when the key is absent.

**See also:** [`propose_grace_period`](#propose_grace_period) and [`commit_grace_period`](#commit_grace_period) to change this value (admin, two-step); [`is_charge_due`](#is_charge_due) which incorporates the grace window into its result.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_grace_period
```

---

### `set_subscription_amount`

```
set_subscription_amount(env: Env, user: Address, new_amount: i128)
```

Auth: admin only.

Returns: `()`.

Errors: `ContractError::NoSubscriptionFound`, `ContractError::AmountMustBePositive`, `ContractError::AmountExceedsMaximum`, `ContractError::ContractPausedError`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- set_subscription_amount --user <USER_ADDRESS> --new_amount 50000000
```

### `set_subscription_interval`

```
set_subscription_interval(env: Env, user: Address, new_interval: u64)
```

Auth: admin only.

Returns: `()`.

Errors: `ContractError::NoSubscriptionFound`, `ContractError::IntervalTooShort`, `ContractError::ContractPausedError`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- set_subscription_interval --user <USER_ADDRESS> --new_interval 604800
```

### `set_min_interval`

```
set_min_interval(env: Env, seconds: u64)
```

Auth: admin only.

Returns: `()`.

Errors: panics if `seconds == 0`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- set_min_interval --seconds 3600
```

### `get_min_interval`

Read-only view. Returns the minimum allowed subscription interval in seconds.

```
get_min_interval(env: Env) -> u64
```

**Auth:** None.

**Returns:** `u64` — minimum interval in seconds. **Default: `3600` (1 hour)** when `set_min_interval` has never been called.

**What this controls:** When `subscribe()` or `set_subscription_interval()` is called, the requested `interval` is validated against this floor. Any attempt to create or update a subscription with `interval < get_min_interval()` will panic with `ContractError::IntervalTooShort`. The floor prevents subscriptions from being charged too frequently (e.g. every second), protecting both users and the network from spam.

**Storage read:** `DataKey::MinInterval` in instance storage. Falls back to the compile-time constant `DEFAULT_MIN_INTERVAL = 3600` when the key is absent.

**See also:** [`set_min_interval`](#set_min_interval) to change this value (admin only); [`subscribe`](#subscribe) and [`set_subscription_interval`](#set_subscription_interval) which enforce it.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_min_interval
```

---

### `add_merchant`

```
add_merchant(env: Env, merchant: Address)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- add_merchant --merchant <MERCHANT_ADDRESS>
```

*See also: [Merchant Integration Cookbook — Getting Started](./MERCHANT-INTEGRATION.md#1-getting-started) for whitelist request flow.*

### `remove_merchant`

```
remove_merchant(env: Env, merchant: Address)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- remove_merchant --merchant <MERCHANT_ADDRESS>
```

### `set_whitelist_enabled`

```
set_whitelist_enabled(env: Env, enabled: bool)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- set_whitelist_enabled --enabled true
```

### `get_whitelist_enabled`

```
get_whitelist_enabled(env: Env) -> bool
```

Auth: none.

Returns: `bool` (`true` by default if not set).

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_whitelist_enabled
```

### `is_whitelist_enabled`

```
is_whitelist_enabled(env: Env) -> bool
```

Auth: none.

Returns: `bool` (`true` by default if not set).

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- is_whitelist_enabled
```

### `is_merchant_whitelisted`

```
is_merchant_whitelisted(env: Env, merchant: Address) -> bool
```

Auth: none.

Returns: `bool`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- is_merchant_whitelisted --merchant <MERCHANT_ADDRESS>
```

### `get_top_merchants_by_subs`

```
get_top_merchants_by_subs(env: Env, limit: u32) -> Vec<(Address, u32)>
```

Auth: none.

Returns: `Vec<(Address, u32)>` (top N merchants ranked by active subscriber count in descending order).

Panics: `ContractError::BatchTooLarge` if `limit > 20`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_top_merchants_by_subs --limit 10
```

### `freeze_merchant`

```
freeze_merchant(env: Env, merchant: Address)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- freeze_merchant --merchant <MERCHANT_ADDRESS>
```

### `unfreeze_merchant`

```
unfreeze_merchant(env: Env, merchant: Address)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- unfreeze_merchant --merchant <MERCHANT_ADDRESS>
```

### `bump_merchant_revenue_day`

```
bump_merchant_revenue_day(env: Env, merchant: Address, day: u64)
```

Auth: none.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- bump_merchant_revenue_day --merchant <MERCHANT_ADDRESS> --day 20000
```

### `prune_merchant_revenue_days`

```
prune_merchant_revenue_days(env: Env, merchant: Address, days: Vec<u64>)
```

Auth: none in the wrapper.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- prune_merchant_revenue_days --merchant <MERCHANT_ADDRESS> --days '[20000,20001]'
```

### `get_merchant_revenue_day`

```
get_merchant_revenue_day(env: Env, merchant: Address, day: u64) -> i128
```

Auth: none.

Returns: `i128`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_merchant_revenue_day --merchant <MERCHANT_ADDRESS> --day 20000
```

### `is_merchant_frozen`

```
is_merchant_frozen(env: Env, merchant: Address) -> bool
```

Auth: none.

Returns: `bool`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- is_merchant_frozen --merchant <MERCHANT_ADDRESS>
```

### `get_fee`

```
get_fee(env: Env) -> Option<(Address, u32)>
```

Auth: none.

Returns: `Option<(Address, u32)>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_fee
```

### `propose_fee`

```
propose_fee(env: Env, collector: Address, bps: u32)
```

Auth: admin only.

Returns: `()`.

Errors: `ContractError::InvalidFeeBps`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- propose_fee --collector <COLLECTOR_ADDRESS> --bps 100
```

### `commit_fee`

```
commit_fee(env: Env)
```

Auth: admin only.

Returns: `()`.

Errors: `ContractError::NoPendingProposal` (23), `ContractError::FeeOutOfBoundsAtCommit` (35) if pending bps is outside [`get_fee_bounds`](#get_fee_bounds).

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- commit_fee
```

### `set_fee_bounds`

Admin-only guardrails for **future** fee commits. Stored on instance as `DataKey::MinFeeBps` / `DataKey::MaxFeeBps`.

```
set_fee_bounds(env: Env, min_bps: u32, max_bps: u32)
```

| Name | Type | Description |
| --- | --- | --- |
| `min_bps` | `u32` | Inclusive minimum bps for a pending fee at commit. |
| `max_bps` | `u32` | Inclusive maximum bps; must be `<= 10_000`. |

**Auth:** admin (`admin::require_admin`).

**Returns:** `()`.

**Bounds semantics:** `propose_fee` does **not** apply these bounds (it only rejects `bps > 10_000` and an invalid collector). `commit_fee` rejects pending bps outside `[min_bps, max_bps]` with `FeeOutOfBoundsAtCommit` (35).

**Errors:** `ContractError::InvalidFeeBounds` (34) if `min_bps > max_bps` or `max_bps > 10_000`. Unauthorized callers fail admin auth.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- set_fee_bounds --min_bps 0 --max_bps 500
```

### `get_fee_bounds`

```
get_fee_bounds(env: Env) -> (u32, u32)
```

**Auth:** none.

**Returns:** `(min_bps, max_bps)`. Defaults to `(0, 10000)` when governance has not set explicit bounds.

**Errors:** none.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_fee_bounds
```

Operational gate: [`MAINNET-DEPLOYMENT.md`](./MAINNET-DEPLOYMENT.md#1-fee-bounds).

### `batch_charge`

```
batch_charge(env: Env, users: Vec<Address>) -> Vec<ChargeResult>
```

Auth: none.

Returns: `Vec<ChargeResult>`.

Errors: the function returns per-user results instead of aborting on ordinary charge failures.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <KEEPER_KEY> --network testnet -- batch_charge --users '["<USER_A>","<USER_B>"]'
```

### `get_batch_charge_estimate`

Batch **estimate** (not a transfer). Returns `Vec<ChargeResult>` — the live batch enum — **not** [`ChargeSimResult`](#chargesimresult).

```
get_batch_charge_estimate(env: Env, users: Vec<Address>) -> Vec<ChargeResult>
```

| Name | Type | Description |
| --- | --- | --- |
| `users` | `Vec<Address>` | Addresses to estimate. |

**Auth:** none.

**Returns:** one `ChargeResult` per input address, in order.

**Success behavior:** for each user, missing sub → `NoSubscription`. If paused and `try_auto_resume` returns true → **`Charged` immediately** (skips `precheck_charge`). Otherwise maps `precheck_charge` to `Charged` / skip variants.

**Errors:** `ContractError::BatchTooLarge` (20) if `users.len() > 200` (hardcoded; not `get_max_batch_size`). Ordinary per-user outcomes are enum values, not panics.

**Operational caveats (from `lib.rs`):**

1. Calls real `try_auto_resume`, which **writes** the subscription, clears pause expiry, and emits `subscription_auto_resumed` — **not a pure view**.
2. Does **not** check contract pause or token allowance (unlike `simulate_charge`).
3. Auto-resume short-circuit to `Charged` can disagree with live `batch_charge`, which still runs `precheck_charge` after resume (estimate may say `Charged` when live would `Skipped`).
4. Cap 200 vs live batch max (default 50 via `MaxBatchSize`).

Use `simulate_charge` for a no-write, allowance-aware single-user dry-run. Keepers that charge should still call `batch_charge` ([`KEEPER.md`](./KEEPER.md)). Auto-resume event: [`EVENTS.md`](./EVENTS.md).

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_batch_charge_estimate --users '["<USER_A>","<USER_B>"]'
```

### `get_active_count`

```
get_active_count(env: Env) -> u64
```

Auth: none.

Returns: `u64`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_active_count
```

### `get_subscriber_count`

```
get_subscriber_count(env: Env) -> u64
```

Auth: none.

Returns: `u64`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_subscriber_count
```

### `get_subscriber_at`

```
get_subscriber_at(env: Env, index: u64) -> Option<Address>
```

Auth: none.

Returns: `Option<Address>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_subscriber_at --index 0
```

### `get_subscriber_page`

```
get_subscriber_page(env: Env, offset: u64, limit: u32) -> Vec<Address>
```

Auth: none.

Returns: `Vec<Address>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_subscriber_page --offset 0 --limit 10
```

### `get_active_subscriber_page`

View of **active** subscriber addresses from the append-only `SubscriberIndex`. Sibling [`get_subscriber_page`](#get_subscriber_page) does not filter on `sub.active`.

```
get_active_subscriber_page(env: Env, offset: u64, limit: u32) -> Vec<Address>
```

| Name | Type | Description |
| --- | --- | --- |
| `offset` | `u64` | **Index-slot** cursor into `SubscriberIndex`, not “Nth active subscriber”. |
| `limit` | `u32` | Requested page size. Silently clamped to **50**. `0` returns empty. |

**Auth:** none.

**Returns:** `Vec<Address>`. Empty when `offset >= index_size` or `cap == 0`. Length may be **less than** `limit` when many slots are missing or inactive; the scan continues until `result.len() == cap` or the index ends.

**Pagination:** increment `offset` by the number of **index slots consumed**, not by `result.len()`, if you need to walk the whole index. The implementation walks `i` from `offset` upward and pushes only addresses whose `Subscription` exists and `sub.active` is true.

**Errors:** none.

**Related:** `ChargeResult` / keeper paging still typically use `batch_charge` with an operator-supplied address list ([`KEEPER.md`](./KEEPER.md)).

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_active_subscriber_page --offset 0 --limit 50
```

### `get_merchant_revenue`

```
get_merchant_revenue(env: Env, merchant: Address) -> i128
```

Auth: none.

Returns: `i128`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_merchant_revenue --merchant <MERCHANT_ADDRESS>
```

### `get_merchant_revenue_history`

```
get_merchant_revenue_history(env: Env, merchant: Address, days: u32) -> Vec<i128>
```

Auth: none.

Returns: `Vec<i128>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_merchant_revenue_history --merchant <MERCHANT_ADDRESS> --days 7
```

### `clear_merchant_revenue_history`

```
clear_merchant_revenue_history(env: Env, merchant: Address)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- clear_merchant_revenue_history --merchant <MERCHANT_ADDRESS>
```

### `get_merchant_subscriber_count`

```
get_merchant_subscriber_count(env: Env, merchant: Address) -> u64
```

Auth: none.

Returns: `u64`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_merchant_subscriber_count --merchant <MERCHANT_ADDRESS>
```

### `get_merchant_sub_count`

```
get_merchant_sub_count(env: Env, merchant: Address) -> u32
```

Auth: none.

Returns: `u32` — active subscriber count for `merchant` (same `MerchantSubCount` storage as `get_merchant_subscriber_count`, narrowed to `u32`).

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_merchant_sub_count --merchant <MERCHANT_ADDRESS>
```

*See also: [Merchant Integration Cookbook — Monitoring Subscribers](./MERCHANT-INTEGRATION.md#3-monitoring-subscribers).*

### `reset_merchant_revenue`

```
reset_merchant_revenue(env: Env, merchant: Address)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- reset_merchant_revenue --merchant <MERCHANT_ADDRESS>
```

### `withdraw_merchant_revenue`

```
withdraw_merchant_revenue(env: Env, merchant: Address)
```

| Name | Type | Description |
| --- | --- | --- |
| `merchant` | `Address` | Merchant withdrawing accrued revenue. |

Auth: `merchant.require_auth()`.

Returns: `()`.

Errors: `ContractError::NotInitialized`, `ContractError::ZeroBalanceAvailable`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <MERCHANT_KEY> --network testnet -- withdraw_merchant_revenue --merchant <MERCHANT_ADDRESS>
```

*See also: [Merchant Integration Cookbook](./MERCHANT-INTEGRATION.md) for the full merchant onboarding → revenue → withdraw path.*

### `set_daily_limit`

```
set_daily_limit(env: Env, user: Address, limit: i128)
```

Auth: `user.require_auth()`.

Returns: `()`.

Errors: `ContractError::AmountMustBePositive`.

CLI example:
*See also: [Daily Spending Limits Guide](./DAILY-LIMITS.md) for a conceptual overview of the `pay_per_use` spending cap.*
For a complete list of all error codes returned by the contract, see [ERROR-CODES.md](./ERROR-CODES.md).

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- set_daily_limit --user <USER_ADDRESS> --limit 50000000
```

### `remove_daily_limit`

```
remove_daily_limit(env: Env, user: Address)
```

Auth: `user.require_auth()`.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- remove_daily_limit --user <USER_ADDRESS>
```

### `get_daily_spent`

See the [full reference entry below](#get_daily_spent).

### `get_day_start`

```
get_day_start(env: Env, user: Address) -> bool
```

Auth: none.

Returns: `bool` — `true` if `DataKey::DayStart(user)` exists (current ~24h spend window is active), `false` otherwise. This is a presence marker, not a wall-clock timestamp.

CLI example:
*See also: [Daily Spending Limits Deep-Dive](./DAILY-LIMITS.md).*

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_day_start --user <USER_ADDRESS>
```

### `get_referrer`

```
get_referrer(env: Env, user: Address) -> Option<Address>
```

Auth: none.

Returns: `Option<Address>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_referrer --user <USER_ADDRESS>
```

### `migrate`

```
migrate(env: Env, users: Vec<Address>)
```

Auth: none.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- migrate --users '["<USER_ADDRESS>"]'
```

### `get_schema_version`

See the [full reference entry below](#get_schema_version).

### `set_metadata`

```
set_metadata(env: Env, user: Address, label: String)
```

Auth: `user.require_auth()`.

Returns: `()`.

Errors: `ContractError::MetadataLabelTooLong`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- set_metadata --user <USER_ADDRESS> --label pro
```

### `get_metadata`

```
get_metadata(env: Env, user: Address) -> Option<String>
```

Auth: none.

Returns: `Option<String>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_metadata --user <USER_ADDRESS>
```

### `get_subscription_label`

```
get_subscription_label(env: Env, user: Address) -> Option<String>
```

Auth: none.

Returns: `Option<String>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_subscription_label --user <USER_ADDRESS>
```

### `clear_metadata`

```
clear_metadata(env: Env, user: Address)
```

Auth: `user.require_auth()`.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- clear_metadata --user <USER_ADDRESS>
```

### `get_charge_history`

```
get_charge_history(env: Env, user: Address) -> Vec<u64>
```

Auth: none.

Returns: `Vec<u64>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_charge_history --user <USER_ADDRESS>
```

### `get_protocol_stats`

```
get_protocol_stats(env: Env) -> ProtocolStats
```

Auth: none.

Returns: `ProtocolStats`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_protocol_stats
```

### `pause_contract`

```
pause_contract(env: Env)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- pause_contract
```

### `unpause_contract`

```
unpause_contract(env: Env)
```

Auth: admin only.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- unpause_contract
```

### `set_initial_admin`

```
set_initial_admin(env: Env, admin: Address)
```

Auth: none.

Returns: `()`.

Errors: panics if the admin is already set.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- set_initial_admin --admin <ADMIN_ADDRESS>
```

### `contract_health_check`

Read-only snapshot of protocol health. Safe at any time: **no auth, no storage writes**. There is no `health_check` or `get_health` export.

```
contract_health_check(env: Env) -> HealthReport
```

**Auth:** none.

**Returns:** [`HealthReport`](#healthreport).

**Success behavior:** builds the struct; does not panic on the normal path. `is_healthy` is true only when the contract is not paused, token and admin are set, and `instance_ttl_ledgers > 17_280`.

**Errors:** none defined.

**Operational notes:** on-chain `instance_ttl_ledgers` is a hardcoded `100_000`. Off-chain `scripts/health-check.ts` is a **shallow** RPC simulation of `get_schema_version` and `get_active_count` only — it does not call this method. See [`MAINNET-DEPLOYMENT.md`](./MAINNET-DEPLOYMENT.md#3-health).

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- contract_health_check
```

### `clear_charge_history`

```
clear_charge_history(env: Env, user: Address)
```

Auth: `user.require_auth()`.

Returns: `()`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- clear_charge_history --user <USER_ADDRESS>
```

### `get_charge_history_page`

```
get_charge_history_page(env: Env, user: Address, offset: u32, limit: u32, ascending: bool) -> Vec<u64>
```

Auth: none.

Returns: `Vec<u64>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_charge_history_page --user <USER_ADDRESS> --offset 0 --limit 12 --ascending false
```

#### Pagination Guide

`ChargeHistory(user)` is a `Vec<u64>` of up to 12 charge timestamps, stored **oldest → newest**. Every successful `charge()` appends a timestamp; once the vector holds 12 entries, the next append drops entry `0` (the oldest) before pushing the new one. In other words, storage itself is the ring buffer — `get_charge_history_page` slices whatever is currently in it (in ascending or descending order). There is no separate "total charge count" stored anywhere; the longest history you can ever page through is 12 entries, because older charges are physically gone.

**Slicing algorithm (from [`subscription_history.rs`](../contract/src/subscription_history.rs)):**

```rust
ordered_history = if ascending { history } else { history.reversed() }
effective_limit = min(limit, 12)
if offset >= ordered_history.len() { return [] }   // empty, not an error
end = min(offset + effective_limit, ordered_history.len())
return ordered_history[offset..end]
```

`limit` is silently capped at 12 — passing `limit: 100` is safe and simply returns everything available. `offset` is never validated against the history length beyond the empty-result check above; there is no `IndexOutOfBounds`-style error anywhere in this path.

> **`ascending` parameter.** Passing `ascending = true` returns records in oldest-to-newest order. Passing `ascending = false` returns records in newest-to-oldest order (most recent first).

**Ring buffer diagram** — a subscriber with 14 total lifetime charges (`c1`..`c14`). Only the last 12 survive:

```
 lifetime charges:  c1  c2  c3 [c4  c5  c6  c7  c8  c9  c10 c11 c12 c13 c14]
                     ↑   ↑   ↑   └──────────────── retained (12 slots) ────────────────┘
                  evicted (FIFO, oldest dropped first as new charges arrive)

 ChargeHistory(user) in storage (index 0 = oldest):

   index:   0    1    2    3    4    5    6    7    8    9    10   11
   value:  [c4,  c5,  c6,  c7,  c8,  c9, c10, c11, c12, c13, c14]  (len = 11 here, one slot short of the cap)

 get_charge_history_page(user, offset=8, limit=3)
                                    │
                     slices index [8..11) ─┐
                                            ▼
                                        [c12, c13, c14]
```

##### Worked examples

*Example 1 — fetch everything (`offset=0, limit=12`):*

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- \
  get_charge_history_page --user <USER_ADDRESS> --offset 0 --limit 12
```

With a history of `[c4..c14]` (11 entries), this returns all 11 entries, oldest to newest. If the subscriber has fewer than 12 charges total, one call is always enough — you never need a second page.

*Example 2 — most recent 5 records (no `ascending` param, so compute the offset):*

```typescript
const all = await getChargeHistoryPage(user, 0, 12); // at most 12 entries ever exist
const mostRecent5 = all.slice(-5); // last 5 = newest 5, since storage is oldest → newest
```

Equivalently, on-chain: `offset = max(0, total - 5)`, `limit = 5`. If `total = 11`, call `get_charge_history_page(user, 6, 5)` to get entries `[6..11)`.

*Example 3 — offset beyond the record count (returns empty, not an error):*

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- \
  get_charge_history_page --user <USER_ADDRESS> --offset 5 --limit 2
```

For a subscriber with only 1 recorded charge, `offset=5 >= len(1)` so this returns `[]`. This mirrors the covering test [`test_get_charge_history_page_offset_beyond_length`](../contract/src/test.rs).

**Offset / limit reference table** (history has 11 entries, `c4`..`c14`, oldest → newest):

| `offset` | `limit` | Result | Notes |
| --- | --- | --- | --- |
| `0` | `12` | `[c4..c14]` (11 items) | `limit` capped at 12, but history only has 11 |
| `0` | `5` | `[c4, c5, c6, c7, c8]` | oldest 5 |
| `6` | `5` | `[c10, c11, c12, c13, c14]` | newest 5 (see Example 2) |
| `11` | `5` | `[]` | `offset == len`, empty result |
| `20` | `5` | `[]` | `offset > len`, empty result, no error |
| `9` | `100` | `[c13, c14]` | `limit` capped then clamped to remaining length |

##### "Load all history" with a pagination loop (TypeScript)

Because storage never holds more than 12 entries, a single call with `limit: 12` already returns everything. The loop below is still useful as the general-purpose pattern for infinite-scroll style UIs, and keeps working unmodified if the on-chain cap is ever raised. It calls the contract the same way [`getSubscription`](../frontend/src/stellar.ts) does — build, simulate, decode:

```typescript
import { Contract, TransactionBuilder, BASE_FEE, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { server, CONTRACT_ID, NETWORK_PASSPHRASE } from "./stellar";
import { ScValDecoder } from "./services/scval";

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

/** Fetches one page of charge timestamps via get_charge_history_page. */
async function getChargeHistoryPage(
  user: string,
  offset: number,
  limit: number
): Promise<number[]> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(user);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "get_charge_history_page",
        addressVal(user),
        nativeToScVal(offset, { type: "u32" }),
        nativeToScVal(limit, { type: "u32" })
      )
    )
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error((result as { error: string }).error);

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return [];

  return retval.vec()?.map((v) => Number(ScValDecoder.decodeU64(v))) ?? [];
}

/**
 * Loads the subscriber's full charge history by paging until an empty
 * (or short) page comes back. Safe to call even though today's 12-record
 * cap means it will always resolve after a single request.
 */
async function loadAllChargeHistory(user: string): Promise<number[]> {
  const PAGE_SIZE = 12; // matches the contract's MAX_HISTORY cap
  const all: number[] = [];
  let offset = 0;

  while (true) {
    const page = await getChargeHistoryPage(user, offset, PAGE_SIZE);
    all.push(...page);

    if (page.length < PAGE_SIZE) break; // short page = no more records
    offset += page.length;
  }

  return all;
}
```

See [INTEGRATION-GUIDE.md § 8 — Paginating Charge History](./INTEGRATION-GUIDE.md#8-paginating-charge-history) for the same pattern in a full integration walkthrough.

### `transfer_subscription`

```
transfer_subscription(env: Env, user: Address, new_user: Address)
```

Auth: `user.require_auth()`.

Returns: `()`.

Errors: `ContractError::ContractPausedError`, `ContractError::NoSubscriptionFound`, `ContractError::SubscriptionAlreadyActive`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- transfer_subscription --user <USER_ADDRESS> --new_user <NEW_USER_ADDRESS>
```

---

## Units & Conversions

All amounts are in stroops. 1 XLM = 10,000,000 stroops. Intervals are

## Events Reference

See [EVENTS.md](./EVENTS.md) for the complete event schema reference. For building keepers, analytics, notifications, or reconciliation jobs on top of those events, see [EVENT-DRIVEN-GUIDE.md](./EVENT-DRIVEN-GUIDE.md).

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The payer. Must match the transaction signer. |
| `amount` | `i128` | Stroops to transfer. Must be > 0. |

**Auth:** `user.require_auth()`.

**What it does:**
1. Loads the subscription for `user`
2. Asserts `active == true`
3. Calls `transfer_from(contract, user, merchant, amount)` on the token contract



**Events emitted**

```
topic:  ("pay_per_use", user)
data:   (merchant, amount)
```

**Errors**

| Condition | Panic message |
| --- | --- |
| `amount <= 0` | `"amount must be positive"` |
| No subscription exists | `"no subscription found"` |
| Subscription is cancelled | `"subscription is not active"` |
| Subscription is paused | `"subscription is paused"` |
| Insufficient allowance | Host error from token contract |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- pay_per_use \
  --user <USER_ADDRESS> \
  --amount 1000000
```

---

### `pause`

Temporarily halts charges for a subscription. The subscription record is preserved and can be resumed at any time. Both `charge()` and `pay_per_use()` will panic while paused.

```
pause(env: Env, user: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |

**Auth:** `user.require_auth()`.

**Events emitted**

```
topic:  ("paused", user)
data:   ()
```

**Errors**

| Condition | Panic message |
| --- | --- |
| No subscription exists | `"no subscription found"` |
| Subscription is cancelled | `"subscription is not active"` |
| Subscription already paused | `"subscription is already paused"` |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- pause \
  --user <USER_ADDRESS>
```

---

### `resume`

Resumes a paused subscription, re-enabling `charge()` and `pay_per_use()`.

```
resume(env: Env, user: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |

**Auth:** `user.require_auth()`.

**Events emitted**

```
topic:  ("resumed", user)
data:   ()
```

**Errors**

| Condition | Panic message |
| --- | --- |
| No subscription exists | `"no subscription found"` |
| Subscription is cancelled | `"subscription is not active"` |
| Subscription is not paused | `"subscription is not paused"` |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- resume \
  --user <USER_ADDRESS>
```

---

### `cancel`

Deactivates a subscription. The subscription record remains in storage with `active = false`. No further charges can be made.

```
cancel(env: Env, user: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |

**Auth:** `user.require_auth()`.

**Events emitted**

```
topic:  ("cancelled", user)
data:   ()
```

**Errors**

| Condition | Panic message |
| --- | --- |
| No subscription exists | `"no subscription found"` |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- cancel \
  --user <USER_ADDRESS>
```

---

### `get_subscription`

Read-only view function. Returns the subscription for a given user, or `None` if none exists.

```
get_subscription(env: Env, user: Address) -> Option<Subscription>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to look up. |

**Auth:** None.

**Returns:** `Option<Subscription>` — `None` if no subscription exists for this address.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_subscription \
  --user <USER_ADDRESS>
```

---

### `next_charge_at`

See the [full reference entry above](#next_charge_at).

---

### `batch_charge`

Charges multiple subscribers in a single transaction. Individual failures do not abort the batch — every address is processed and its outcome is returned.

```
batch_charge(env: Env, users: Vec<Address>) -> Vec<ChargeResult>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `users` | `Vec<Address>` | List of subscriber addresses to attempt charging. |

**Auth:** None. Same permissionless model as `charge()`.

**Returns:** `Vec<ChargeResult>` — one entry per input address, in order.

```rust
pub enum ChargeResult {
    Charged,            // funds transferred successfully
    Skipped,            // interval has not elapsed yet
    NoSubscription,     // no subscription found for this address
    Inactive,           // subscription is cancelled
    Paused,             // subscription is paused
    GracePeriodElapsed, // charge window has closed
}
```

**Storage written:** `DataKey::Subscription(user)` updated for each `Charged` result. `DataKey::MerchantRevenue(merchant)` incremented for each `Charged` result.

**Events emitted:** `("charged", user)` for each successfully charged user.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER_KEY> \
  --network testnet \
  -- batch_charge \
  --users '["<USER_A>","<USER_B>","<USER_C>"]'
```

---

### `get_active_count`

Returns the current number of active subscriptions. Incremented by `subscribe()`, decremented by `cancel()`.

```
get_active_count(env: Env) -> u64
```

**Auth:** None.

**Returns:** `u64` — total active subscriptions.

**Storage read:** `DataKey::ActiveCount` in instance storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_active_count
```

---

### `get_merchant_revenue`

Returns the cumulative amount charged to a merchant's subscribers across all `charge()` and `pay_per_use()` calls.

```
get_merchant_revenue(env: Env, merchant: Address) -> i128
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `merchant` | `Address` | The merchant address to query. |

**Auth:** None.

**Returns:** `i128` — total stroops received by this merchant. Returns `0` if no charges have occurred.

**Storage read:** `DataKey::MerchantRevenue(merchant)` in persistent storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_merchant_revenue \
  --merchant <MERCHANT_ADDRESS>
```

---

### `set_daily_limit`

Sets a daily spending cap for `pay_per_use()` for the calling user. The limit is stored in temporary storage and resets automatically after approximately one day (~17,280 ledgers at 5 s/ledger).

*For a detailed conceptual guide on how limits and TTL expirations work, see [Daily Spending Limits](./DAILY-LIMITS.md).*

```
set_daily_limit(env: Env, user: Address, limit: i128)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |
| `limit` | `i128` | Maximum stroops spendable via `pay_per_use()` per day. Must be > 0. |

**Auth:** `user.require_auth()`.

**Storage written:** `DataKey::DailyLimit(user)` in temporary storage with TTL of ~1 day.

**Enforcement:** Every `pay_per_use()` call checks `DailySpent(user) + amount <= DailyLimit(user)` before transferring. The running total is tracked in `DataKey::DailySpent(user)` (also temporary, same TTL).

**Errors**

| Condition | Panic message |
| --- | --- |
| `limit <= 0` | `"limit must be positive"` |
| Spend would exceed limit | `"daily spending limit exceeded"` |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- set_daily_limit \
  --user <USER_ADDRESS> \
  --limit 50000000
```

---

### `get_daily_limit`

Read-only view. Returns the current daily spending cap for a user's `pay_per_use()` calls, or `None` if no cap has been set.

```
get_daily_limit(env: Env, user: Address) -> Option<i128>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `Option<i128>` — the daily limit in stroops, or `None` if no limit has been set for this user. A `None` result means `pay_per_use()` is uncapped for this user.

**Storage read:** `DataKey::DailyLimit(user)` in temporary storage (TTL ≈ 1 day, ~17,280 ledgers at 5 s/ledger). Returns `None` automatically once the TTL expires, which resets the cap each day without manual intervention.

**See also:** [`set_daily_limit`](#set_daily_limit) to configure the cap; [`remove_daily_limit`](#remove_daily_limit) to clear it; [`get_daily_spent`](#get_daily_spent) to check how much has been consumed today.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_daily_limit \
  --user <USER_ADDRESS>
```

---

### `get_daily_spent`

Read-only view. Returns the total amount spent today by a user via `pay_per_use()` calls.

```
get_daily_spent(env: Env, user: Address) -> i128
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `i128` — stroops spent today via `pay_per_use()`. Returns `0` when no spend has been recorded in the current window or when the daily tracking TTL has expired.

**How the window works:** The first `pay_per_use()` call of the day anchors a `DataKey::DayStart(user)` marker in temporary storage with a TTL of ~17,280 ledgers (≈1 day). `get_daily_spent` returns `0` whenever that marker is absent — either because the user has never called `pay_per_use()`, or because the 24-hour window has expired and both `DayStart` and `DailySpent` have been automatically pruned.

**Storage read:** `DataKey::DayStart(user)` presence check first; then `DataKey::DailySpent(user)` — both in temporary storage.

**See also:** [`set_daily_limit`](#set_daily_limit) to configure the daily cap; [`get_daily_limit`](#get_daily_limit) to read the configured cap; [`pay_per_use`](#pay_per_use) which increments this counter on each call.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_daily_spent \
  --user <USER_ADDRESS>
```

---

### `extend_subscription_ttl`

Extends the TTL of a user's subscription record in persistent storage.

```
extend_subscription_ttl(env: Env, user: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to extend TTL for. |

**Auth:** None.

**Storage written:** Extends TTL of `DataKey::Subscription(user)` in persistent storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- extend_subscription_ttl \
  --user <USER_ADDRESS>
```

---

### `get_trial_end`

See the [full reference entry above](#get_trial_end).

---

Adds a merchant to the whitelist. Only the contract admin can call this.

```
add_merchant(env: Env, merchant: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `merchant` | `Address` | The merchant address to whitelist. |

**Auth:** Admin only.

**Storage written:** `DataKey::MerchantWhitelist(merchant)` in persistent storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- add_merchant \
  --merchant <MERCHANT_ADDRESS>
```

---

### `remove_merchant`

Removes a merchant from the whitelist. Only the contract admin can call this.

```
remove_merchant(env: Env, merchant: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `merchant` | `Address` | The merchant address to remove from the whitelist. |

**Auth:** Admin only.

**Storage written:** Removes `DataKey::MerchantWhitelist(merchant)` from persistent storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- remove_merchant \
  --merchant <MERCHANT_ADDRESS>
```

---

### `set_whitelist_enabled`

Enables or disables the merchant whitelist. Only the contract admin can call this.

```
set_whitelist_enabled(env: Env, enabled: bool)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `bool` | True to enable the whitelist, false to disable. |

**Auth:** Admin only.

**Storage written:** `DataKey::WhitelistEnabled` in instance storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- set_whitelist_enabled \
  --enabled true
```

---

### `get_merchant_revenue_history`

Returns per-day revenue for the given merchant for the last `days` days, oldest to newest.

```
get_merchant_revenue_history(env: Env, merchant: Address, days: u32) -> Vec<i128>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `merchant` | `Address` | The merchant address to query. |
| `days` | `u32` | The number of days of history to retrieve. |

**Auth:** None.

**Returns:** `Vec<i128>` — Daily revenue in stroops, ordered oldest to newest.

**Storage read:** `DataKey::MerchantRevenueDay(merchant, day)` in persistent storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_merchant_revenue_history \
  --merchant <MERCHANT_ADDRESS> \
  --days 7
```

---

### `get_referrer`

Returns the referrer address recorded for a subscriber.

```
get_referrer(env: Env, user: Address) -> Option<Address>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `Option<Address>` — `None` if no referrer was recorded.

**Storage read:** `DataKey::Referral(user)` in persistent storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_referrer \
  --user <USER_ADDRESS>
```

---

### `migrate`

Upgrades contract storage to the latest schema version. Safe to call multiple times.

```
migrate(env: Env)
```

**Auth:** None (admin restriction can be added in future versions).

**Storage written:** `DataKey::SchemaVersion` in instance storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- migrate
```

---

### `get_schema_version`

Read-only view. Returns the current storage schema version of the contract.

```
get_schema_version(env: Env) -> u32
```

**Auth:** None.

**Returns:** `u32` — the schema version stored in instance storage. **Default: `1`** when `DataKey::SchemaVersion` has never been written (i.e. before the first `migrate()` call or on freshly deployed contracts).

**What schema versions mean:**

| Version | Description |
| --- | --- |
| `1` | Initial schema. `Subscription` struct does not include the `paused` field. |
| `2` | Current schema. `Subscription` includes `paused: bool`. Set by `migrate()`. |

**When to call this:** Use `get_schema_version` to verify a deployment is on the current schema before running `migrate()`, and to confirm a migration completed successfully. A keeper or admin script can check this before submitting `migrate(users)` to avoid redundant transactions — `migrate()` is a no-op when already at version 2, but reading the version first avoids the gas cost entirely.

**Storage read:** `DataKey::SchemaVersion` in instance storage. Falls back to `1u32` when absent.

**See also:** [`migrate`](#migrate) which bumps this value from 1 → 2; the [Deployment — State Migration](./DEPLOYMENT.md#state-migration) guide for the full migration history and CLI steps.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_schema_version
```

---

---

### `set_metadata`

Attaches a short label string (e.g. plan name) to the caller's subscription.

```
set_metadata(env: Env, user: Address, label: String)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |
| `label` | `String` | Short display label (e.g. `"pro"`, `"basic"`). |

**Auth:** `user.require_auth()`.

**Storage written:** `DataKey::SubscriptionMeta(user)` in persistent storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- set_metadata \
  --user <USER_ADDRESS> \
  --label pro
```

---

### `get_metadata`

Returns the metadata label for a subscriber.

```
get_metadata(env: Env, user: Address) -> Option<String>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `Option<String>` — `None` if no label has been set.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_metadata \
  --user <USER_ADDRESS>
```

---

### `get_charge_history`

Returns the last (up to 12) charge timestamps for a subscriber, ordered oldest → newest.

```
get_charge_history(env: Env, user: Address) -> Vec<u64>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `Vec<u64>` — UNIX timestamps of successful `charge()` calls. Empty if no charges have occurred.

**Storage read:** `DataKey::ChargeHistory(user)` in persistent storage.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_charge_history \
  --user <USER_ADDRESS>
```

---

## Subscription Integrity Diagnostics

Administrative utilities for detecting and repairing corrupted subscription records after migrations or contract upgrades.

### `validate_subscription`

Read-only integrity check for a subscriber address.

```
validate_subscription(env: Env, user: Address) -> SubscriptionValidationReport
```

**Returns `SubscriptionValidationReport`**

| Field | Type | Description |
| --- | --- | --- |
| `is_valid` | `bool` | `true` when no inconsistencies are detected |
| `violations` | `Vec<String>` | General integrity violations |
| `missing_records` | `Vec<String>` | Missing auxiliary records (history, metadata, etc.) |
| `invalid_state_transitions` | `Vec<String>` | Illegal active/paused/cancelled state combinations |
| `corrupted_references` | `Vec<String>` | Broken merchant/token/referrer references |

**Auth:** None (read-only simulation).

**Frontend:** Exposed in the Admin Dashboard → Subscription Repair panel.

---

### `repair_subscription`

Repairs detected subscription inconsistencies for a user.

```
repair_subscription(env: Env, user: Address) -> u32
```

**Auth:** Contract admin only (`require_admin`).

**Returns:** Count of fixed inconsistencies (also emitted in the `subscription_repaired` event).

**Event emitted**

| Event name | Topic | Data |
| --- | --- | --- |
| `subscription_repaired` | `("subscription_repaired", user_address)` | `fixed_inconsistencies: u32` |

**Frontend authorization:** The repair button is enabled only when the connected Freighter wallet matches the on-chain admin returned by `get_admin`.

---

## Units & Conversions

All amounts are in **stroops** — the smallest unit of a Stellar token.

| Amount | Stroops |
| --- | --- |
| 1 XLM | 10,000,000 |
| 0.5 XLM | 5,000,000 |
| 0.0000001 XLM | 1 |

All intervals are in **seconds**.

| Interval | Seconds |
| --- | --- |
| 1 day | 86,400 |
| 1 week | 604,800 |
| 30 days | 2,592,000 |

---

## Events Reference

All events can be indexed by listening to the Stellar RPC event stream for the FlowPay contract ID.

For a complete reference of all events with detailed schemas and examples, see [EVENTS.md](./EVENTS.md). For consumption patterns (polling, deduplication, reaction, reliability), see [EVENT-DRIVEN-GUIDE.md](./EVENT-DRIVEN-GUIDE.md).

| Event name | Topic | Data |
| --- | --- | --- |
| `subscribed` | `("subscribed", user_address)` | `(merchant, amount, interval)` |
| `charged` | `("charged", user_address)` | `(merchant, amount, timestamp)` |
| `pay_per_use` | `("pay_per_use", user_address)` | `(merchant, amount)` |
| `cancelled` | `("cancelled", user_address)` | `()` |
| `paused` | `("paused", user_address)` | `()` |
| `resumed` | `("resumed", user_address)` | `()` |
| `referred` | `("referred", user_address)` | `referrer_address` |
| `subscription_transferred` | `("subscription_transferred", from_address, to_address)` | `(merchant, amount, interval, token)` |
| `subscription_repaired` | `("subscription_repaired", user_address)` | `fixed_inconsistencies: u32` |

---

## Error Codes

All error conditions are returned as `ContractError` values. Client SDKs can decode these programmatically. Each variant is identified by its `u32` discriminant.

| Code | Variant | Description |
| --- | --- | --- |
| 1 | `AlreadyInitialized` | `initialize()` was called on an already-initialized contract. |
| 2 | `AmountMustBePositive` | A payment or subscription amount was zero or negative. |
| 3 | `IntervalMustBePositive` | A subscription interval was zero. |
| 4 | `NoSubscriptionFound` | No subscription record exists for the given user. |
| 5 | `SubscriptionInactive` | The subscription exists but is cancelled or paused. |
| 6 | `IntervalNotElapsed` | `charge()` was called before the billing interval elapsed. |
| 7 | `NotInitialized` | A contract function was called before `initialize()`. |
| 8 | `InsufficientAllowance` | The user's token allowance is below the subscription amount. |
| 9 | `GracePeriodElapsed` | The charge grace period has passed; the subscription cannot be charged. |
| 10 | `MerchantNotWhitelisted` | The merchant is not on the whitelist (when whitelist is enabled). |
| 11 | `ContractPaused` | The contract is paused; all user-facing write operations are blocked. |
| 24 | `DailyLimitExceeded` | A `pay_per_use()` call would exceed the user's configured daily spending limit. |
| 33 | `InvalidVolumeCap` | `set_global_volume_cap` was called with a non-positive cap. |
| 34 | `InvalidFeeBounds` | `set_fee_bounds` min/max is inconsistent or `max_bps > 10000`. |
| 35 | `FeeOutOfBoundsAtCommit` | `commit_fee` pending bps is outside current fee bounds. |
