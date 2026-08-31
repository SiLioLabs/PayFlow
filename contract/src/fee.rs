use soroban_sdk::{token, Address, Env};

use crate::validation;
use crate::{errors::ContractError, DataKey, Subscription};

/// Retrieves the fee collector address from instance storage.
pub fn get_fee_collector(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::FeeCollector)
}

/// Retrieves the fee in basis points (bps) from instance storage.
/// 1 bps = 0.01%
pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
}

/// Stores a custom fee recipient address for a specific merchant.
pub fn set_merchant_fee_recipient(env: &Env, merchant: &Address, recipient: &Address) {
    merchant.require_auth();
    if recipient == &env.current_contract_address() {
        env.panic_with_error(ContractError::InvalidRecipient);
    }
    env.storage()
        .persistent()
        .set(&DataKey::MerchantFeeRecipient(merchant.clone()), recipient);
    crate::events::publish_merchant_fee_recipient_set(env, merchant, recipient);
}

/// Reads the custom fee recipient for a merchant if set.
pub fn get_merchant_fee_recipient(env: &Env, merchant: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantFeeRecipient(merchant.clone()))
}

/// Clears the custom fee recipient for a merchant if configured, emitting an event.
pub fn clear_merchant_fee_recipient(env: &Env, merchant: &Address) {
    let key = DataKey::MerchantFeeRecipient(merchant.clone());
    if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
        crate::events::publish_merchant_fee_recipient_cleared(env, merchant);
    }
}


/// Proposes a new fee collector and basis points.
pub fn propose_fee(env: &Env, collector: Address, bps: u32) {
    if bps > 10_000 {
        env.panic_with_error(ContractError::InvalidFeeBps);
    }
    if collector == env.current_contract_address() {
        env.panic_with_error(ContractError::InvalidFeeCollector);
    }

    let pending = (collector.clone(), bps);
    env.storage()
        .temporary()
        .set(&DataKey::PendingFee, &pending);
    env.storage()
        .temporary()
        .extend_ttl(&DataKey::PendingFee, 17280, 17280);
    crate::events::publish_fee_proposed(env, &collector, bps);
}

/// Commits a pending fee proposal.
///
/// Re-validates the pending bps against the current fee bounds
/// (MinFeeBps / MaxFeeBps) before committing. If the admin tightened
/// or widened bounds between propose and commit, the commit is rejected
/// rather than silently applying an out-of-range value.
pub fn commit_fee(env: &Env) {
    let pending: (Address, u32) = env
        .storage()
        .temporary()
        .get(&DataKey::PendingFee)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoPendingProposal));

    let min_bps: u32 = env
        .storage()
        .instance()
        .get(&DataKey::MinFeeBps)
        .unwrap_or(0);
    let max_bps: u32 = env
        .storage()
        .instance()
        .get(&DataKey::MaxFeeBps)
        .unwrap_or(10_000);

    if pending.1 < min_bps || pending.1 > max_bps {
        env.panic_with_error(ContractError::FeeOutOfBoundsAtCommit);
    }

    env.storage().temporary().remove(&DataKey::PendingFee);
    env.storage()
        .instance()
        .set(&DataKey::FeeCollector, &pending.0);
    env.storage().instance().set(&DataKey::FeeBps, &pending.1);
    crate::events::publish_fee_committed(env, &pending.0, pending.1);
}

/// Clears the fee settings, removing both collector and bps from storage.
pub fn clear_fee(env: &Env) {
    env.storage().instance().remove(&DataKey::FeeCollector);
    env.storage().instance().remove(&DataKey::FeeBps);
}

/// Computes the protocol fee for `amount` using configured bps (0 when unset).
///
/// `amount * bps` is the one multiplication in the fee path that can leave
/// i128 range for amounts near the economic caps, so it is checked and fails
/// closed with `ArithmeticOverflow` instead of wrapping or string-panicking.
///
/// ### Rounding Rule
/// Integer division in Rust rounds toward zero (truncation). Since the product of `amount`
/// and `bps` is positive, the calculated fee is rounded down (truncated). The remaining
/// net amount is calculated as `net = amount - fee`, which ensures exact conservation:
/// `fee + net == amount` for all possible inputs, with no dust lost.
pub fn calculate_fee_amount(env: &Env, amount: i128, bps: u32) -> i128 {
    if bps == 0 || amount <= 0 {
        return 0;
    }
    amount
        .checked_mul(bps as i128)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow))
        / 10_000
}

/// Returns the cumulative protocol fees collected across all merchants.
pub fn get_total_protocol_fees(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalProtocolFees)
        .unwrap_or(0)
}

/// Adds `amount` to the cumulative protocol fee total.
fn accumulate_protocol_fees(env: &Env, amount: i128) {
    if amount <= 0 {
        return;
    }
    let total = get_total_protocol_fees(env)
        .checked_add(amount)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));
    env.storage()
        .instance()
        .set(&DataKey::TotalProtocolFees, &total);
}

