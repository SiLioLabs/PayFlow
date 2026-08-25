use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::{errors::ContractError, grace, token, DataKey, Subscription};
use crate::events;
use crate::merchant_stats;

/// Maximum number of users that can be charged in a single batch_charge call.
pub const MAX_BATCH_SIZE: u32 = 100;

/// The outcome for a single user in a batch_charge call.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ChargeResult {
    /// Funds were transferred successfully.
    Charged,
    /// Interval has not elapsed yet — skipped without error.
    Skipped,
    /// No subscription found for this address.
    NoSubscription,
    /// Subscription is inactive (cancelled).
    Inactive,
    /// Subscription is paused.
    Paused,
    /// Grace period has elapsed.
    GracePeriodElapsed,
    /// Merchant is frozen.
    MerchantFrozen,
    /// Global volume cap would be exceeded.
    VolumeCapExceeded,
    /// Contract is paused.
    ContractPaused,
}

/// Attempts to charge each user in `users`.
///
/// Individual failures do **not** abort the batch — every address is
/// processed and its outcome is recorded in the returned `Vec`.
pub fn batch_charge(env: &Env, users: Vec<Address>) -> Vec<ChargeResult> {
    if users.len() > MAX_BATCH_SIZE {
        env.panic_with_error(ContractError::BatchTooLarge);
    }

    let mut results: Vec<ChargeResult> = Vec::new(env);

    let contract_paused = env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false);

    let now = env.ledger().timestamp();
    let grace_period = grace::get_grace_period(env);
    let global_cap = env
        .storage()
        .instance()
        .get::<_, i128>(&DataKey::GlobalVolumeCap);

    for user in users.iter() {
        if contract_paused {
            results.push_back(ChargeResult::ContractPaused);
            continue;
        }

        let key = DataKey::Subscription(user.clone());

        let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);

        let result = match sub_opt {
            None => ChargeResult::NoSubscription,
            Some(mut sub) => {
                if !sub.active {
                    ChargeResult::Inactive
                } else if sub.paused {
                    ChargeResult::Paused
                } else if env
                    .storage()
                    .persistent()
                    .has(&DataKey::MerchantFrozen(sub.merchant.clone()))
                {
                    ChargeResult::MerchantFrozen
                } else if now < sub.last_charged + sub.interval {
                    ChargeResult::Skipped
                } else if grace_period > 0
                    && now > sub.last_charged + sub.interval + grace_period
                {
                    ChargeResult::GracePeriodElapsed
                } else if let Some(cap) = global_cap {
                    let used = env
                        .storage()
                        .instance()
                        .get::<_, i128>(&DataKey::GlobalVolumeUsed)
                        .unwrap_or(0);
                    if used + sub.amount > cap {
                        ChargeResult::VolumeCapExceeded
                    } else {
                        env.storage()
                            .instance()
                            .set(&DataKey::GlobalVolumeUsed, &(used + sub.amount));
                        do_charge(env, &user, &key, &mut sub, &now)
                    }
                } else {
                    do_charge(env, &user, &key, &mut sub, &now)
                }
            }
        };

        results.push_back(result);
    }

    results
}

fn do_charge(env: &Env, user: &Address, key: &DataKey, sub: &mut Subscription, now: &u64) -> ChargeResult {
    let token_client = token::Client::new(env, &sub.token);
    token_client.transfer_from(
        &env.current_contract_address(),
        user,
        &sub.merchant,
        &sub.amount,
    );

    merchant_stats::increment_revenue(env, &sub.merchant, sub.amount);

    sub.last_charged = *now;
    env.storage().persistent().set(key, sub);

    events::publish_charged(env, user, sub, *now);

    ChargeResult::Charged
}
