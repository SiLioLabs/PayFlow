use soroban_sdk::{token, Address, Env};

use crate::errors::ContractError;
use crate::Subscription;

/// Required SAC allowance for a subscribe or charge of `gross`.
///
/// Always `gross`, whether protocol fees are off (`fee_bps == 0`, one
/// `transfer_from` of the full amount) or on (`fee_bps > 0`, two legs that
/// still sum to `gross`). Callers must never substitute the net amount.
///
/// This helper does not perform transfers. `fee_bps` is part of the API so
/// tests and call sites pass the configured fee explicitly; it does not
/// reduce the requirement.
pub fn required_allowance(gross: i128, _fee_bps: u32) -> i128 {
    gross
}

/// Returns whether `allowance` is enough to cover a subscribe/charge of `gross`.
/// Does not perform transfers. See [`required_allowance`] for fee handling.
pub fn allowance_covers_gross(allowance: i128, gross: i128, fee_bps: u32) -> bool {
    allowance >= required_allowance(gross, fee_bps)
}

/// Reads `user`'s SAC allowance for this contract and returns whether it
/// covers `gross`. Does not perform transfers.
pub fn has_sufficient_allowance(env: &Env, user: &Address, token: &Address, gross: i128) -> bool {
    let client = token::Client::new(env, token);
    let allowance = client.allowance(user, &env.current_contract_address());
    // `fee_bps` does not change the required amount; pass 0 to avoid an
    // extra instance-storage read on the hot path.
    allowance_covers_gross(allowance, gross, 0)
}

pub fn check_allowance(env: &Env, user: &Address, token: &Address, min_amount: i128) {
    if !has_sufficient_allowance(env, user, token, min_amount) {
        env.panic_with_error(ContractError::InsufficientAllowance);
    }
}

/// Composable helper that asserts a subscription is ready to be used:
/// the subscription must be active and the user must have sufficient
/// allowance for the subscription's token and amount.
#[allow(dead_code)]
pub fn validate_subscription_readiness(env: &Env, user: &Address, sub: &Subscription) {
    if !sub.active {
        env.panic_with_error(ContractError::SubscriptionNotActive);
    }
    check_allowance(env, user, &sub.token, sub.amount);
}

pub fn require_valid_amount(env: &Env, new_amount: i128) {
    if new_amount <= 0 {
        env.panic_with_error(ContractError::AmountMustBePositive);
    }
    if new_amount > crate::MAX_SUBSCRIPTION_AMOUNT {
        env.panic_with_error(ContractError::AmountExceedsMaximum);
    }
}

pub fn require_valid_interval(env: &Env, new_interval: u64) {
    validate_interval(env, new_interval);
}

pub fn validate_interval(env: &Env, interval: u64) {
    if interval == 0 {
        env.panic_with_error(ContractError::IntervalMustBePositive);
    }
    if interval < crate::min_interval::get_min_interval(env) {
        env.panic_with_error(ContractError::IntervalTooShort);
    }
}

#[allow(dead_code)]
pub fn require_positive_interval(env: &Env, interval: u64) {
    if interval == 0 {
        env.panic_with_error(ContractError::IntervalMustBePositive);
    }
}

#[allow(dead_code)]
pub fn require_active_subscription(env: &Env, active: bool) {
    if !active {
        env.panic_with_error(ContractError::SubscriptionInactive);
    }
}

#[allow(dead_code)]
pub fn require_charge_interval_elapsed(env: &Env, now: u64, last_charged: u64, interval: u64) {
    if now < last_charged + interval {
        env.panic_with_error(ContractError::IntervalNotElapsed);
    }
}

pub fn require_valid_transfer_targets(env: &Env, user: &Address, new_user: &Address) {
    if user == new_user {
        env.panic_with_error(ContractError::InvalidRecipient);
    }
    if user == &env.current_contract_address() || new_user == &env.current_contract_address() {
        env.panic_with_error(ContractError::InvalidRecipient);
    }
}

pub fn require_valid_subscribe_addresses(env: &Env, user: &Address, merchant: &Address) {
    if user == merchant {
        env.panic_with_error(ContractError::InvalidRecipient);
    }
    if user == &env.current_contract_address() || merchant == &env.current_contract_address() {
        env.panic_with_error(ContractError::InvalidRecipient);
    }
}

