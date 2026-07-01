use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::charge_exec;
use crate::grace;
use crate::{DataKey, Subscription};

pub const MAX_BATCH_SIZE: u32 = 50;

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
}

pub(crate) fn get_max_batch_size(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxBatchSize)
        .unwrap_or(MAX_BATCH_SIZE)
}

/// Attempts to charge each user in `users`.
///
/// Individual failures do **not** abort the batch — every address is
/// processed and its outcome is recorded in the returned `Vec`.
pub fn batch_charge(env: &Env, users: Vec<Address>) -> Vec<ChargeResult> {
    let mut results: Vec<ChargeResult> = Vec::new(env);

    let max_size = get_max_batch_size(env);
    if users.len() > max_size {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    let now = env.ledger().timestamp();
    let grace_period = grace::get_grace_period(env);

    for user in users.iter() {
        let key = DataKey::Subscription(user.clone());

        let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);

        let result = match sub_opt {
            None => ChargeResult::NoSubscription,
            Some(mut sub) => {
                // Try auto-resume if paused past expiry
                if sub.paused && charge_exec::try_auto_resume(env, &user, &mut sub, now) {
                    charge_exec::execute_charge(env, &user, &key, &mut sub, now);
                    ChargeResult::Charged
                } else {
                    match charge_exec::precheck_charge(&sub, now, grace_period) {
                        Err(skip) => skip,
                        Ok(()) => {
                            charge_exec::execute_charge(env, &user, &key, &mut sub, now);
                            ChargeResult::Charged
                        }
                    }
                }
            },
        };

        results.push_back(result);
    }

    results
}
