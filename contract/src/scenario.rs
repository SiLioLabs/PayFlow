//! Scenario-level regression guards (issue #1047).
//!
//! The fixes this wave shipped are asserted, in `test.rs`, only inside
//! unit-level snippets against a single address. That is not enough: the
//! corruption these guards exist for was a *counter* bug, and counters only
//! drift when several actors move at once. Every scenario here is therefore an
//! end-to-end, multi-user run that leaves a ledger behind and inspects the
//! aggregate state afterwards.
//!
//! Each scenario is named after the fix it guards, so a failure names the fix:
//!
//!   `scenario_double_cancel_leaves_every_counter_identical`  → idempotent cancel
//!   `scenario_lowered_volume_cap_rejects_over_cap_charge`    → effective volume cap
//!   `scenario_transfer_subscription_moves_subscription_and_index`
//!                                                            → transfer rebinding (moved keys)
//!   `scenario_estimate_matches_live_batch_outcomes`         → estimate/live parity
//!   `scenario_zero_interval_guards_*`                        → division-of-zero
//!   `scenario_schema_version_guard_blocks_mutation`         → schema-version guard
//!
//! Run the whole suite with `cargo test scenario::` (or plain `cargo test`, which
//! is what CI runs — the module is wired in under `#[cfg(test)]` in `lib.rs`).

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String, Symbol, TryIntoVal, Vec,
};

use crate::migration::CURRENT_VERSION;
use super::test::{setup, setup_funded_user};

/// A funded subscriber with its own token allowance, as `setup()` does for the
/// first user.
fn extra_user(env: &Env, contract_id: &Address, token_addr: &Address) -> Address {
    setup_funded_user(env, contract_id, token_addr)
}

fn subscribe(
    client: &FlowPayClient,
    user: &Address,
    merchant: &Address,
    amount: i128,
    interval: u64,
    token_addr: &Address,
    referrer: &Option<Address>,
) {
    client.subscribe(user, merchant, &amount, &interval, token_addr, &None, referrer);
}

/// The aggregate counters a cancel is allowed to touch. Snapshotted as a tuple
/// so a scenario can compare "before" and "after" in one assertion instead of
/// asserting each field separately (and missing one).
type CounterSnapshot = (u64, u64, u64);

fn counters(client: &FlowPayClient, merchants: &Vec<Address>) -> CounterSnapshot {
    let active = client.get_active_count();
    let indexed = client.get_subscriber_count();
    let mut per_merchant = 0u64;
    for m in merchants.iter() {
        per_merchant += client.get_merchant_sub_count(&m);
    }
    (active, indexed, per_merchant)
}

fn count_events(env: &Env, topic: &str, user: &Address) -> u32 {
    let expected = Symbol::new(env, topic);
    let mut count = 0;
    for (_, topics, _) in env.events().all().iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
        if topic_symbol != expected {
            continue;
        }
        let topic_user: Address = topics.get(1).unwrap().try_into_val(env).unwrap();
        if topic_user == *user {
            count += 1;
        }
    }
    count
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotent cancel: a second cancel must not move any counter
// ─────────────────────────────────────────────────────────────────────────────

