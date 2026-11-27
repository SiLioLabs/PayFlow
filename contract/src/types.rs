//! Shared data types for the FlowPay contract (issue #1398).
//!
//! All `#[contracttype]` structs and the `DataKey` storage enum that were
//! previously inlined in `lib.rs` live here. `lib.rs` re-exports everything
//! so the public ABI is unchanged.
//!
//! Adding a new `DataKey` variant: append it at the end of the enum to
//! preserve the established XDR discriminant ordering.

use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

// ─────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────

// Internal storage keys only, never passed across the contract boundary, so
// they are kept out of the exported spec. Soroban caps exported unions at 50
// cases and `DataKey` is past that; `export = false` leaves the on-ledger key
// encoding unchanged.
#[contracttype(export = false)]
#[derive(Clone)]
pub enum DataKey {
    Subscription(Address),
    Token,
    // Admin
    Admin,
    // Grace period
    GracePeriod,
    // Merchant whitelist
    MerchantWhitelist(Address),
    WhitelistEnabled,
    WhitelistIndex(u32),
    WhitelistIndexSize,
    // Reverse lookup of a merchant's whitelist slot, used for O(1) removal
    WhitelistIndexSlot(Address),
    // Merchant freeze: blocks new subscriptions, independent of whitelist status
    MerchantFrozen(Address),
    MerchantFreezeReason(Address),
    // Protocol fee
    FeeCollector,
    FeeBps,
    // Feature: subscription count
    ActiveCount,
    // Feature: merchant revenue stats
    MerchantRevenue(Address),
    // Per-day merchant revenue buckets (keyed by Unix day)
    MerchantRevenueDay(Address, u64),
    // Index of which days have revenue buckets for a merchant
    MerchantRevenueDayIndex(Address),
    // Feature: daily spending limits (temporary storage)
    DailyLimit(Address),
    DailySpent(Address),
    DayStart(Address),
    // Feature: referral tracking
    Referral(Address),
    // Feature: state migration
    SchemaVersion,
    // Feature: subscription metadata labels
    SubscriptionMeta(Address),
    // Feature: charge history
    ChargeHistory(Address),
    // Feature: global volume cap
    GlobalVolumeWindow,
    // Feature: batch size limit override
    MaxBatchSize,
    // Feature: contract pause
    ContractPaused,
    // Feature: minimum subscription interval floor
    MinInterval,
    // Feature: consolidated merchant revenue history (Vec<i128>)
    MerchantRevenueHistory(Address),
    // Feature: subscriber index (append-only log)
    SubscriberIndex(u64),
    SubscriberIndexSize,
    // Reverse lookup of a subscriber's slot, used to prune on cancel
    SubscriberIndexSlot(Address),
    // Tombstone marking a pruned (cancelled) subscriber index slot
    SubscriberIndexRemoved(u64),
    // Feature: per-merchant subscriber count
    MerchantSubCount(Address),
    // Feature: merchant index for governance/ranking
    MerchantIndex(u32),
    MerchantIndexSize,
    MerchantKnown(Address),
    // Pending admin for two-step transfer
    PendingAdmin,
    // Two-step auth for protocol fee
    PendingFee,
    // Per-merchant custom fee recipient (merchant -> destination)
    MerchantFeeRecipient(Address),
    // Two-step auth for grace period
    PendingGracePeriod,
    // Two-step auth for upgrade
    PendingUpgrade,
    // Feature: pause expiry (bounded pause with auto-resume)
    PauseExpiry(Address),
    // Feature: cumulative protocol fees collected across all merchants
    TotalProtocolFees,
    // Feature: configurable global hourly volume cap override
    GlobalVolumeCapOverride,
    // Feature: configurable min/max fee bps bounds
    MinFeeBps,
    MaxFeeBps,
    // Feature: configurable whitelist batch size limit override
    MaxWhitelistBatchSize,
    // Feature: counter for merchants with pending (unwithdrawn) revenue > 0
    PendingMerchantRevCount,
    // Feature: per-user billing extras (last charge snapshot + last skip)
    BillingState(Address),
    // Feature: keeper tip, in bps of the protocol fee paid to a `charge_with_tip` caller
    KeeperTipBps,
    // Feature: paged schema migration. Per-account marker set once `migrate` has
    // processed that account, so re-sending a batch never migrates it twice.
    MigratedAccount(Address),
    // Feature: number of accounts processed by `migrate` in the current upgrade
    MigratedAccountCount,
    // New keys are appended to preserve the established DataKey discriminants.
    Operator,
    MerchantFeeBps(Address),
    ReferralReward(Address, Address),
    ReferralRewardChargeCount(Address),
    ReferralRewardBps,
    ReferralRewardMaxCharges,
    // Feature: admin-configurable maximum pause duration in seconds (0 = unlimited)
    MaxPauseSeconds,
    // Feature: per-merchant subscriber index for O(1) lookup and paginated listing
    MerchantSubIndex(Address, u64),
    MerchantSubIndexSlot(Address, Address),
    MerchantSubIndexSize(Address),
    // Feature: fixed-term subscription end conditions (max_cycles / end_at)
    SubscriptionTerms(Address),
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

pub const SUBSCRIPTION_TTL_LEDGERS: u32 = 6307200; // ~1 year (assuming 5s blocks)

/// TTL for merchant state keys (revenue, per-day buckets, revenue history,
/// subscriber counts, whitelist entries, freeze markers, merchant index):
/// ~90 days at 5 s/ledgers.
///
/// Deliberately shorter than [`SUBSCRIPTION_TTL_LEDGERS`] (~1 year): the
/// subscription that produced the revenue outlives the merchant's analytics
/// keys. The 90-day vs 1-year mismatch is intended — merchant state is a
/// derived, recomputable cache tied to the merchant's lifetime, while the
/// subscription is the source of truth and must persist for the full billing
/// cycle. If this value is ever retuned, every writer below must change with
/// it; it is not a separate runtime knob. See docs/architecture/STORAGE-AND-TTL.md.
pub const MERCHANT_STATE_TTL_LEDGERS: u32 = 1_555_200; // ~90 days (assuming 5s blocks)

pub use crate::caps::{
    MAX_BATCH_PAUSE_SUBSCRIPTIONS, MAX_BATCH_SIZE_CEILING, MAX_MERCHANT_SUB_COUNT_BATCH,
    MAX_WHITELIST_BATCH_SIZE, REVENUE_DAY_PAGE_SIZE, SUBSCRIBER_PAGE_SIZE, TOP_MERCHANTS_PAGE_SIZE,
};

/// The default cap for the admin batch charge/extend entrypoints, sourced from
/// [`crate::caps::DEFAULT_BATCH_SIZE`] so there is exactly one place to change it.
pub use crate::caps::DEFAULT_BATCH_SIZE as MAX_BATCH_SIZE;
pub const GLOBAL_MAX_VOLUME_PER_HOUR: i128 = 50_000_000_000_000; // 50 trillion stroops
pub const HOUR_IN_SECONDS: u64 = 3600;
pub const MAX_AMOUNT: i128 = 100_000_000_000;
pub const MAX_SUBSCRIPTION_AMOUNT: i128 = 100_000_000_000_000;
/// Maximum permitted subscription billing interval in seconds (400 years).
///
/// Rationale: `last_charged + interval` and `last_charged + interval + grace_period`
/// are `u64` additions. An interval near `u64::MAX` wraps those expressions,
/// causing every charge call for that subscription to abort. Inside `batch_charge`
/// that abort was historically transaction-wide (a self-inflicted DoS). Even after
/// per-user abort isolation the keeper cannot collect from such a subscription,
/// making it an operational hazard.
///
/// 400 years (≈ 12 623 040 000 s) is far beyond any real billing cycle and keeps
/// all timestamp arithmetic safely within the representable `u64` range for any
/// foreseeable ledger timestamp. Mirrors the `MAX_SUBSCRIPTION_AMOUNT` precedent.
pub const MAX_SUBSCRIPTION_INTERVAL: u64 = 12_623_040_000; // 400 years in seconds

// ─────────────────────────────────────────────────────────────
// Contract data types
// ─────────────────────────────────────────────────────────────

/// A recurring subscription record stored per subscriber.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Subscription {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub last_charged: u64,
    pub active: bool,
    pub paused: bool,              // true if paused, false otherwise
    pub token: Address,            // SAC token used for this subscription
    pub referrer: Option<Address>, // optional referral address
    pub label: Symbol,             // user-assigned label for this subscription
    pub trial_duration: u64,       // optional trial duration in seconds
    pub created_at: u64,           // timestamp of subscription creation
}

