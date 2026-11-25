use soroban_sdk::{token, Address, Env};

use crate::{errors::ContractError, events, DataKey, SUBSCRIPTION_TTL_LEDGERS};

/// Removes the referrer for a given subscriber.
///
/// Called during cancel/unsubscribe to keep the index accurate —
/// no orphaned `Referral` entries remain after a clean removal.
pub fn remove_referral(env: &Env, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Referral(user.clone()));
    env.storage()
        .persistent()
        .remove(&DataKey::ReferralRewardChargeCount(user.clone()));
}

/// Returns the referrer for a given subscriber, if one was recorded.
///
/// Bumps the TTL on every successful read so that active referral
/// relations remain live as long as the subscription is in use.
pub fn get_referrer(env: &Env, user: &Address) -> Option<Address> {
    let key = DataKey::Referral(user.clone());
    let result: Option<Address> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage().persistent().extend_ttl(
            &key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
    }
    result
}

/// Stores the referrer for a subscriber. Clears any prior referrer when `None`.
///
/// Extends the TTL of the `Referral(user)` key to match subscription
/// lifetime so that attribution is never silently lost to archival.
pub fn store_referral(env: &Env, user: &Address, referrer: &Option<Address>) {
    let key = DataKey::Referral(user.clone());
    if let Some(ref r) = referrer {
        if r == user {
            env.panic_with_error(ContractError::SelfReferral);
        }
        env.storage().persistent().set(&key, r);
        env.storage().persistent().extend_ttl(
            &key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );

        events::publish_referred(env, user, r);
    } else if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
    }
}

/// Transfers the referral from one subscriber to another.
/// Moves the referrer attribution from `old_user` to `new_user`, clears the old entry, and extends TTL.
pub fn transfer_referral(env: &Env, old_user: &Address, new_user: &Address) {
    let old_key = DataKey::Referral(old_user.clone());
    let new_key = DataKey::Referral(new_user.clone());

    // Get the referral from the old address
    if let Some(referrer) = env.storage().persistent().get::<DataKey, Address>(&old_key) {
        // Move it to the new address
        env.storage().persistent().set(&new_key, &referrer);
        env.storage().persistent().extend_ttl(
            &new_key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
    }

    let count_key = DataKey::ReferralRewardChargeCount(old_user.clone());
    if let Some(count) = env.storage().persistent().get::<DataKey, u32>(&count_key) {
        let new_count_key = DataKey::ReferralRewardChargeCount(new_user.clone());
        env.storage().persistent().set(&new_count_key, &count);
        env.storage().persistent().extend_ttl(
            &new_count_key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
        env.storage().persistent().remove(&count_key);
    }

    // Clear the old address's referral
    env.storage().persistent().remove(&old_key);
}

pub const MAX_REFERRAL_REWARD_BPS: u32 = 5_000;
pub const DEFAULT_REFERRAL_REWARD_MAX_CHARGES: u32 = 12;

pub fn get_reward_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ReferralRewardBps)
        .unwrap_or(1_000)
}

pub fn get_reward_max_charges(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ReferralRewardMaxCharges)
        .unwrap_or(DEFAULT_REFERRAL_REWARD_MAX_CHARGES)
}

/// Reserve part of the protocol fee for a referrer for the first N successful charges.
pub fn accrue_charge_reward(
    env: &Env,
    user: &Address,
    token_addr: &Address,
    protocol_fee: i128,
) -> i128 {
    let Some(referrer) = get_referrer(env, user) else {
        return 0;
    };
    let count_key = DataKey::ReferralRewardChargeCount(user.clone());
    let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
    if count >= get_reward_max_charges(env) || protocol_fee <= 0 {
        return 0;
    }
    env.storage().persistent().set(&count_key, &(count + 1));
    env.storage().persistent().extend_ttl(
        &count_key,
        SUBSCRIPTION_TTL_LEDGERS / 2,
        SUBSCRIPTION_TTL_LEDGERS,
    );
    let reward = protocol_fee
        .checked_mul(get_reward_bps(env) as i128)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow))
        / 10_000;
    if reward > 0 {
        let key = DataKey::ReferralReward(token_addr.clone(), referrer.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let updated = current
            .checked_add(reward)
            .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));
        env.storage().persistent().set(&key, &updated);
        env.storage().persistent().extend_ttl(
            &key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
        events::publish_referral_reward_accrued(env, user, &referrer, reward);
    }
    reward
}

pub fn get_reward_balance(env: &Env, token_addr: &Address, referrer: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::ReferralReward(
            token_addr.clone(),
            referrer.clone(),
        ))
        .unwrap_or(0)
}

pub fn withdraw_reward(env: &Env, token_addr: &Address, referrer: &Address) -> i128 {
    referrer.require_auth();
    let key = DataKey::ReferralReward(token_addr.clone(), referrer.clone());
    let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    if amount <= 0 {
        env.panic_with_error(ContractError::ZeroBalanceAvailable);
    }
    env.storage().persistent().set(&key, &0i128);
    token::Client::new(env, token_addr).transfer(
        &env.current_contract_address(),
        referrer,
        &amount,
    );
    events::publish_referral_reward_withdrawn(env, referrer, amount);
    amount
}