/// Guards the idempotent-cancel fix.
///
/// `cancel_inner` decrements `ActiveCount`, the per-merchant subscriber count,
/// and prunes the subscriber index. Those decrements are the corruption vector:
/// a double cancel that decrements twice silently under-counts the protocol
/// and leaves keepers charging phantom subscribers. Both counters floor at 0
/// today, so the scenario pins the observable contract — *every* aggregate
/// counter is byte-identical before and after the second cancel — rather than
/// the current implementation, which is why it survives a future refactor that
/// removes the flooring but keeps the guard.
#[test]
fn scenario_double_cancel_leaves_every_counter_identical() {
    let (env, contract_id, token_addr, user_a, merchant_a) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = extra_user(&env, &contract_id, &token_addr);
    let user_c = extra_user(&env, &contract_id, &token_addr);
    let merchant_b = Address::generate(&env);
    let referrer = Address::generate(&env);

    // Three subscribers across two merchants: a shared merchant is what makes
    // the per-merchant counter observable, and the extra merchant proves the
    // counter is not a global scalar in disguise.
    subscribe(&client, &user_a, &merchant_a, 1_0000000, 86_400, &token_addr, &None);
    subscribe(
        &client,
        &user_b,
        &merchant_a,
        1_0000000,
        86_400,
        &token_addr,
        &Some(referrer.clone()),
    );
    subscribe(&client, &user_c, &merchant_b, 1_0000000, 86_400, &token_addr, &None);

    let merchants = soroban_sdk::vec![&env, merchant_a.clone(), merchant_b.clone()];
    let before = counters(&client, &merchants);
    // (active, index size, per-merchant total). The index is append-only, so a
    // cancel tombstones a slot instead of shrinking it: the index size stays 3
    // and the live counts are what must move.
    assert_eq!(before, (3, 3, 3), "three subscribers over two merchants");

    client.cancel(&user_a);
    let after_first = counters(&client, &merchants);
    assert_eq!(
        after_first,
        (2, 3, 2),
        "first cancel must drop exactly one active and one per-merchant \
         subscriber, and must leave the append-only index size alone"
    );
    assert_eq!(client.get_referrer(&user_b), Some(referrer.clone()));

    // The second cancel is the one under test. `cancel` is not re-entrant, so
    // this is an ordinary call in its own right, not a revert-and-retry.
    client.cancel(&user_a);
    let after_second = counters(&client, &merchants);

    assert_eq!(
        after_second, after_first,
        "double cancel moved an aggregate counter: ActiveCount, the subscriber \
         index size, the per-merchant totals or the merchant index all changed"
    );

    // The subscription itself is unchanged, and the referrer of a *different*
    // user was not collateral damage.
    let sub = client.get_subscription(&user_a).unwrap();
    assert!(!sub.active);
    assert!(!sub.paused);
    assert_eq!(client.get_referrer(&user_b), Some(referrer.clone()));
    assert_eq!(client.get_merchant_sub_count(&merchant_b), 1);
}