/// Optional end conditions for a fixed-term subscription (issue #1400).
///
/// Stored under `DataKey::SubscriptionTerms(user)` rather than as fields on
/// [`Subscription`], so subscription records written by earlier contract
/// versions keep decoding without a schema migration. A subscriber with no
/// terms entry has an open-ended subscription.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubscriptionTerms {
    /// Maximum number of scheduled charges. When `charges_made` reaches it, the
    /// charge that got there deactivates the subscription and emits
    /// `subscription_completed`. `None` means no cycle limit.
    pub max_cycles: Option<u32>,
    /// Hard end timestamp (Unix seconds). Charges after it are rejected; a
    /// charge at or after it deactivates the subscription. `None` means no end date.
    pub end_at: Option<u64>,
    /// Scheduled charges collected since these terms were set.
    pub charges_made: u32,
}

/// Snapshot of the most recent scheduled charge, used by
/// `refund_last_charge` to reverse the merchant's revenue and the protocol's
/// fee accounting by exactly the amounts booked at charge time.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct LastChargeRecord {
    /// Merchant that received the charge's net leg.
    pub merchant: Address,
    /// SAC token used for that charge (guards a resubscribe under a new token).
    pub token: Address,
    /// Gross amount moved from the subscriber.
    pub amount: i128,
    /// Protocol fee booked for that charge (0 when no fee was configured).
    pub fee: i128,
    /// Amount added to the merchant's revenue for that charge.
    pub net: i128,
    /// Ledger timestamp at which the charge executed.
    pub charged_at: u64,
}

