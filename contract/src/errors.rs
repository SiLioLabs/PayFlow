use soroban_sdk::contracterror;

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
    GlobalVolumeExceeded = 28,
    /// Returned when a configured batch limit is invalid
    InvalidBatchSize = 29,
    ContractPausedError = 30,
    /// Returned when a provided recipient address is invalid (e.g., contract address)
    InvalidRecipient = 32,
    /// Returned when a configured global volume cap is not positive
    InvalidVolumeCap = 33,
    /// Returned when configured fee bounds are inconsistent (min > max, or max > 10000)
    InvalidFeeBounds = 34,
    /// Returned when resume is called on a subscription whose grace period has elapsed.
    /// Cancel is still allowed; re-subscribe outside this flow to reactivate.
    ResumeGraceLapsed = 100,
    /// Returned when a pending fee proposal violates the current fee bounds at commit time
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
}
