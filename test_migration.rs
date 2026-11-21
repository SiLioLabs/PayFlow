use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionV1 {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub last_charged: u64,
    pub active: bool,
    pub token: Address,
    pub referrer: Option<Address>,
    pub label: Symbol,
    pub trial_duration: u64,
}
