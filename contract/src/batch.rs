use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::{grace, token, DataKey, Subscription};
use crate::events;
use crate::merchant_stats;

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

/// Attempts to charge each user in `users`.
///
/// Individual failures do **not** abort the batch — every address is
/// processed and its outcome is recorded in the returned `Vec`.
pub fn batch_charge(env: &Env, users: Vec<Address>) -> Vec<ChargeResult> {
    let mut results: Vec<ChargeResult> = Vec::new(env);

    let now = env.ledger().timestamp();
    let grace_period = grace::get_grace_period(env);

    for user in users.iter() {
        let key = DataKey::Subscription(user.clone());

        let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);

        let result = match sub_opt {
            None => ChargeResult::NoSubscription,
            Some(mut sub) => {
                if !sub.active {
                    ChargeResult::Inactive
                } else if sub.paused {
                    ChargeResult::Paused
                } else if now < sub.last_charged + sub.interval {
                    ChargeResult::Skipped
                } else if grace_period > 0
                    && now > sub.last_charged + sub.interval + grace_period
                {
                    ChargeResult::GracePeriodElapsed
                } else {
                    let token_client = token::Client::new(env, &sub.token);
                    token_client.transfer_from(
                        &env.current_contract_address(),
                        &user,
                        &sub.merchant,
                        &sub.amount,
                    );

                    merchant_stats::increment_revenue(env, &sub.merchant, sub.amount);

                    sub.last_charged = now;
                    env.storage().persistent().set(&key, &sub);

                    events::publish_charged(env, &user, &sub, now);

                    ChargeResult::Charged
                }
            }
        };

        results.push_back(result);
    }

    results
}
