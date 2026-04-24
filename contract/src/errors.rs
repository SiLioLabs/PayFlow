use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    AmountMustBePositive = 2,
    IntervalMustBePositive = 3,
    NoSubscriptionFound = 4,
    SubscriptionInactive = 5,
    IntervalNotElapsed = 6,
    NotInitialized = 7,
    InsufficientAllowance = 8,
}
