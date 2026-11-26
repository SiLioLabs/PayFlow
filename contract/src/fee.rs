use soroban_sdk::{token, Address, Env};

use crate::validation;
use crate::{errors::ContractError, DataKey, Subscription, SUBSCRIPTION_TTL_LEDGERS};

/// Retrieves the fee collector address from instance storage.
pub fn get_fee_collector(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::FeeCollector)
}

/// Retrieves the fee in basis points (bps) from instance storage.
/// 1 bps = 0.01%
pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
}

/// Fee override for a merchant, or `None` to inherit the global rate.
pub fn get_merchant_fee_bps(env: &Env, merchant: &Address) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantFeeBps(merchant.clone()))
}

pub fn effective_fee_bps(env: &Env, merchant: &Address) -> u32 {
    get_merchant_fee_bps(env, merchant).unwrap_or_else(|| get_fee_bps(env))
}

pub fn set_merchant_fee_bps(env: &Env, merchant: &Address, bps: Option<u32>) {
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
    if bps.is_some_and(|rate| rate < min_bps || rate > max_bps) {
        env.panic_with_error(ContractError::InvalidMerchantFeeBps);
    }
    let key = DataKey::MerchantFeeBps(merchant.clone());
    if let Some(rate) = bps {
        env.storage().persistent().set(&key, &rate);
        env.storage().persistent().extend_ttl(
            &key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
    } else {
        env.storage().persistent().remove(&key);
    }
    crate::events::publish_merchant_fee_bps_set(env, merchant, bps);
}

/// Stores a custom fee recipient address for a specific merchant.
/// Immediately bumps the TTL to ~1 year so the entry survives long-running
/// deployments without manual extension.
pub fn set_merchant_fee_recipient(env: &Env, merchant: &Address, recipient: &Address) {
    merchant.require_auth();
    if recipient == &env.current_contract_address() {
        env.panic_with_error(ContractError::InvalidRecipient);
    }
    let key = DataKey::MerchantFeeRecipient(merchant.clone());
    env.storage().persistent().set(&key, recipient);
    env.storage().persistent().extend_ttl(
        &key,
        SUBSCRIPTION_TTL_LEDGERS / 2,
        SUBSCRIPTION_TTL_LEDGERS,
    );
    crate::events::publish_merchant_fee_recipient_set(env, merchant, recipient);
}

/// Reads the custom fee recipient for a merchant if set.
/// Re-bumps the TTL to ~1 year on every read so that an actively-used
/// recipient cannot lapse during steady-state charging operations.
pub fn get_merchant_fee_recipient(env: &Env, merchant: &Address) -> Option<Address> {
    let key = DataKey::MerchantFeeRecipient(merchant.clone());
    let recipient: Option<Address> = env.storage().persistent().get(&key);
    if recipient.is_some() {
        env.storage().persistent().extend_ttl(
            &key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
    }
    recipient
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

/// Reverses `amount` of previously accumulated protocol fees after a refund.
/// Floors at zero so a bookkeeping-only reversal can never underflow the
/// counter; the saturating floor is reached only when the fee was already
/// withdrawn/cleared by governance.
pub fn decrement_protocol_fees(env: &Env, amount: i128) {
    if amount <= 0 {
        return;
    }
    let total = get_total_protocol_fees(env).saturating_sub(amount);
    env.storage()
        .instance()
        .set(&DataKey::TotalProtocolFees, &total);
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

/// Upper bound on the keeper tip, in basis points of the protocol fee.
///
/// At 5_000 bps the tip is at most half of the fee it is paid from, so for any
/// fee > 0 the tip is strictly below the fee and the protocol always keeps the
/// rest. The tip never changes the merchant's net amount or the gross charge.
pub const MAX_KEEPER_TIP_BPS: u32 = 5_000;

/// Returns the keeper tip in bps of the protocol fee. 0 (the default) disables tips.
pub fn get_keeper_tip_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::KeeperTipBps)
        .unwrap_or(0)
}

/// Sets the keeper tip. Rejects values above `MAX_KEEPER_TIP_BPS`.
pub fn set_keeper_tip_bps(env: &Env, bps: u32) {
    if bps > MAX_KEEPER_TIP_BPS {
        env.panic_with_error(ContractError::InvalidKeeperTipBps);
    }
    let old = get_keeper_tip_bps(env);
    env.storage().instance().set(&DataKey::KeeperTipBps, &bps);
    crate::events::publish_keeper_tip_bps_set(env, old, bps);
}

/// Fee split for a subscription charge, computed **before** any token
/// interaction so the caller can commit every state write first
/// (checks-effects-interactions, issue #1434).
///
/// [`plan_subscription_charge`] performs the allowance preflight and every
/// fee-side state write (`TotalProtocolFees`, referral accrual) but moves no
/// funds; [`settle_subscription_charge`] performs the transfers described here.
pub struct SubscriptionChargePlan {
    /// Full protocol fee (collector share + keeper tip + referral reward).
    pub fee_amount: i128,
    /// Amount owed to the merchant (`sub.amount - fee_amount`).
    pub net: i128,
    /// Fee collector, when a fee is actually charged.
    pub paid_to: Option<Address>,
    /// Keeper tip carved out of `fee_amount` (0 without a keeper/tip bps).
    pub tip: i128,
    /// Referral reward carved out of `fee_amount`.
    pub reward: i128,
    keeper: Option<Address>,
    collector: Option<Address>,
}

impl SubscriptionChargePlan {
    /// Portion of the fee that stays with the fee collector.
    fn collector_share(&self) -> i128 {
        self.fee_amount - self.tip - self.reward
    }
}

/// Computes the fee split for `sub.amount` and records every fee-side state
/// write. Performs **no** token transfer: call
/// [`settle_subscription_charge`] once the caller has written all of its own
/// effects, so no state write can follow the token interaction.
///
/// Panics with `InsufficientAllowance` when the contract's allowance over
/// `user`'s tokens is below the **gross** `sub.amount`, before any transfer is
/// planned.
pub fn plan_subscription_charge(
    env: &Env,
    user: &Address,
    sub: &Subscription,
    keeper: Option<&Address>,
    accrue_referral: bool,
) -> SubscriptionChargePlan {
    // Preflight: one allowance check covering every leg (fee + net == gross).
    validation::check_allowance(env, user, &sub.token, sub.amount);

    let bps = effective_fee_bps(env, &sub.merchant);
    let fee_collector =
        get_merchant_fee_recipient(env, &sub.merchant).or_else(|| get_fee_collector(env));

    let mut fee_amount = 0;
    let mut tip = 0;
    let mut reward = 0;
    let mut collector = None;

    if let Some(fee_recipient) = fee_collector {
        if bps > 0 {
            let fee = calculate_fee_amount(env, sub.amount, bps);
            if fee > 0 {
                // Tips come out of the protocol fee only, and only when a keeper
                // is named. A zero tip bps yields zero via `calculate_fee_amount`.
                tip = keeper
                    .map_or(0, |_| calculate_fee_amount(env, fee, get_keeper_tip_bps(env)));
                // Referral accrual is a state write, so it happens here, in the
                // effects phase, rather than between the transfer legs.
                reward = if accrue_referral {
                    crate::referral::accrue_charge_reward(env, user, &sub.token, fee - tip)
                } else {
                    0
                };
                // Effect: book the fees the protocol keeps (collector share +
                // referral reward) before any transfer.
                let to_collector = fee - tip - reward;
                accumulate_protocol_fees(env, to_collector + reward);
                fee_amount = fee;
                collector = Some(fee_recipient);
            }
        }
    }

    let net = sub
        .amount
        .checked_sub(fee_amount)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));

    SubscriptionChargePlan {
        fee_amount,
        net,
        paid_to: collector.clone(),
        tip,
        reward,
        keeper: keeper.cloned(),
        collector,
    }
}

