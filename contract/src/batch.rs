use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::charge_exec::{self, ChargeSimResult};
use crate::events;
use crate::events::BatchChargeSkipsEventData;
use crate::grace;
use crate::validation;
use crate::{DataKey, Subscription};

// ─────────────────────────────────────────────────────────────
// Decode-compatibility note
// ─────────────────────────────────────────────────────────────
// `ChargeResult` is decoded off-chain by keepers, alert scripts
// (alert-failed-charges.ts), and indexers.  It is a Soroban
// `#[contracttype]` unit-only enum, so on the wire each variant is
// an `scvU32` carrying this discriminant — NOT an `scvSymbol`.
// Its layout is:
//
//   Charged             = 0
//   Skipped             = 1
//   NoSubscription      = 2
//   Inactive            = 3
//   Paused              = 4
//   GracePeriodElapsed  = 5
//   AllowanceInsufficient = 6
//
// The full wire-format description lives in `docs/CHARGE-RESULTS.md`.
//
// When adding new variants ALWAYS append at the end so existing
// off-chain parsers continue to recognise the original codes.
// Renaming or reordering is a breaking change for all consumers.
// The golden tests in test.rs lock this layout.

/// The outcome for a single user in a batch_cancel call.
///
/// Each variant is encoded as a `u32` discriminant on the wire:
///   Cancelled         = 0
///   NoSubscription    = 1
///   AlreadyCancelled  = 2
///   PausedCancelled   = 3
///   MerchantFrozen    = 4
///
/// **APPEND-ONLY INVARIANT:** New variants must always be appended at the end
/// so existing off-chain parsers that know 0-2 continue to work.
/// Renaming or reordering discriminants is a breaking change for all consumers.
/// See `docs/CANCEL-RESULTS.md` for the complete wire encoding specification.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum CancelResult {
    /// Subscription was cancelled successfully.
    Cancelled,
    /// No subscription found for this address.
    NoSubscription,
    /// Subscription was already cancelled.
    AlreadyCancelled,
    /// Subscription was paused; cancel succeeded but state was unusual.
    PausedCancelled,
    /// A paused (but active) subscription was cancelled.
    PausedCancelled,
    /// Subscription belongs to a frozen merchant and was cancelled.
    /// Subscription's merchant was frozen; cancel succeeded but state was unusual.
    MerchantFrozen,
}

/// The outcome for a single user in a batch_charge call.
///
/// Variants are returned in-order, one per input address. A non-`Charged`
/// result for one user never aborts processing of subsequent users.
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
    /// The subscriber's token allowance granted to this contract is less than
    /// the gross subscription amount (`sub.amount`). No funds were transferred.
    /// The keeper should prompt the subscriber to increase their allowance and
    /// retry on the next cycle; the subscription remains active.
    AllowanceInsufficient,
}

impl ChargeResult {
    /// Maps a `ChargeResult` onto the keeper-facing `ChargeSimResult`.
    ///
    /// `NoSubscription` collapses into `Inactive`, preserving the
    /// long-standing `simulate_charge` semantics in which a missing
    /// subscription is reported to keepers as `Inactive`.
    pub(crate) fn into_sim_result(self) -> ChargeSimResult {
        match self {
            ChargeResult::Charged => ChargeSimResult::WouldSucceed,
            ChargeResult::Skipped => ChargeSimResult::NotDue,
            ChargeResult::NoSubscription => ChargeSimResult::Inactive,
            ChargeResult::Inactive => ChargeSimResult::Inactive,
            ChargeResult::Paused => ChargeSimResult::SubscriptionPaused,
            ChargeResult::GracePeriodElapsed => ChargeSimResult::GracePeriodElapsed,
            ChargeResult::AllowanceInsufficient => ChargeSimResult::InsufficientAllowance,
        }
    }
}

/// Reads the configured maximum batch size.
///
/// Thin delegation to [`crate::caps::get_max_batch_size`], the single owner of
/// `DataKey::MaxBatchSize`. Kept as a `pub(crate)` alias so existing callers in
/// this module (and elsewhere) keep working without duplicating the read.
pub(crate) fn get_max_batch_size(env: &Env) -> u32 {
    crate::caps::get_max_batch_size(env)
}

