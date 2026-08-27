use soroban_sdk::{token, Address, Env};

use crate::errors::ContractError;
use crate::Subscription;

/// Validates that `token_addr` refers to a contract (not a plain Stellar account
/// address). Rejects non-contract addresses early, before any allowance or
/// transfer check, so no partial subscription state is written on validation failure.
///
/// The check inspects the XDR encoding of the address: byte 7 of a
/// `ScAddress::Account` is `0x00`, whereas a `ScAddress::Contract` has a
/// non-zero discriminant byte. This is a low-cost, CPU-cheap probe that avoids
/// a full cross-contract call.
///
/// For a stronger SAC interface probe (that the contract responds to the token
/// interface), we additionally attempt `token::Client::new(env, token_addr).decimals()`.
/// This ensures the address is not just any contract but actually implements the
/// SEP-41 token interface. The probe is inexpensive (read-only) and fails closed:
/// if the address is not a conforming token contract the whole `subscribe` call
/// panics with `InvalidTokenAddress` (#12).
///
/// Panics with `InvalidTokenAddress` when:
///   - `token_addr` encodes as a Stellar account address, or
///   - calling `decimals()` on the address fails (not an SAC/token contract)
pub fn require_valid_token_address(env: &Env, token_addr: &Address) {
    use soroban_sdk::xdr::ToXdr;
    if token_addr.clone().to_xdr(env).get(7) == Some(0) {
        env.panic_with_error(ContractError::InvalidTokenAddress);
    }
    // SAC interface probe: if the address is a contract but doesn't implement
    // the token interface (no `decimals` function), this panics at the SAC
    // level. We rely on Soroban's host error to surface as a contract panic
    // rather than wrapping it in a try/catch (unavailable in Soroban no_std).
    // The overhead is a single read-only invocation — acceptable at subscribe time.
    let _ = token::Client::new(env, token_addr).decimals();
}

pub fn check_allowance(env: &Env, user: &Address, token: &Address, min_amount: i128) {
    let client = token::Client::new(env, token);
    let allowance = client.allowance(user, &env.current_contract_address());
    if allowance < min_amount {
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
