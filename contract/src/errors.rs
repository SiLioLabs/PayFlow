use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Returned when attempting to initialize a contract that has already been initialized
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
    /// Returned when a merchant attempts to withdraw with no accrued revenue
    ZeroBalanceAvailable = 20,
    /// Returned when the batch size exceeds the maximum allowed (25)
    BatchSizeExceeded = 21,
    /// Returned when attempting to subscribe to a frozen merchant
    MerchantFrozen = 22,
    /// Returned when a two-step commit is attempted without a pending proposal
    NoPendingProposal = 23,
}