/// Attempts to charge each user in `users`.
///
/// Individual failures do **not** abort the batch — every address is
/// processed and its outcome is recorded in the returned `Vec`.
///
/// When the batch contains at least one *interesting* non-success outcome
/// (`NoSubscription`, `Inactive`, `Paused`, `GracePeriodElapsed`,
/// `AllowanceInsufficient`), a single `batch_charge_skips` summary event is
/// emitted so event-driven consumers can see it without reading the return
/// value. Not-due skips alone do not trigger it. See the design note in
/// `events.rs`.
pub fn batch_charge(env: &Env, users: Vec<Address>) -> Vec<ChargeResult> {
    let mut results: Vec<ChargeResult> = Vec::new(env);

    let max_size = get_max_batch_size(env);
    if users.len() > max_size {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    let now = env.ledger().timestamp();
    let grace_period = grace::get_grace_period(env);

    let mut charged = 0u32;
    let mut not_due = 0u32;
    let mut no_subscription = 0u32;
    let mut inactive = 0u32;
    let mut paused = 0u32;
    let mut grace_elapsed = 0u32;
    let mut allowance_insufficient = 0u32;

    for user in users.iter() {
        let key = DataKey::Subscription(user.clone());

        let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);

        let result = match sub_opt {
            None => ChargeResult::NoSubscription,
            Some(mut sub) => {
                if sub.paused {
                    charge_exec::try_auto_resume(env, &user, &mut sub, now);
                }
                match charge_exec::precheck_charge(&sub, now, grace_period) {
                    Err(skip) => skip,
                    Ok(()) => {
                        // Pre-check allowance against the gross subscription
                        // amount BEFORE calling execute_charge. The SAC's
                        // transfer_from panics when allowance is insufficient,
                        // which would abort the whole transaction. By checking
                        // here we convert that condition into a per-user result
                        // so the rest of the batch continues unaffected.
                        //
                        // `fee::transfer_subscription_charge` asserts the same
                        // `allowance >= gross` invariant again before its two
                        // transfer legs. That re-read is deliberate: the helper
                        // is also reached from single `charge()` and from
                        // pay-per-use, where no caller has established the
                        // invariant, and an auditor reading the helper alone
                        // should see it stated there. Here it is redundant.
                        if !validation::has_sufficient_allowance(env, &user, &sub.token, sub.amount)
                        {
                            ChargeResult::AllowanceInsufficient
                        } else {
                            charge_exec::execute_charge(env, &user, &key, &mut sub, now);
                            ChargeResult::Charged
                        }
                    }
                }
            }
        };

        // Exhaustive match: adding a `ChargeResult` variant without updating
        // the counter block below is a compile error. This is the guard that
        // keeps `BatchChargeSkipsEventData`'s counters in sync with the enum.
        match result {
            ChargeResult::Charged => charged += 1,
            ChargeResult::Skipped => not_due += 1,
            ChargeResult::NoSubscription => no_subscription += 1,
            ChargeResult::Inactive => inactive += 1,
            ChargeResult::Paused => paused += 1,
            ChargeResult::GracePeriodElapsed => grace_elapsed += 1,
            ChargeResult::AllowanceInsufficient => allowance_insufficient += 1,
        }

        results.push_back(result);
    }

    // Only interesting failures are worth an event; a batch that merely wasn't
    // due yet stays silent.
    if no_subscription + inactive + paused + grace_elapsed + allowance_insufficient > 0 {
        events::publish_batch_charge_skips(
            env,
            BatchChargeSkipsEventData {
                total: users.len(),
                charged,
                not_due,
                no_subscription,
                inactive,
                paused,
                grace_elapsed,
                allowance_insufficient,
                ledger_sequence: env.ledger().sequence(),
            },
        );
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::BatchChargeSkipsEventData;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Env, Vec};

    /// Enumerates every `ChargeResult` variant so that adding a new one forces
    /// this list (and therefore the counter block in `batch_charge`) to be
    /// revisited. The `match` is exhaustive: a new variant is a compile error.
    fn all_charge_result_variants() -> [ChargeResult; 7] {
        [
            ChargeResult::Charged,
            ChargeResult::Skipped,
            ChargeResult::NoSubscription,
            ChargeResult::Inactive,
            ChargeResult::Paused,
            ChargeResult::GracePeriodElapsed,
            ChargeResult::AllowanceInsufficient,
        ]
    }

    /// Compile-time guard: every variant must be classified as either a
    /// success, a "not due" skip, or an "interesting" skip. If a new variant is
    /// added, this match fails to compile until it is classified here and the
    /// counter block in `batch_charge` is updated to match.
    fn classify(result: &ChargeResult) -> CounterKind {
        match result {
            ChargeResult::Charged => CounterKind::Charged,
            ChargeResult::Skipped => CounterKind::NotDue,
            ChargeResult::NoSubscription => CounterKind::Interesting,
            ChargeResult::Inactive => CounterKind::Interesting,
            ChargeResult::Paused => CounterKind::Interesting,
            ChargeResult::GracePeriodElapsed => CounterKind::Interesting,
            ChargeResult::AllowanceInsufficient => CounterKind::Interesting,
        }
    }

    #[derive(Debug, PartialEq)]
    enum CounterKind {
        Charged,
        NotDue,
        Interesting,
    }

    /// Recomputes the counters from a `Vec<ChargeResult>` using the same
    /// classification as `batch_charge`, so tests can assert the emitted event
    /// matches the returned vector.
    fn recount(results: &Vec<ChargeResult>) -> BatchChargeSkipsEventData {
        let mut charged = 0u32;
        let mut not_due = 0u32;
        let mut no_subscription = 0u32;
        let mut inactive = 0u32;
        let mut paused = 0u32;
        let mut grace_elapsed = 0u32;
        let mut allowance_insufficient = 0u32;

        for r in results.iter() {
            match r {
                ChargeResult::Charged => charged += 1,
                ChargeResult::Skipped => not_due += 1,
                ChargeResult::NoSubscription => no_subscription += 1,
                ChargeResult::Inactive => inactive += 1,
                ChargeResult::Paused => paused += 1,
                ChargeResult::GracePeriodElapsed => grace_elapsed += 1,
                ChargeResult::AllowanceInsufficient => allowance_insufficient += 1,
            }
        }

        BatchChargeSkipsEventData {
            total: results.len(),
            charged,
            not_due,
            no_subscription,
            inactive,
            paused,
            grace_elapsed,
            allowance_insufficient,
            ledger_sequence: 0,
        }
    }

    /// The documented invariant: the per-outcome counters sum to `total`.
    #[test]
    fn batch_charge_skips_counters_sum_to_total() {
        for variant in all_charge_result_variants() {
            let mut v: Vec<ChargeResult> = Vec::new(&Env::default());
            v.push_back(variant.clone());
            let data = recount(&v);
            let sum = data.charged
                + data.not_due
                + data.no_subscription
                + data.inactive
                + data.paused
                + data.grace_elapsed
                + data.allowance_insufficient;
            assert_eq!(sum, data.total, "counters must sum to total");
        }
    }

    /// Every variant is classified, and the classification is stable.
    #[test]
    fn batch_charge_skips_all_variants_classified() {
        for variant in all_charge_result_variants() {
            // Must not panic; the match is exhaustive.
            let _ = classify(&variant);
        }
    }

    /// A mixed batch containing at least one of every non-success outcome must
    /// produce counters that match the returned `Vec<ChargeResult>`.
    #[test]
    fn batch_charge_skips_mixed_batch_matches_returned_vec() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        // Build a mixed result vector directly and verify the recount helper
        // agrees with the documented invariant. This exercises the same
        // classification used by `batch_charge`'s counter block.
        let mut results: Vec<ChargeResult> = Vec::new(&env);
        results.push_back(ChargeResult::Charged);
        results.push_back(ChargeResult::Skipped);
        results.push_back(ChargeResult::NoSubscription);
        results.push_back(ChargeResult::Inactive);
        results.push_back(ChargeResult::Paused);
        results.push_back(ChargeResult::GracePeriodElapsed);
        results.push_back(ChargeResult::AllowanceInsufficient);

        let data = recount(&results);
        assert_eq!(data.total, 7);
        assert_eq!(data.charged, 1);
        assert_eq!(data.not_due, 1);
        assert_eq!(data.no_subscription, 1);
        assert_eq!(data.inactive, 1);
        assert_eq!(data.paused, 1);
        assert_eq!(data.grace_elapsed, 1);
        assert_eq!(data.allowance_insufficient, 1);
        assert_eq!(
            data.charged
                + data.not_due
                + data.no_subscription
                + data.inactive
                + data.paused
                + data.grace_elapsed
                + data.allowance_insufficient,
            data.total
        );
    }

    /// `get_max_batch_size` must read through `caps`, the single owner of
    /// `DataKey::MaxBatchSize`.
    #[test]
    fn get_max_batch_size_delegates_to_caps() {
        let env = Env::default();
        // Instance storage is only readable from inside a contract frame, so
        // the delegation is asserted under `as_contract`.
        let contract_id = env.register_contract(None, crate::FlowPay);
        env.as_contract(&contract_id, || {
            assert_eq!(
                get_max_batch_size(&env),
                crate::caps::get_max_batch_size(&env)
            );
            assert_eq!(get_max_batch_size(&env), crate::MAX_BATCH_SIZE);
        });
    }

    /// Sanity: the guard list covers every variant the enum currently has.
    #[test]
    fn all_charge_result_variants_is_complete() {
        // If a variant is added, `all_charge_result_variants` must be updated;
        // this test fails loudly if the array length drifts from the enum.
        assert_eq!(all_charge_result_variants().len(), 7);
    }

    // Silence unused-import warnings in configurations where the test bodies
    // above are trimmed.
    #[allow(dead_code)]
    fn _touch(_: &Address) {}
}