/// One per-subscriber storage key in the rent footprint returned by
/// `get_storage_footprint`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StorageEntryFootprint {
    /// Short name of the per-user key (e.g. `subscription`, `referral`).
    pub key: Symbol,
    /// Whether the entry currently exists in storage.
    pub present: bool,
    /// Remaining TTL in ledgers. Real value under `cfg(test)` / the
    /// `testutils` feature; always `0` in production because Soroban does not
    /// expose `get_ttl()` on-chain. `0` must not be read as "expired".
    pub ttl_ledgers: u32,
}

/// Per-subscriber auxiliary billing state, stored under a single key so the
/// `DataKey` enum stays within Soroban's 50-variant XDR limit.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BillingState {
    /// Most recent scheduled charge, flattened. `last_charge_merchant` is
    /// `Some` exactly when a charge snapshot exists; the other fields are then
    /// meaningful. Flattening avoids `Option<LastChargeRecord>`, which the
    /// contracttype macro cannot encode as a nested struct option.
    pub last_charge_merchant: Option<Address>,
    pub last_charge_token: Option<Address>,
    pub last_charge_amount: i128,
    pub last_charge_fee: i128,
    pub last_charge_net: i128,
    pub last_charge_at: u64,
    /// Timestamp of the last `skip_next_charge` call (cooldown guard).
    pub last_skip_at: Option<u64>,
}

