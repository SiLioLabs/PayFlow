use soroban_sdk::{token, Address, Env};

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
pub fn commit_fee(env: &Env) {
    
    let pending: (Address, u32) = env
        .storage()
        .temporary()
        .get(&DataKey::PendingFee)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoPendingProposal));

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
pub fn calculate_fee_amount(amount: i128, bps: u32) -> i128 {
    if bps == 0 || amount <= 0 {
        return 0;
    }
    amount * (bps as i128) / 10_000
}

/// Transfers subscription charge amounts (fee to collector, net to merchant).
/// Returns the fee amount deducted from the gross subscription amount.
pub fn transfer_subscription_charge(env: &Env, user: &Address, sub: &Subscription) -> i128 {
    let bps = get_fee_bps(env);
    let fee_amount = match get_fee_collector(env) {
        Some(collector) if bps > 0 => {
            let fee = calculate_fee_amount(sub.amount, bps);
            if fee > 0 {
                let token_client = token::Client::new(env, &sub.token);
                token_client.transfer_from(&env.current_contract_address(), user, &collector, &fee);
            }
            fee
        }
        _ => 0,
    };
    let net = sub.amount - fee_amount;

    let token_client = token::Client::new(env, &sub.token);
    let merchant_dest: Address = env
        .storage()
        .persistent()
        .get(&DataKey::MerchantFeeRecipient(sub.merchant.clone()))
        .unwrap_or_else(|| sub.merchant.clone());
    token_client.transfer_from(&env.current_contract_address(), user, &merchant_dest, &net);

    fee_amount
}

/// Transfers a pay-per-use amount (fee to collector, net to `recipient`).
/// Mirrors `transfer_subscription_charge` but accepts an explicit token and
/// recipient instead of reading them from the subscription's merchant.
/// Returns the fee amount deducted from the gross amount.
pub fn transfer_pay_per_use(
    env: &Env,
    user: &Address,
    token: &Address,
    amount: i128,
    recipient: &Address,
) -> i128 {
    let bps = get_fee_bps(env);
    let fee_amount = match get_fee_collector(env) {
        Some(collector) if bps > 0 => {
            let fee = calculate_fee_amount(amount, bps);
            if fee > 0 {
                let token_client = token::Client::new(env, token);
                token_client.transfer_from(&env.current_contract_address(), user, &collector, &fee);
            }
            fee
        }
        _ => 0,
    };
    let net = amount - fee_amount;

    let token_client = token::Client::new(env, token);
    token_client.transfer_from(&env.current_contract_address(), user, recipient, &net);

    fee_amount
}
