use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
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
    /// Returned when the metadata label exceeds the 64-byte length limit
    MetadataLabelTooLong = 11,
}
