use soroban_sdk::contracterror;

/// Canonical contract error catalog: the numeric codes below are the wire
/// contract, and `frontend/src/utils/errors.ts` maps each one to a
/// customer-facing message. `frontend/src/utils/errors.test.ts` parses this file
/// and fails if a code is missing from that map, duplicated in it, or mapped to
/// two different messages, so a new or retired variant has to be carried over to
/// the frontend in the same change.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Returned when `initialize` is called after the default token is already stored.
    /// Deploy scripts (`deploy-pipeline.ts`, `testnet-setup.ts`) map this typed
    /// code rather than a host string panic.
    AlreadyInitialized = 1,
    /// Returned when a payment or subscription amount is not positive
    AmountMustBePositive = 2,
    /// Returned when a subscription interval is not positive
    IntervalMustBePositive = 3,
    /// Returned when no subscription exists for a given user and token
    NoSubscriptionFound = 4,
    /// Returned when attempting to charge an inactive subscription
    SubscriptionInactive = 5,
    /// Returned when attempting to charge before the interval has elapsed
    IntervalNotElapsed = 6,
    /// Returned when attempting to use contract functionality before initialization
    NotInitialized = 7,
    /// Returned when the user has insufficient token allowance for payment
    InsufficientAllowance = 8,
    /// Returned when the grace period for a subscription has elapsed
    GracePeriodElapsed = 9,
    /// Returned when a merchant is not whitelisted
    MerchantNotWhitelisted = 10,
    /// Returned when a user attempts to refer themselves
    SelfReferral = 11,
    /// Returned when the token address is not a contract
    InvalidTokenAddress = 12,
    /// Returned when fee basis points exceed 10000
    InvalidFeeBps = 13,
    /// Returned when the metadata label exceeds the 64-byte length limit
    MetadataLabelTooLong = 14,
    /// Returned when a payment amount is greater than the configured maximum
    AmountExceedsMaximum = 15,
    /// Returned when attempting to operate on a subscription that is not active
    SubscriptionNotActive = 16,
    /// Returned when attempting to operate on a subscription that is paused
    SubscriptionPaused = 17,
    /// Returned when the contract has been paused by admin
    ContractPaused = 18,
    /// Returned when a subscription interval is below the minimum permitted floor
    IntervalTooShort = 19,
    /// Returned when the batch size exceeds the maximum allowed
    BatchTooLarge = 20,
    /// Returned when a merchant attempts to withdraw with no accrued revenue
    ZeroBalanceAvailable = 21,
    /// Returned when attempting to subscribe to a frozen merchant
    MerchantFrozen = 22,
    /// Returned when a two-step commit is attempted without a pending proposal
    NoPendingProposal = 23,
    /// Returned when attempting to transfer to an address that already has an active subscription
    SubscriptionAlreadyActive = 24,
    /// Returned when a pay_per_use call would exceed the user's daily spending limit
    DailyLimitExceeded = 25,
    /// Returned when the fee collector address is invalid (e.g. the contract's own address)
    InvalidFeeCollector = 26,
    /// Returned when pause_until expiry_timestamp is not strictly in the future
    InvalidPauseExpiry = 27,
    /// Returned when the configured global volume cap is exceeded.
    GlobalVolumeExceeded = 28,
    /// Returned when a configured batch limit is invalid.
    InvalidBatchSize = 29,
    /// Deprecated alias retained for clients that published code 30.
    /// New contract pause checks use `ContractPaused` (code 18).
    #[deprecated(note = "use ContractPaused; code 30 is retained for wire compatibility")]
    ContractPausedError = 30,
    /// Reserved for the historical error-code gap. It is intentionally not
    /// emitted by the current contract; retaining it documents the stable wire map.
    #[deprecated(note = "code 31 is reserved and must not be emitted")]
    Reserved31 = 31,
    /// Returned when a provided recipient address is invalid (e.g., contract address).
    InvalidRecipient = 32,
    /// Returned when a configured global volume cap is not positive
    InvalidVolumeCap = 33,
    /// Returned when configured fee bounds are inconsistent (min > max, or max > 10000)
    InvalidFeeBounds = 34,
    /// Returned when a pending fee proposal violates the current fee bounds at commit time.
    FeeOutOfBoundsAtCommit = 35,
    /// Returned when a checked arithmetic operation overflows (trial extension,
    /// fee calculation, protocol-fee accrual, or global volume accumulation)
    ArithmeticOverflow = 36,
    /// Returned when a refund is requested by a merchant different from the subscription merchant
    RefundMerchantMismatch = 38,
    /// Returned when prorated cancellation would produce no refund
    RefundAmountMustBePositive = 39,
    /// Returned when the merchant cannot fund the requested refund
    InsufficientMerchantBalance = 40,
    /// Returned when admin repair would tombstone an index slot whose
    /// subscriber still has an active subscription
    CannotClearActiveSubscriber = 41,
    /// Returned when a state-mutating operation is attempted before all
    /// storage entries required by the current WASM schema are migrated.
    SchemaMigrationRequired = 42,
    /// Returned when resume is attempted after the subscription grace period elapsed.
    ResumeGraceLapsed = 43,
    /// Returned when `set_initial_admin` is called after an admin has already
    /// been stored. Distinct from `AlreadyInitialized` (code 1), which guards
    /// `initialize` (token + admin together); this variant covers the narrow
    /// bootstrap path where only the admin slot is being set.
    AdminAlreadySet = 44,
    /// Returned when `accept_admin` is called without a staged admin transfer.
    /// Replaces the previous untrappable host panic so callers and the
    /// frontend error map can handle the no-pending-transfer case gracefully.
    NoPendingAdmin = 45,
    /// Returned when a subscription interval exceeds `MAX_SUBSCRIPTION_INTERVAL`.
    /// Prevents `last_charged + interval` and grace-period math from overflowing
    /// a `u64` timestamp. Subscriptions with an extreme legacy interval cannot
    /// be re-created; document such cases and re-subscribe with a valid interval.
    IntervalExceedsMaximum = 46,
    /// Returned when a merchant freeze reason exceeds the 128-byte length limit.
    FreezeReasonTooLong = 47,
    /// Returned when a trial extension exceeds `MAX_TRIAL_EXTENSION` or would
    /// push the trial end beyond `MAX_TOTAL_TRIAL` from the current ledger time.
    TrialExtensionExceedsMaximum = 48,
    /// Returned when `skip_next_charge` is called again before the cooldown of
    /// one full billing interval has elapsed since the previous skip.
    SkipCooldownActive = 49,
    /// Returned when `refund_last_charge` is called but no scheduled charge has
    /// been recorded for the subscriber (or the last one was already refunded).
    NoLastChargeToRefund = 50,
    /// Returned when `subscribe`/`subscribe_with_referral` requests a trial
    /// for a (user, merchant) pair that has already consumed its one trial.
    TrialAlreadyUsed = 51,
    /// Returned by `finalize_migration` while fewer accounts have been migrated
    /// than the operator-supplied total, so the schema version cannot be advanced.
    MigrationIncomplete = 52,
    /// Returned by `set_keeper_tip_bps` when the tip exceeds `MAX_KEEPER_TIP_BPS`.
    InvalidKeeperTipBps = 53,
    /// Returned when an admin transfer targets the current admin or this contract.
    InvalidAdminAddress = 54,
    InvalidAdminAddress = 48,
    /// Returned by `pay_per_use_with_nonce` when the (user, nonce) pair has
    /// already been recorded, rejecting a replayed retry without charging again.
    NonceAlreadyUsed = 51,
    /// Returned when `subscribe`/`subscribe_with_referral` requests a trial
    /// for a (user, merchant) pair that has already consumed its one trial.
    TrialAlreadyUsed = 52,
    InvalidAdminAddress = 52,
    /// Merchant fee override exceeds current configured protocol bounds.
    InvalidMerchantFeeBps = 50,
    /// Operator cannot be the contract itself.
    InvalidOperatorAddress = 51,
}