/// The batch path must reach the same place: a user already cancelled in a
/// previous batch must report `AlreadyCancelled` and move no counter.
#[test]
fn scenario_batch_cancel_of_already_cancelled_user_moves_no_counter() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = extra_user(&env, &contract_id, &token_addr);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    subscribe(&client, &user_a, &merchant, 1_0000000, 86_400, &token_addr, &None);
    subscribe(&client, &user_b, &merchant, 1_0000000, 86_400, &token_addr, &None);

    client.cancel(&user_a);

    let merchants = soroban_sdk::vec![&env, merchant.clone()];
    let before = counters(&client, &merchants);
    assert_eq!(before, (1, 2, 1), "one of the two subscribers is already cancelled");

    let users = soroban_sdk::vec![&env, user_a.clone(), user_b.clone()];
    let results = client.batch_cancel(&users);

    assert_eq!(results.get(0).unwrap(), CancelResult::AlreadyCancelled);
    assert_eq!(results.get(1).unwrap(), CancelResult::Cancelled);
    // Only user_b is newly cancelled. If the AlreadyCancelled branch also ran
    // the decrement, the active count would have under-flowed to 0 while two
    // cancels were reported.
    assert_eq!(
        counters(&client, &merchants),
        (0, 2, 0),
        "a re-cancel inside a batch must not double-decrement the already-cancelled user"
    );
    assert_eq!(count_events(&env, "cancelled", &user_a), 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Effective volume cap: a lowered cap is enforced against the live window
// ─────────────────────────────────────────────────────────────────────────────

/// Guards the effective-volume-cap fix: `get_global_volume_cap` must report the
/// admin override (not the compile-time default), and a charge that would push
/// the *current window* past a lowered cap must be rejected without corrupting
/// the accumulator.
///
/// The corruption this pins: an over-cap charge that still mutates the window
/// would make every later charge fail, wedging the whole protocol until the hour
/// rolls over. So the accumulator is asserted unchanged after the rejection, and
/// a charge that fits under the new cap still succeeds afterwards.
#[test]
fn scenario_lowered_volume_cap_rejects_over_cap_charge() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = extra_user(&env, &contract_id, &token_addr);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    subscribe(&client, &user_a, &merchant, 1_0000000, 86_400, &token_addr, &None);
    subscribe(&client, &user_b, &merchant, 1_0000000, 86_400, &token_addr, &None);

    // One charge inside the (large) default cap.
    env.ledger().set_timestamp(86_400);
    client.charge(&user_a);
    let (accumulated, charge_window_start) = client.get_global_volume_window();
    assert_eq!(accumulated, 1_0000000, "the window accumulates live charges");

    // Lower the cap *below* what a second charge needs. This is the
    // cap-lowering case: an operator tightening the cap mid-window.
    client.set_global_volume_cap(&1_5000000);
    assert_eq!(
        client.get_global_volume_cap(),
        1_5000000,
        "the effective cap must be the override, not the compile-time default"
    );

    // Stay inside the same hourly window: advancing past window_end would roll
    // the accumulator over and the cap would be compared against an empty
    // window, which is a different (and useless) test.
    env.ledger().set_timestamp(86_400 + 600);
    let res = client.try_charge(&user_b);
    assert_eq!(
        res,
        Err(Ok(soroban_sdk::Error::from_contract_error(28))),
        "a charge that breaches the lowered cap must fail with GlobalVolumeExceeded"
    );

    // The rejected charge must leave the window exactly as it was.
    let (after_reject, window_start) = client.get_global_volume_window();
    assert_eq!(
        after_reject, accumulated,
        "a rejected over-cap charge still moved the volume accumulator"
    );
    assert_eq!(window_start, charge_window_start, "the window was re-based");

    // And the user stays charged-once, not half-charged: no funds moved.
    let token = TokenClient::new(&env, &token_addr);
    let sub_before = client.get_subscription(&user_b).unwrap();
    assert_eq!(sub_before.last_charged, 0, "rejected charge advanced last_charged");

    // Raising the cap again lets the same charge through, proving the cap is
    // read per charge rather than latched at subscribe time.
    client.set_global_volume_cap(&50_0000000);
    client.charge(&user_b);
    let (final_volume, _) = client.get_global_volume_window();
    assert_eq!(final_volume, 2_0000000);
    assert_eq!(token.balance(&merchant), 2_0000000);
    assert!(client.get_subscription(&user_b).unwrap().active);
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer rebinding
// ─────────────────────────────────────────────────────────────────────────────

/// Guards the transfer-rebinding fix for the keys the transfer path owns: the
/// `Subscription` row and its position in the append-only subscriber index.
///
/// `transfer_subscription` moves the subscription itself and re-seats the index
/// slot, and a stale slot is the corruption vector — a keeper reading the index
/// would keep charging the address the subscription left.
#[test]
fn scenario_transfer_subscription_moves_subscription_and_index() {
    let (env, contract_id, token_addr, user_old, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_new = extra_user(&env, &contract_id, &token_addr);

    subscribe(&client, &user_old, &merchant, 1_0000000, 86_400, &token_addr, &None);

    assert_eq!(client.get_active_count(), 1);
    assert_eq!(client.get_subscriber_count(), 1);
    assert_eq!(client.get_subscriber_at(&0), Some(user_old.clone()));
    assert_eq!(client.get_subscriber_at(&1), None);

    client.transfer_subscription(&user_old, &user_new);

    // The subscription follows the user.
    assert!(client.get_subscription(&user_old).is_none());
    let moved = client.get_subscription(&user_new).unwrap();
    assert!(moved.active);
    assert_eq!(moved.merchant, merchant);
    assert_eq!(moved.amount, 1_0000000);

    // The index slot follows too: the old address is gone from it and the new
    // one is at the tail.
    assert_eq!(client.get_active_count(), 1, "a transfer is not a subscribe");
    // Append-only: the old slot is tombstoned and the new address is appended,
    // so the raw index size grows to 2 while the live view still has one entry.
    assert_eq!(client.get_subscriber_count(), 2, "index size after the re-seat");
    assert_eq!(client.get_subscriber_at(&0), None, "old slot is tombstoned");
    assert_eq!(client.get_subscriber_at(&1), Some(user_new.clone()));
    assert_ne!(
        client.get_subscriber_at(&0),
        Some(user_old.clone()),
        "the transferred address is still in the subscriber index"
    );
    assert!(client
        .get_subscriber_page(&0, &10)
        .contains(&user_new));

    // The merchant keeps its single subscriber — a transfer must not double-count.
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);
}

/// Guards transfer rebinding for the **per-user side tables** — metadata label,
/// charge history and referral attribution.
///
/// KNOWN GAP — this scenario is `#[ignore]`d because the fix is not in the tree:
/// `transfer_subscription` moves only the `Subscription` row and the index slot.
/// `subscription_metadata.rs`, `subscription_history.rs` and `referral.rs` have
/// no transfer helpers, so all three stay bound to the old address and the new
/// subscriber starts with no label, no history and no referral credit.
///
/// It is `#[ignore]`d rather than written to pass because pinning today's
/// behaviour would lock the bug in. Run it with `cargo test -- --ignored` once
/// the rebinding fix lands; it should pass then, and the fix is expected to
/// move each of these keys and clear the old address's copy.
#[test]
#[ignore = "transfer does not rebind metadata/history/referral yet (fix not in tree)"]
fn scenario_transfer_subscription_rebinds_metadata_history_and_referral() {
    let (env, contract_id, token_addr, user_old, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_new = extra_user(&env, &contract_id, &token_addr);
    let referrer = Address::generate(&env);

    subscribe(
        &client,
        &user_old,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &Some(referrer.clone()),
    );

    // Give the old subscriber a label and a charge so both side tables are
    // non-empty before the transfer — an empty table would make the test pass
    // vacuously.
    let label = String::from_str(&env, "premium");
    client.set_metadata(&user_old, &label);
    env.ledger().set_timestamp(86_400);
    client.charge(&user_old);
    let history_before = client.get_charge_history(&user_old);
    assert!(!history_before.is_empty(), "history must be seeded");

    client.transfer_subscription(&user_old, &user_new);

    // The label follows the subscription.
    assert_eq!(
        client.get_subscription_label(&user_new),
        Some(label),
        "the metadata label did not follow the transferred subscription"
    );
    assert_eq!(client.get_subscription_label(&user_old), None);

    // The charge history follows too.
    assert_eq!(
        client.get_charge_history(&user_new),
        history_before,
        "charge history did not follow the transferred subscription"
    );
    assert!(client.get_charge_history(&user_old).is_empty());

    // Referral credit follows the subscriber.
    assert_eq!(client.get_referrer(&user_new), Some(referrer));
    assert_eq!(client.get_referrer(&user_old), None);
}

// ─────────────────────────────────────────────────────────────────────────────
// Estimate / live parity
// ─────────────────────────────────────────────────────────────────────────────

/// Guards estimate-vs-live parity: the keeper-facing
/// `get_batch_charge_estimate` must predict exactly the `ChargeResult` vector a
/// real `batch_charge` produces for the same users at the same ledger.
///
/// The scenario deliberately mixes every skip reason in one batch — no
/// subscription, not due, paused, insufficient allowance, and a real charge —
/// because a parity bug only shows up when the batch is heterogeneous. A keeper
/// that trusts the estimate and gets a different vector charges or skips the
/// wrong subscribers.
#[test]
fn scenario_estimate_matches_live_batch_outcomes() {
    let (env, contract_id, token_addr, user_due, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_not_due = extra_user(&env, &contract_id, &token_addr);
    let user_paused = extra_user(&env, &contract_id, &token_addr);
    let user_broke = extra_user(&env, &contract_id, &token_addr);
    let unknown = Address::generate(&env);

    subscribe(&client, &user_due, &merchant, 1_0000000, 86_400, &token_addr, &None);
    subscribe(&client, &user_not_due, &merchant, 1_0000000, 86_400, &token_addr, &None);
    subscribe(&client, &user_paused, &merchant, 1_0000000, 86_400, &token_addr, &None);
    subscribe(&client, &user_broke, &merchant, 1_0000000, 86_400, &token_addr, &None);

    // user_paused is paused, so it must skip as Paused.
    client.pause(&user_paused);
    // user_broke subscribed in the past and then lost its allowance.
    env.ledger().set_timestamp(86_400);
    client.charge(&user_broke);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_broke, &contract_id, &0, &200_000);

    // user_due becomes chargeable; user_not_due is still inside its interval
    // because it subscribed after the ledger advanced.
    env.ledger().set_timestamp(2 * 86_400);
    client.charge(&user_not_due);

    let users = soroban_sdk::vec![
        &env,
        user_due.clone(),
        user_not_due.clone(),
        user_paused.clone(),
        user_broke.clone(),
        unknown.clone(),
    ];

    let estimate = client.get_batch_charge_estimate(&users);
    let live = client.batch_charge(&users);

    assert_eq!(estimate.len(), 5, "one outcome per input address");
    assert_eq!(
        estimate, live,
        "the keeper-facing estimate disagrees with the live batch: a keeper \
         following the estimate would skip a chargeable subscriber, or charge \
         one the live path skips"
    );

    // Pin the expected mix so the scenario cannot pass by both paths being
    // uniformly wrong.
    assert_eq!(estimate.get(0).unwrap(), ChargeResult::Charged);
    assert_eq!(estimate.get(1).unwrap(), ChargeResult::Skipped);
    assert_eq!(estimate.get(2).unwrap(), ChargeResult::Paused);
    assert_eq!(estimate.get(3).unwrap(), ChargeResult::AllowanceInsufficient);
    assert_eq!(estimate.get(4).unwrap(), ChargeResult::NoSubscription);
}

/// Guards that the estimate is side-effect free: an estimate that writes
/// storage corrupts the very state it is predicting from, so the *next*
/// estimate disagrees with the first.
///
/// KNOWN GAP — `#[ignore]`d because the fix is not in the tree.
/// `get_batch_charge_estimate` calls `charge_exec::try_auto_resume`, which
/// clears `PauseExpiry` and rewrites the `Subscription` row when a pause has
/// expired. Run with `cargo test -- --ignored` once the estimate is made
/// read-only.
#[test]
#[ignore = "estimate still performs auto-resume storage writes (fix not in tree)"]
fn scenario_estimate_does_not_mutate_storage() {
    let (env, contract_id, token_addr, user_paused, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    subscribe(&client, &user_paused, &merchant, 1_0000000, 86_400, &token_addr, &None);
    client.pause_until(&user_paused, &5_000);

    // Move past the pause expiry so the next call would auto-resume.
    env.ledger().set_timestamp(6_000);

    let users = soroban_sdk::vec![&env, user_paused.clone()];
    let first = client.get_batch_charge_estimate(&users);

    // The paused subscription is still paused: an estimate must not resume it.
    assert!(
        client.get_subscription(&user_paused).unwrap().paused,
        "get_batch_charge_estimate auto-resumed the subscription: a dry run \
         mutated contract state"
    );
    assert!(!client.get_contract_config().paused, "contract not paused");

    // The second estimate must equal the first. A write inside the estimate
    // makes the prediction non-repeatable.
    let second = client.get_batch_charge_estimate(&users);
    assert_eq!(
        first, second,
        "two consecutive estimates disagree: the first one changed the state it reads"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Division-of-zero guards
// ─────────────────────────────────────────────────────────────────────────────

/// Guards every division whose divisor comes from user input.
///
/// The refund pro-rata is `amount * remaining / interval`. A zero interval is
/// unreachable through `subscribe` (which rejects it), so the scenario forges
/// the stored row to simulate a pre-guard deployment or a migration that wrote
/// a zero interval — exactly the state in which the division used to abort with
/// an opaque host error instead of a typed one.
#[test]
fn scenario_zero_interval_guards_division_by_zero() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // The public path is guarded up front.
    let res = client.try_subscribe(&user, &merchant, &1_0000000, &0u64, &token_addr, &None, &None);
    assert_eq!(
        res,
        Err(Ok(soroban_sdk::Error::from_contract_error(3))),
        "subscribe accepted a zero interval"
    );

    subscribe(&client, &user, &merchant, 1_0000000, 86_400, &token_addr, &None);

    // Forge a zero interval underneath the guard to reach the division itself.
    env.as_contract(&contract_id, || {
        let key = DataKey::Subscription(user.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key).unwrap();
        sub.interval = 0;
        env.storage().persistent().set(&key, &sub);
    });

    let res = client.try_cancel_and_refund_prorated(&user, &merchant);
    assert_eq!(
        res,
        Err(Ok(soroban_sdk::Error::from_contract_error(3))),
        "a zero interval reached the pro-rata division instead of failing typed"
    );

    // The interval floor is also enforced on the admin mutation path.
    subscribe(&client, &user, &merchant, 1_0000000, 86_400u64, &token_addr, &None);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    let res = client.try_set_subscription_interval(&user, &0u64);
    assert_eq!(
        res,
        Err(Ok(soroban_sdk::Error::from_contract_error(3))),
        "set_subscription_interval accepted a zero interval"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema-version guard
// ─────────────────────────────────────────────────────────────────────────────

/// Guards the schema-version guard across a multi-subscriber migration: while
/// `schema_version < CURRENT_VERSION`, every state-mutating subscribe is refused
/// regardless of who calls it, and the batch is only unblocked once `migrate`
/// has stamped the current version.
///
/// This is the migration-guard scenario: an operator paging through `migrate`
/// must not see fresh v3 rows interleaved with unmigrated ones, so the contract
/// refuses new writes until the page-out is complete.
#[test]
fn scenario_schema_version_guard_blocks_mutation() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = extra_user(&env, &contract_id, &token_addr);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    assert_eq!(
        client.get_contract_config().schema_version,
        CURRENT_VERSION,
        "a fresh deployment starts at the current schema"
    );

    // Simulate a pre-migration deployment.
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &(CURRENT_VERSION - 1));
    });
    assert_eq!(client.get_schema_version(), CURRENT_VERSION - 1);

    for user in [user_a.clone(), user_b.clone()] {
        let res = client.try_subscribe(&user, &merchant, &1_0000000, &86_400u64, &token_addr, &None, &None);
        assert_eq!(
            res,
            Err(Ok(soroban_sdk::Error::from_contract_error(42))),
            "subscribe was allowed below the current schema version"
        );
    }
    assert_eq!(client.get_active_count(), 0, "no partial writes escaped the guard");

    // Migration unblocks the batch for every user at once.
    let everyone = soroban_sdk::vec![&env, user_a.clone(), user_b.clone()];
    client.migrate(&everyone);
    assert_eq!(client.get_schema_version(), CURRENT_VERSION);

    for user in [user_a.clone(), user_b.clone()] {
        subscribe(&client, &user, &merchant, 1_0000000, 86_400u64, &token_addr, &None);
    }
    assert_eq!(client.get_active_count(), 2);
    assert_eq!(client.get_merchant_sub_count(&merchant), 2);
}
