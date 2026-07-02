# PayFlow Glossary

> PayFlow uses a number of domain-specific terms in its contract and docs. This glossary defines those terms alphabetically and links to the most relevant source materials.

## A

### Active Count
The number of subscriptions currently considered active by the contract. It changes when users subscribe and cancel. See the `ActiveCount` storage key and `get_active_count()`.

Source: `contract/src/subscription_count.rs`, `DataKey::ActiveCount`.

### Admin
The privileged address authorized to perform administrative actions (initialization, configuration changes, proposals, and commits). Admin actions are generally protected by `require_auth()` checks. The current admin may be transferred via a two-step workflow.

Source: `contract/src/admin.rs`, `DataKey::Admin`, `transfer_admin()` / `accept_admin()`.

### Append-only Subscriber Index
A persistent list-like structure used to track subscriber addresses for iteration and paging patterns. It supports reading “subscriber at index” without rewriting the full list each time. The contract keeps an associated size counter.

Source: `contract/src/subscription_count.rs`, `DataKey::SubscriberIndex(i)` and `SubscriberIndexSize`.

## B

### Batch Charge
A permissionless operation that attempts to charge multiple subscribers in one transaction. Instead of failing the whole transaction on ordinary eligibility issues, it returns per-user outcomes. This improves throughput for the keeper workflow.

Source: `contract/src/batch.rs`, `batch_charge()`.

## C

### Contract Paused
A global state flag that blocks most user-facing write operations (subscription write paths) while enabled. Read-only methods generally continue to work. The contract provides `pause_contract()` / `unpause_contract()` and `is_contract_paused()`.

Source: `contract/src/lib.rs`, `contract/src/storage.rs`, `DataKey::ContractPaused`.

### Charge Grace Window
A time window after the scheduled billing time during which a charge is still considered valid. If the grace period elapses, charging returns a grace-related error/result. The window is controlled by grace-period proposal and commit calls.

Source: `contract/src/grace.rs`, `ContractError::GracePeriodElapsed`, `DataKey::GracePeriod`.

### Charge History
A stored list/vector of charge timestamps associated with a subscriber. The contract caps the list length (documented as “up to 12”) and supports paging and clearing. Used for analytics and to validate billing behavior.

Source: `contract/src/subscription_history.rs`, `DataKey::ChargeHistory(user)`.

### Contract Schema Version
An integer representing the current on-chain storage schema version. It is updated by the `migrate()` workflow and exposed via `get_schema_version()`. Client behavior and storage migrations may depend on this value.

Source: `contract/src/migration.rs`, `DataKey::SchemaVersion`.

## D

### Daily Limit
A temporary per-subscriber cap that restricts total spendable amount via `pay_per_use()` within an approximate 24-hour TTL. It is set by `set_daily_limit()` and enforced on each one-time payment. The contract stores both the configured limit and the accumulated spend.

Source: `contract/src/spending_limit.rs`, `DataKey::DailyLimit(user)`, `DataKey::DailySpent(user)`.

### Daily Spent
The running total of stroops spent “today” via `pay_per_use()` for a specific subscriber. It is tracked in temporary storage with the same TTL behavior as the daily limit. It’s used to enforce that spend does not exceed the configured daily limit.

Source: `contract/src/spending_limit.rs`, `DataKey::DailySpent(user)`.

## E

### Events
The contract emits structured events for key lifecycle operations and state transitions. Off-chain services (indexers, dashboards) rely on these events for analytics and for driving keeper workflows. See `docs/EVENTS.md` for the canonical schema.

Source: `contract/src/events.rs`, `docs/EVENTS.md`.

## F

### Fee BPS
Fee configuration expressed in basis points (BPS). The contract uses fee BPS to compute a protocol fee split during eligible recurring charges. Fee BPS values are set via proposal/commit and exposed through getters.

Source: `contract/src/fee.rs`, `DataKey::FeeBps`, `propose_fee()` / `commit_fee()`.

### Fee Collector
The address that receives protocol-fee transfers (when a fee is configured). It is paired with Fee BPS in fee configuration. The keeper or payment execution path may transfer funds to this address.

Source: `contract/src/fee.rs`, `DataKey::FeeCollector`.

## G

### Grace Period
The configured grace duration (in seconds) applied to recurring charge eligibility. During the grace period, charges are accepted even if they occur shortly after the scheduled time. After the grace period elapses, charging is prevented.

Source: `contract/src/grace.rs`, `DataKey::GracePeriod`.

### Grace Period Proposal / Commit
Two-step workflow for updating the grace period, similar to other admin-configured parameters. A proposer sets a pending value, then an admin commits the change to make it active. This avoids instantaneous misconfiguration.

Source: `contract/src/grace.rs`, `DataKey::PendingGracePeriod`.

## K

### Keeper
The off-chain process responsible for triggering scheduled recurring charges. The keeper is the only required runtime piece for billing automation, because the contract does not schedule itself. Keeper workflows call `charge()` or `batch_charge()`.

Source: `docs/KEEPER.md`, contract API docs describing permissionless `charge()` usage.

## L

### Locked/Eligibility Checks (Interval)
The contract enforces that recurring charges only occur when the billing interval has elapsed. If the call is made too early, the operation returns an interval-related error/result. Interval rules apply to both `charge()` and `batch_charge()` paths.

Source: `contract/src/charge_exec.rs`, `ContractError::IntervalNotElapsed`.

### Min Interval
The minimum allowed billing interval floor configured by admin. This prevents subscriptions from being created with intervals that are too short. The contract exposes `set_min_interval()` / `get_min_interval()`.

Source: `contract/src/min_interval.rs`, `DataKey::MinInterval`.

## M