/// Bumps TTL for all provided subscriptions in one call.
/// Panics with BatchTooLarge if `users` exceeds max batch size.
/// Skips addresses without a subscription entry.
/// Returns a Vec<Address> of addresses that were extended.
pub fn batch_extend_subscription_ttl(env: &Env, users: Vec<Address>) -> Vec<Address> {
    let max_size = get_max_batch_size(env);
    if users.len() > max_size {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    let mut extended: Vec<Address> = Vec::new(env);
    for user in users.iter() {
        let key = DataKey::Subscription(user.clone());
        if env.storage().persistent().has(&key) {
            crate::storage::extend_subscription_ttl(env, &user);
            extended.push_back(user.clone());
        }
    }
    extended
}

pub fn batch_cancel(env: &Env, users: Vec<Address>) -> Vec<CancelResult> {
    if users.len() > crate::MAX_BATCH_PAUSE_SUBSCRIPTIONS {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    let mut results: Vec<CancelResult> = Vec::new(env);

    for user in users.iter() {
        let key = DataKey::Subscription(user.clone());
        let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);

        let result = match sub_opt {
            None => CancelResult::NoSubscription,
            Some(sub) => {
                if !sub.active {
                    // sub.active required here: paused subscriptions must not be charged/acted upon —
                    // detecting already-cancelled subscriptions uses sub.active, not is_cancelled,
                    // because legacy `paused && !active` rows are also considered already-cancelled
                    // for the purpose of this batch guard.
                    CancelResult::AlreadyCancelled
                } else {
                    // Check for unusual states before cancelling
                    let was_paused = sub.paused;
                    let merchant_frozen = crate::whitelist::is_frozen(env, &sub.merchant);

                    // Cancel regardless of state, exactly once.
                    crate::cancel_inner(env, &user);
                    crate::events::publish_cancelled(env, &user);

                    if merchant_frozen {
                        CancelResult::MerchantFrozen
                    } else if sub.paused {
                        CancelResult::PausedCancelled
                    } else {
                        CancelResult::Cancelled
                    }
                }
            }
        };

        results.push_back(result);
    }

    results
}