/// Performs the token transfers described by `plan` (the interaction phase).
///
/// Must be called only after the caller has committed every state write for
/// this charge, so a (hypothetical) re-entrant callee can never observe
/// pre-charge state. Transfer legs run in the same order as before: collector
/// share, keeper tip, referral reward, then the merchant's net amount.
pub fn settle_subscription_charge(
    env: &Env,
    user: &Address,
    sub: &Subscription,
    plan: &SubscriptionChargePlan,
) {
    let token_client = token::Client::new(env, &sub.token);
    if let Some(collector) = &plan.collector {
        let to_collector = plan.collector_share();
        if to_collector > 0 {
            token_client.transfer_from(
                &env.current_contract_address(),
                user,
                collector,
                &to_collector,
            );
        }
        if plan.tip > 0 {
            if let Some(keeper_addr) = &plan.keeper {
                token_client.transfer_from(
                    &env.current_contract_address(),
                    user,
                    keeper_addr,
                    &plan.tip,
                );
            }
        }
        if plan.reward > 0 {
            token_client.transfer_from(
                &env.current_contract_address(),
                user,
                &env.current_contract_address(),
                &plan.reward,
            );
        }
    }

    let token_client = token::Client::new(env, &sub.token);
    token_client.transfer_from(&env.current_contract_address(), user, &sub.merchant, &plan.net);
}

