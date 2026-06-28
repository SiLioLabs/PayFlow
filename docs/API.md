# Contract API Reference

This document tracks the current public contract surface in [contract/src/lib.rs](../contract/src/lib.rs). For error codes, see [ERROR-CODES.md](./ERROR-CODES.md), which contains the CONTRACT-34 table. For events, see [EVENTS.md](./EVENTS.md).

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

```rust
pub enum ChargeResult {
  Charged,
  Skipped,
  NoSubscription,
  Inactive,
  Paused,
  GracePeriodElapsed,
}
```

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

```rust
pub struct HealthReport {
  pub is_healthy: bool,
  pub contract_paused: bool,
  pub token_configured: bool,
  pub admin_configured: bool,
  pub instance_ttl_ledgers: u32,
  pub active_subscription_count: u64,
  pub schema_version: u32,
}
```

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

```
next_charge_at(env: Env, user: Address) -> Option<u64>
```

Auth: none.

Returns: `Option<u64>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- next_charge_at --user <USER_ADDRESS>
```

### `is_charge_due`

```
is_charge_due(env: Env, user: Address) -> bool
```

Auth: none.

Returns: `bool`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- is_charge_due --user <USER_ADDRESS>
```

### `get_trial_end`

```
get_trial_end(env: Env, user: Address) -> Option<u64>
```

Auth: none.

Returns: `Option<u64>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_trial_end --user <USER_ADDRESS>
```

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

```
get_grace_period(env: Env) -> u64
```

Auth: none.

Returns: `u64`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_grace_period
```

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

```
get_min_interval(env: Env) -> u64
```

Auth: none.

Returns: `u64`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_min_interval
```

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

### `is_whitelist_enabled`

```
is_whitelist_enabled(env: Env) -> bool
```

Auth: none.

Returns: `bool`.

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

Errors: `ContractError::NoPendingProposal`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- commit_fee
```

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

### `get_daily_limit`

```
get_daily_limit(env: Env, user: Address) -> Option<i128>
```

Auth: none.

Returns: `Option<i128>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_daily_limit --user <USER_ADDRESS>
```

### `get_daily_spent`

```
get_daily_spent(env: Env, user: Address) -> i128
```

Auth: none.

Returns: `i128`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_daily_spent --user <USER_ADDRESS>
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

```
get_schema_version(env: Env) -> u32
```

Auth: none.

Returns: `u32`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_schema_version
```

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

```
contract_health_check(env: Env) -> HealthReport
```

Auth: none.

Returns: `HealthReport`.

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
get_charge_history_page(env: Env, user: Address, offset: u32, limit: u32) -> Vec<u64>
```

Auth: none.

Returns: `Vec<u64>`.

CLI example:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_charge_history_page --user <USER_ADDRESS> --offset 0 --limit 12
```

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

All amounts are in stroops. 1 XLM = 10,000,000 stroops. Intervals are in seconds.

## Events Reference

See [EVENTS.md](./EVENTS.md) for the complete event schema reference.

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

Note: `pay_per_use` does **not** update `last_charged`. It is independent of the recurring billing cycle.

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

Read-only view function. Returns the Unix timestamp of the next scheduled charge for a user.

```
next_charge_at(env: Env, user: Address) -> Option<u64>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to look up. |

**Auth:** None.

**Returns:** `Option<u64>` — Returns `None` if:
- No subscription exists for the user
- The subscription is inactive (cancelled)

Returns `Some(last_charged + interval)` if the subscription is active.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- next_charge_at \
  --user <USER_ADDRESS>
```

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

Returns the current daily spending limit for the calling user, or `None` if no limit is set.

```
get_daily_limit(env: Env, user: Address) -> Option<i128>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `Option<i128>` — current daily limit in stroops, or `None` if unset.

**Storage read:** `DataKey::DailyLimit(user)` in temporary storage.

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

Returns the amount spent today by the calling user via `pay_per_use()`.

```
get_daily_spent(env: Env, user: Address) -> i128
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `i128` — amount spent today in stroops. Returns `0` if no spend is recorded.

**Storage read:** `DataKey::DailySpent(user)` in temporary storage.

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

Returns the trial end timestamp if the user is in a trial period.

```
get_trial_end(env: Env, user: Address) -> Option<u64>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to query. |

**Auth:** None.

**Returns:** `Option<u64>` — Unix timestamp when trial ends, or `None` if no trial or no subscription.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_trial_end \
  --user <USER_ADDRESS>
```

---

### `add_merchant`

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

Returns the current storage schema version.

```
get_schema_version(env: Env) -> u32
```

**Auth:** None.

**Returns:** `u32` — defaults to `1` before the first `migrate()` call.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_schema_version
```

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

For a complete reference of all events with detailed schemas and examples, see [EVENTS.md](./EVENTS.md).

| Event name | Topic | Data |
| --- | --- | --- |
| `subscribed` | `("subscribed", user_address)` | `(merchant, amount, interval)` |
| `charged` | `("charged", user_address)` | `(merchant, amount, timestamp)` |
| `pay_per_use` | `("pay_per_use", user_address)` | `(merchant, amount)` |
| `cancelled` | `("cancelled", user_address)` | `()` |
| `paused` | `("paused", user_address)` | `()` |
| `resumed` | `("resumed", user_address)` | `()` |
| `referred` | `("referred", user_address)` | `referrer_address` |

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