// ─────────────────────────────────────────────────────────────
// Auditor note: the two-leg transfer model
// ─────────────────────────────────────────────────────────────
//
// When a protocol fee is configured, the helpers below pull funds from the
// payer in TWO `transfer_from` legs against the SAME allowance:
//
//   leg 1: user -> fee collector   (fee  = gross * bps / 10_000)
//   leg 2: user -> merchant        (net  = gross - fee)
//
// Invariant: `allowance >= gross` (the sum of both legs) is asserted ONCE,
// up front, before either leg runs. `fee + net == gross` by construction, so
// a passing preflight covers both legs; there is no window in which leg 1
// succeeds against an allowance that cannot also cover leg 2.
//
// Atomicity: Soroban aborts the whole invocation on any host error, so a
// failing leg 2 rolls back leg 1 and the `TotalProtocolFees` bump together —
// the ledger never observes a half-applied charge. The preflight therefore
// does not add safety the host lacks; it makes the invariant explicit and
// converts a token-contract error into the typed `InsufficientAllowance`
// (error #8) that clients and alerting already map.

/// Transfers subscription charge amounts (fee to collector/merchant fee recipient, net to merchant).
/// Returns the fee amount deducted from the gross subscription amount.
///
/// Panics with `InsufficientAllowance` when the contract's allowance over
/// `user`'s tokens is below the **gross** `sub.amount`, before any transfer runs.
pub fn transfer_subscription_charge(env: &Env, user: &Address, sub: &Subscription) -> i128 {
    // Preflight: one allowance check covering both legs (fee + net == gross).
    validation::check_allowance(env, user, &sub.token, sub.amount);

    let bps = get_fee_bps(env);
    let fee_collector = get_merchant_fee_recipient(env, &sub.merchant)
        .or_else(|| get_fee_collector(env));

    let fee_amount = match fee_collector {
        Some(collector) if bps > 0 => {
            let fee = calculate_fee_amount(env, sub.amount, bps);
            if fee > 0 {
                let token_client = token::Client::new(env, &sub.token);
                token_client.transfer_from(&env.current_contract_address(), user, &collector, &fee);
                accumulate_protocol_fees(env, fee);
            }
            fee
        }
        _ => 0,
    };
    let net = sub
        .amount
        .checked_sub(fee_amount)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));

    let token_client = token::Client::new(env, &sub.token);
    token_client.transfer_from(&env.current_contract_address(), user, &sub.merchant, &net);

    fee_amount
}

/// Transfers a pay-per-use amount (fee to collector/merchant fee recipient, net to `recipient`).
/// Returns the fee amount deducted from the gross amount.
///
/// Panics with `InsufficientAllowance` when the contract's allowance over
/// `user`'s tokens is below the **gross** `amount`, before any transfer runs.
/// See the two-leg atomicity note above.
pub fn transfer_pay_per_use(
    env: &Env,
    user: &Address,
    token: &Address,
    amount: i128,
    recipient: &Address,
) -> i128 {
    // Preflight: one allowance check covering both legs (fee + net == gross).
    validation::check_allowance(env, user, token, amount);

    let bps = get_fee_bps(env);
    let fee_collector = get_merchant_fee_recipient(env, recipient)
        .or_else(|| get_fee_collector(env));

    let fee_amount = match fee_collector {
        Some(collector) if bps > 0 => {
            let fee = calculate_fee_amount(env, amount, bps);
            if fee > 0 {
                let token_client = token::Client::new(env, token);
                token_client.transfer_from(&env.current_contract_address(), user, &collector, &fee);
                accumulate_protocol_fees(env, fee);
            }
            fee
        }
        _ => 0,
    };
    let net = amount
        .checked_sub(fee_amount)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));

    let token_client = token::Client::new(env, token);
    token_client.transfer_from(&env.current_contract_address(), user, recipient, &net);

    fee_amount
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_conservation_properties() {
        let env = Env::default();
        // Test combinations of amount and bps
        let amounts = [
            0, 1, 2, 9, 10, 99, 100, 101, 1000, 10000, 1234567, 10_000_000,
        ];
        let bps_values = [
            0, 1, 5, 10, 50, 100, 500, 1000, 5000, 9999, 10000,
        ];

        for &amount in amounts.iter() {
            for &bps in bps_values.iter() {
                let fee = calculate_fee_amount(&env, amount, bps);
                let net = amount - fee;

                // 1. Assert conservation
                assert_eq!(
                    fee + net,
                    amount,
                    "Conservation failed for amount={} and bps={}",
                    amount,
                    bps
                );

                // 2. Assert non-negative parts
                assert!(fee >= 0, "Fee is negative: {} for amount={}, bps={}", fee, amount, bps);
                assert!(net >= 0, "Net is negative: {} for amount={}, bps={}", net, amount, bps);

                // 3. Assert fee limits
                if bps == 0 {
                    assert_eq!(fee, 0);
                } else if bps == 10000 {
                    assert_eq!(fee, amount);
                    assert_eq!(net, 0);
                } else {
                    assert!(fee <= amount);
                }
            }
        }
    }
}