/// Fee split for a pay-per-use payment; see [`SubscriptionChargePlan`].
pub struct PayPerUsePlan {
    /// Protocol fee deducted from the gross `amount`.
    pub fee_amount: i128,
    /// Amount owed to the recipient (`amount - fee_amount`).
    pub net: i128,
    collector: Option<Address>,
}

/// Computes the pay-per-use fee split and books the protocol-fee accrual.
/// Performs **no** token transfer; call [`settle_pay_per_use`] after the
/// caller's state writes.
///
/// Panics with `InsufficientAllowance` when the contract's allowance over
/// `user`'s tokens is below the **gross** `amount`, before any transfer is
/// planned.
pub fn plan_pay_per_use(
    env: &Env,
    user: &Address,
    token: &Address,
    amount: i128,
    recipient: &Address,
) -> PayPerUsePlan {
    // Preflight: one allowance check covering both legs (fee + net == gross).
    validation::check_allowance(env, user, token, amount);

    let bps = effective_fee_bps(env, recipient);
    let fee_collector =
        get_merchant_fee_recipient(env, recipient).or_else(|| get_fee_collector(env));

    let mut fee_amount = 0;
    let mut collector = None;

    if let Some(fee_recipient) = fee_collector {
        if bps > 0 {
            let fee = calculate_fee_amount(env, amount, bps);
            if fee > 0 {
                // Effect: book the fee before the transfer that collects it.
                accumulate_protocol_fees(env, fee);
                fee_amount = fee;
                collector = Some(fee_recipient);
            }
        }
    }

    let net = amount
        .checked_sub(fee_amount)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));

    PayPerUsePlan {
        fee_amount,
        net,
        collector,
    }
}

/// Performs the pay-per-use token transfers described by `plan` (the
/// interaction phase): fee leg first, then the recipient's net amount.
pub fn settle_pay_per_use(
    env: &Env,
    user: &Address,
    token: &Address,
    recipient: &Address,
    plan: &PayPerUsePlan,
) {
    let token_client = token::Client::new(env, token);
    if let Some(collector) = &plan.collector {
        if plan.fee_amount > 0 {
            token_client.transfer_from(
                &env.current_contract_address(),
                user,
                collector,
                &plan.fee_amount,
            );
        }
    }
    token_client.transfer_from(&env.current_contract_address(), user, recipient, &plan.net);
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
        let bps_values = [0, 1, 5, 10, 50, 100, 500, 1000, 5000, 9999, 10000];

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
                assert!(
                    fee >= 0,
                    "Fee is negative: {} for amount={}, bps={}",
                    fee,
                    amount,
                    bps
                );
                assert!(
                    net >= 0,
                    "Net is negative: {} for amount={}, bps={}",
                    net,
                    amount,
                    bps
                );

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