### Merchant
The receiving party for subscription payments and protocol-fee splits. Merchants are typically whitelisted (optional) and can be frozen to block charges. Revenue accounting is tracked per merchant.

Source: `contract/src/whitelist.rs`, `contract/src/merchant_stats.rs`.

### Merchant Frozen
A merchant-level state that prevents charges to a frozen merchant. This is independent of the global contract pause. When enabled, attempts to charge such merchants fail with merchant freeze related errors/panics.

Source: `contract/src/whitelist.rs`, `DataKey::MerchantFrozen(merchant)`.

### Merchant Revenue
The cumulative amount credited to a merchant across all successful charges and eligible one-time payments. It is stored as a running total and exposed via `get_merchant_revenue()`. Daily buckets are tracked separately.

Source: `contract/src/merchant_stats.rs`, `DataKey::MerchantRevenue(merchant)`.

### Merchant Revenue Day Bucket
A persistent daily bucket for per-day revenue analytics. The contract stores revenue keyed by merchant and day identifier. This enables reporting via `get_merchant_revenue_history()`.

Source: `contract/src/merchant_stats.rs`, `DataKey::MerchantRevenueDay(merchant, day)`.

## P

### Permissionless Charge
A design choice where charging for recurring payments can be invoked without `user.require_auth()`. This enables keepers to call `charge()` and `batch_charge()` for any eligible subscriber. Eligibility is still validated on-chain (interval, pause, grace period, merchant freeze, etc.).

Source: `docs/API.md` (Auth lines), `contract/src/charge_exec.rs`.

### Protocol Fee
The protocol-level fee charged on recurring billing flows, expressed using fee BPS and transferred to the configured fee collector address. Fees may be skipped based on configuration or special cases (e.g., 0 BPS). Fee behavior is part of the `charge()` execution.

Source: `contract/src/fee.rs`, `docs/API.md` describing protocol fee accounting.

### Protocol Stats
A read-only view summarizing on-chain protocol configuration and runtime health counters. It includes active counts, fee configuration, grace period, whitelist enabled flag, schema version, and contract pause state. Exposed via `get_protocol_stats()`.

Source: `contract/src/lib.rs`, `ProtocolStats` struct.

## R

### Referrer
An optional address recorded at subscription creation time. The contract stores the referrer for later retrieval and emits a `referred` event. This can be used to support referral analytics.

Source: `contract/src/referral.rs`, `get_referrer()`, `DataKey::Referral(user)`.

### Replay Safety (Idempotent Migration)
A property where certain admin workflows (like `migrate`) can be called multiple times safely. This reduces operational risk during upgrades. In the docs, this is described as “safe to call multiple times.”

Source: `contract/src/migration.rs`, `migrate()` docs in `docs/API.md`.

## S

### SAC Token (Subscription Allowance Currency)
The token contract used as the payment asset for subscription and one-time transfers. It is stored/selected during `initialize()` and used for `transfer_from` calls. In docs, SAC is the token required for subscription payments.

Source: `contract/src/lib.rs` (initialize token docs), `contract/src/token.rs`.

### Schema Version (Storage Schema Version)
See “Contract Schema Version”; the term is often used interchangeably in docs when referring to `schema_version` fields in health reports and protocol stats.

Source: `contract/src/lib.rs` (`ProtocolStats`, `HealthReport`), `contract/src/migration.rs`.

### Subscription
A stored record representing a subscriber’s recurring billing agreement. It includes merchant, amount, interval, next-charge tracking fields, active/paused flags, selected token, optional referrer, a label, and an optional trial duration. The contract returns it via `get_subscription()`.

Source: `contract/src/lib.rs` (`Subscription` struct), `DataKey::Subscription(user)`.

### Subscription Metadata
A short, human-readable label attached to a subscription (e.g., plan name). It’s set via `set_metadata()` and read via `get_metadata()` / `get_subscription_label()`. Metadata is stored separately from the core subscription record.

Source: `contract/src/subscription_metadata.rs`, `DataKey::SubscriptionMeta(user)`.

### Subscriber
A user address that owns a subscription record and may authorize one-time or recurring spend operations. Subscriber identity is used as the primary key for subscription storage and charge history. Many functions take a `user: Address` parameter representing the subscriber.

Source: `docs/API.md` (parameter naming), `contract/src/lib.rs` (`Subscription(Address)` keys).

## T

### Trial Duration / Trial Period
A subscriber-specific optional delay before the first recurring charge after subscription creation. It is specified during subscription calls and used to compute trial end time. The end timestamp is exposed via `get_trial_end()`.

Source: `contract/src/trial.rs`, `Subscription.trial_duration`, `get_trial_end()`.

## U

### TTL (Time-To-Live)
A storage lifetime mechanism used for temporary entries (e.g., daily limits) and for refreshing persistent entries. The contract relies on TTL behavior to automatically expire daily limit configuration and spend counters. Some persistent entries are refreshed via TTL extensions.

Source: docs in `docs/API.md` and `contract/src/storage.rs`.

## W

### Whitelist Enabled
A global toggle enabling merchant whitelist checks during subscription creation and/or charge eligibility. When enabled, merchants must be present in the whitelist to accept subscriptions. It is stored in instance storage and exposed via `set_whitelist_enabled()` / `is_whitelist_enabled()`.

Source: `contract/src/whitelist.rs`, `DataKey::WhitelistEnabled`.

### Whitelisted Merchant
A merchant address allowed to participate when the whitelist is enabled. Whitelist membership is updated via `add_merchant()` and `remove_merchant()`. Charge eligibility may fail if the merchant is not whitelisted.

Source: `contract/src/whitelist.rs`, `DataKey::MerchantWhitelist(merchant)`.