/// Rent-estimation helper result: every per-subscriber key the contract can
/// create, with presence flags and (in test builds) TTLs.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StorageFootprint {
    pub entries: Vec<StorageEntryFootprint>,
}

/// Composite health report for a subscriber's subscription.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionHealth {
    pub active: bool,
    pub charge_due: bool,
    pub within_grace: bool,
    pub has_sufficient_allowance: bool,
    pub is_paused: bool,
    pub trial_active: bool,
    pub daily_limit_set: bool,
    /// Remaining charges before the subscription auto-completes. `None` when
    /// `max_cycles` is not set (open-ended subscription). `Some(0)` means the
    /// subscription will deactivate on the next successful charge.
    pub remaining_cycles: Option<u32>,
}

/// Status of the caller's daily spending cap for `pay_per_use`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DailyLimitStatus {
    pub limit: Option<i128>,
    pub spent: i128,
    pub day_start: Option<u64>,
    pub remaining: Option<i128>,
}

/// Contract-wide health snapshot returned by `contract_health_check`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct HealthReport {
    pub is_healthy: bool,
    pub contract_paused: bool,
    pub token_configured: bool,
    pub admin_configured: bool,
    /// Placeholder TTL field. On-chain this is a hardcoded `100_000` because
    /// Soroban does not expose `get_ttl()` outside test builds. Test/testutils
    /// builds report the real instance TTL. Not an input to `is_healthy`.
    pub instance_ttl_ledgers: u32,
    pub active_subscription_count: u64,
    pub schema_version: u32,
    pub fee_collector_set: bool,
    pub global_volume_utilization_pct: u32,
    /// Number of merchants with unwithdrawn revenue > 0.
    pub pending_merchant_rev_count: u32,
}

/// Current global hourly volume accumulator window.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GlobalVolumeWindow {
    pub current_window_start: u64,
    pub accumulated_volume: i128,
}

/// Aggregate protocol-wide statistics snapshot.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ProtocolStats {
    pub active_count: u64,
    pub fee_bps: u32,
    pub fee_collector: Option<Address>,
    pub grace_period: u64,
    pub whitelist_enabled: bool,
    pub schema_version: u32,
    pub contract_paused: bool,
}

/// Full configuration snapshot returned by `get_contract_config`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractConfig {
    pub fee_bps: u32,
    pub fee_collector: Option<Address>,
    pub grace_period: u64,
    pub min_interval: u64,
    pub max_batch_size: u32,
    pub global_volume_cap: i128,
    pub whitelist_enabled: bool,
    pub paused: bool,
    pub schema_version: u32,
    /// Maximum duration of a pause in seconds. 0 means unlimited (default;
    /// preserves pre-feature behavior). Set via `set_max_pause_seconds`.
    pub max_pause_seconds: u64,
}

// ─────────────────────────────────────────────────────────────
// Env-free helpers used by multiple modules
// ─────────────────────────────────────────────────────────────

/// Returns `true` when `sub` is in a fully cancelled state (not just paused).
///
/// A paused subscription — indefinite (`pause`) or bounded (`pause_until`) —
/// keeps `active == true`; pausing never deactivates a subscription. Since
/// issue #1009 the `paused && !active` combination is a **legacy** state only.
pub fn is_subscription_cancelled(sub: &Subscription) -> bool {
    !sub.active && !sub.paused
}

/// Helper used by `get_storage_footprint` for persistent-key TTL reporting.
/// Production builds always return `0`; test/testutils builds report the real TTL.
#[cfg(any(test, feature = "testutils"))]
pub fn persistent_key_ttl(env: &Env, key: &DataKey) -> u32 {
    use soroban_sdk::testutils::storage::Persistent;
    if env.storage().persistent().has(key) {
        env.storage().persistent().get_ttl(key)
    } else {
        0
    }
}

#[cfg(not(any(test, feature = "testutils")))]
pub fn persistent_key_ttl(_env: &Env, _key: &DataKey) -> u32 {
    0
}
