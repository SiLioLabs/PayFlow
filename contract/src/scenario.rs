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

use super::test::{setup, setup_funded_user};
use crate::migration::CURRENT_VERSION;

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
    client.subscribe(
        user, merchant, &amount, &interval, token_addr, &None, referrer,
    );
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
    subscribe(
        &client,
        &user_a,
        &merchant_a,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );
    subscribe(
        &client,
        &user_b,
        &merchant_a,
        1_0000000,
        86_400,
        &token_addr,
        &Some(referrer.clone()),
    );
    subscribe(
        &client,
        &user_c,
        &merchant_b,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );

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
    assert!(client.get_subscriber_at(&0).is_none());
    assert_eq!(count_events(&env, "cancelled", &user_a), 1);
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
    assert!(client.get_subscriber_at(&0).is_none());
    assert_eq!(
        count_events(&env, "cancelled", &user_a),
        1,
        "a no-op cancel must not emit a duplicate cancelled event"
    );

    // The subscription itself is unchanged, and the referrer of a *different*
    // user was not collateral damage.
    let sub = client.get_subscription(&user_a).unwrap();
    assert!(!sub.active);
    assert!(!sub.paused);
    assert_eq!(client.get_referrer(&user_b), Some(referrer.clone()));
    assert_eq!(client.get_merchant_sub_count(&merchant_b), 1);
}

/// Legacy pause_until rows had `paused && !active`; they remain in the raw
/// append-only index but are absent from active counts and active readers.
#[test]
fn scenario_legacy_paused_inactive_row_reader_semantics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    subscribe(
        &client,
        &user,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );

    env.as_contract(&contract_id, || {
        let key = DataKey::Subscription(user.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key).unwrap();
        sub.active = false;
        sub.paused = true;
        env.storage().persistent().set(&key, &sub);
        env.storage().instance().set(&DataKey::ActiveCount, &0u64);
        env.storage()
            .persistent()
            .set(&DataKey::MerchantSubCount(merchant.clone()), &0u64);
    });
    env.ledger().set_timestamp(86_401);

    assert_eq!(client.get_active_count(), 0);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);
    assert_eq!(client.get_merchant_subscriber_count(&merchant), 0);
    let merchant_counts =
        client.get_merchant_sub_counts(&soroban_sdk::vec![&env, merchant.clone()]);
    assert_eq!(merchant_counts.get(0), Some((merchant.clone(), 0)));
    assert_eq!(client.get_active_subscriber_page(&0, &10).len(), 0);
    assert!(client
        .get_next_charge_batch(&0, &10, &Some(false))
        .is_empty());

    // The raw subscriber page enumerates recorded slots, not active state.
    let raw_page = client.get_subscriber_page(&0, &10);
    assert_eq!(raw_page.len(), 1);
    assert_eq!(raw_page.get(0).unwrap(), user);
    assert_eq!(client.get_subscriber_at(&0), Some(user.clone()));
    // Merchant listings likewise enumerate the separate merchant index.
    assert_eq!(
        client.get_merchant_page(&0, &10).get(0),
        Some(merchant.clone())
    );
    assert_eq!(
        client.get_top_merchants_by_subs(&1).get(0),
        Some((merchant, 0))
    );
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

    subscribe(
        &client,
        &user_a,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );
    subscribe(
        &client,
        &user_b,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );

    client.cancel(&user_a);

    let merchants = soroban_sdk::vec![&env, merchant.clone()];
    let before = counters(&client, &merchants);
    assert_eq!(
        before,
        (1, 2, 1),
        "one of the two subscribers is already cancelled"
    );

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

    subscribe(
        &client,
        &user_a,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );
    subscribe(
        &client,
        &user_b,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );

    // One charge inside the (large) default cap.
    env.ledger().set_timestamp(86_400);
    client.charge(&user_a);
    let (accumulated, charge_window_start) = client.get_global_volume_window();
    assert_eq!(
        accumulated, 1_0000000,
        "the window accumulates live charges"
    );

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
    assert_eq!(
        sub_before.last_charged, 0,
        "rejected charge advanced last_charged"
    );

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

    subscribe(
        &client,
        &user_old,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );

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
    assert_eq!(
        client.get_active_count(),
        1,
        "a transfer is not a subscribe"
    );
    // Append-only: the old slot is tombstoned and the new address is appended,
    // so the raw index size grows to 2 while the live view still has one entry.
    assert_eq!(
        client.get_subscriber_count(),
        2,
        "index size after the re-seat"
    );
    assert_eq!(client.get_subscriber_at(&0), None, "old slot is tombstoned");
    assert_eq!(client.get_subscriber_at(&1), Some(user_new.clone()));
    assert_ne!(
        client.get_subscriber_at(&0),
        Some(user_old.clone()),
        "the transferred address is still in the subscriber index"
    );
    assert!(client.get_subscriber_page(&0, &10).contains(&user_new));

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

    subscribe(
        &client,
        &user_due,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );
    subscribe(
        &client,
        &user_not_due,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );
    subscribe(
        &client,
        &user_paused,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );
    subscribe(
        &client,
        &user_broke,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );

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
    assert_eq!(
        estimate.get(3).unwrap(),
        ChargeResult::AllowanceInsufficient
    );
    assert_eq!(estimate.get(4).unwrap(), ChargeResult::NoSubscription);
}

// ─────────────────────────────────────────────────────────────────────────────
// Randomized estimate / live property (issue #1435)
// ─────────────────────────────────────────────────────────────────────────────

/// Number of deterministic seeds the property below runs.
const PARITY_SEEDS: u64 = 64;

/// Seeded xorshift64* stream. Determinism matters: a failing property case
/// must be reproducible from the seed printed in the assertion message.
struct ParityRng {
    state: u64,
}

impl ParityRng {
    fn new(seed: u64) -> Self {
        Self {
            state: seed
                .wrapping_mul(0x9E37_79B9_7F4A_7C15)
                .wrapping_add(0xD1B5_4A32_D192_ED03)
                | 1,
        }
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform-ish value in `[0, upper)`. `upper` must be non-zero.
    fn below(&mut self, upper: u64) -> u64 {
        debug_assert!(upper > 0);
        self.next_u64() % upper
    }

    fn pick<T: Copy>(&mut self, values: &[T]) -> T {
        values[self.below(values.len() as u64) as usize]
    }
}

/// Valid subscription amounts, all well under `MAX_SUBSCRIPTION_AMOUNT` and
/// small enough that a generated batch stays below the hourly volume cap.
const PARITY_AMOUNTS: [i128; 6] = [
    1,
    1_000_000,
    50_000_000,
    12_345_678,
    100_000_000,
    999_999_999,
];

const PARITY_INTERVALS: [u64; 4] = [3_600, 86_400, 604_800, 2_592_000];

/// The subscription state written for one generated address.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ParityStateKind {
    NoSubscription,
    Inactive,
    PausedIndefinitely,
    PausedUnexpired,
    PausedExpired,
    ActiveNotDue,
    ActiveDue,
    ActiveDueGraceElapsed,
}

#[derive(Clone, Copy, Debug)]
struct ParitySubscription {
    kind: ParityStateKind,
    has_subscription: bool,
    amount: i128,
    interval: u64,
    last_charged: u64,
    active: bool,
    paused: bool,
    pause_expiry: Option<u64>,
    allowance: i128,
}

/// Generates one snapshot relative to `now`. `grace` is the contract-wide
/// grace period for the batch, so states can sit on both sides of the boundary.
fn generate_parity_subscription(rng: &mut ParityRng, now: u64, grace: u64) -> ParitySubscription {
    let amount = rng.pick(&PARITY_AMOUNTS);
    let interval = rng.pick(&PARITY_INTERVALS);

    let roll = rng.below(100);
    let kind = if roll < 10 {
        ParityStateKind::NoSubscription
    } else if roll < 17 {
        ParityStateKind::Inactive
    } else if roll < 23 {
        ParityStateKind::PausedIndefinitely
    } else if roll < 32 {
        ParityStateKind::PausedUnexpired
    } else if roll < 41 {
        ParityStateKind::PausedExpired
    } else if roll < 56 {
        ParityStateKind::ActiveNotDue
    } else if roll < 85 {
        ParityStateKind::ActiveDue
    } else if grace > 0 {
        ParityStateKind::ActiveDueGraceElapsed
    } else {
        ParityStateKind::ActiveDue
    };

    // Paused states are due once resumed, so anchor them at the due boundary.
    let due_anchor = now.saturating_sub(interval);
    let extra = rng.below(3_600);

    let (last_charged, active, paused, pause_expiry) = match kind {
        ParityStateKind::NoSubscription => (due_anchor, false, false, None),
        ParityStateKind::Inactive => (due_anchor, false, false, None),
        ParityStateKind::PausedIndefinitely => (due_anchor, true, true, Some(u64::MAX)),
        ParityStateKind::PausedUnexpired => {
            let expiry = now.saturating_add(1).saturating_add(extra);
            (due_anchor, false, true, Some(expiry))
        }
        ParityStateKind::PausedExpired => {
            let expiry = now.saturating_sub(1).saturating_sub(extra);
            (due_anchor, false, true, Some(expiry))
        }
        ParityStateKind::ActiveNotDue => {
            let delta = 1 + rng.below(interval);
            (due_anchor.saturating_add(delta), true, false, None)
        }
        ParityStateKind::ActiveDue => {
            let within_grace = if grace > 0 { rng.below(grace) } else { 0 };
            (due_anchor.saturating_sub(within_grace), true, false, None)
        }
        ParityStateKind::ActiveDueGraceElapsed => {
            let lapse = interval
                .saturating_add(grace)
                .saturating_add(1)
                .saturating_add(extra);
            (now.saturating_sub(lapse), true, false, None)
        }
    };

    // Zero, half, one short, exactly enough, and comfortably enough: the
    // boundary cases the two paths must agree on.
    let allowance = match rng.below(5) {
        0 => 0,
        1 => amount / 2,
        2 => (amount - 1).max(0),
        3 => amount,
        _ => amount.saturating_mul(2),
    };

    ParitySubscription {
        kind,
        has_subscription: kind != ParityStateKind::NoSubscription,
        amount,
        interval,
        last_charged,
        active,
        paused,
        pause_expiry,
        allowance,
    }
}

/// Facts about one batch position that the divergence whitelist needs.
struct ParityBatchContext {
    repeated_address: bool,
    charged_earlier: bool,
}

/// Returns `Some(reason)` only for divergences documented in
/// `docs/architecture/BATCH-ESTIMATE-VS-LIVE.md`. Everything else is an
/// undocumented divergence and must fail the property.
fn documented_parity_divergence(
    estimate: ChargeResult,
    live: ChargeResult,
    context: &ParityBatchContext,
) -> Option<&'static str> {
    if estimate == live {
        return None;
    }

    match (estimate, live) {
        // Live persists `last_charged` after the first successful charge, so a
        // repeated address later in the same batch is no longer due. The
        // estimate is stateless within a batch and reports every position from
        // the pre-batch snapshot.
        (ChargeResult::Charged, ChargeResult::Skipped)
            if context.repeated_address && context.charged_earlier =>
        {
            Some(
                "repeated address: live returns Skipped after charging the address earlier in the batch",
            )
        }
        _ => None,
    }
}

fn write_parity_subscription(
    env: &Env,
    contract_id: &Address,
    token_addr: &Address,
    merchant: &Address,
    user: &Address,
    generated: &ParitySubscription,
    now: u64,
) {
    env.as_contract(contract_id, || {
        storage::set_subscription(
            env,
            user,
            &Subscription {
                merchant: merchant.clone(),
                amount: generated.amount,
                interval: generated.interval,
                last_charged: generated.last_charged,
                active: generated.active,
                paused: generated.paused,
                token: token_addr.clone(),
                referrer: None,
                label: Symbol::new(env, "parity"),
                trial_duration: 0,
                created_at: now,
            },
        );
        match generated.pause_expiry {
            Some(expiry) => storage::set_pause_expiry(env, user, expiry),
            None => storage::clear_pause_expiry(env, user),
        }
    });
}

/// Property: over seeded random states, `get_batch_charge_estimate` and live
/// `batch_charge` return the same `ChargeResult` at every position, except for
/// the whitelisted, documented divergences.
///
/// The generator covers every skip reason, boundary allowances, grace
/// boundaries, expired/future/indefinite pauses, configured fee rates and
/// repeated addresses. A failure prints the seed, batch layout, state, grace
/// period and fee rate needed to reproduce it.
#[test]
fn scenario_property_estimate_matches_live_batch_outcomes() {
    let mut outcome_counts = [0u32; 7];
    let mut whitelisted = 0u32;

    for seed in 0..PARITY_SEEDS {
        let (env, contract_id, token_addr, _unused_user, merchant) = setup();
        let client = FlowPayClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.as_contract(&contract_id, || storage::set_admin(&env, &admin));

        let mut rng = ParityRng::new(seed);
        let now: u64 = 1_700_000_000 + rng.below(31_536_000);
        env.ledger().set_timestamp(now);

        let grace_period = rng.pick(&[0u64, 3_600, 86_400]);
        if grace_period > 0 {
            client.propose_grace_period(&grace_period);
            client.commit_grace_period();
        }

        let fee_bps = rng.pick(&[0u32, 250, 1_000]);
        if fee_bps > 0 {
            let collector = Address::generate(&env);
            client.propose_fee(&collector, &fee_bps);
            client.commit_fee();
        }

        // One snapshot per unique address; the batch then draws from that pool
        // with replacement, so repeated-address positions are exercised too.
        let pool_len = 1 + rng.below(3) as usize;
        let mut users: std::vec::Vec<Address> = std::vec::Vec::new();
        let mut generated: std::vec::Vec<ParitySubscription> = std::vec::Vec::new();
        for _ in 0..pool_len {
            let user = Address::generate(&env);
            let state = generate_parity_subscription(&mut rng, now, grace_period);
            if state.has_subscription {
                StellarAssetClient::new(&env, &token_addr)
                    .mint(&user, &state.amount.saturating_mul(3));
                TokenClient::new(&env, &token_addr)
                    .approve(&user, &contract_id, &state.allowance, &200_000);
                write_parity_subscription(
                    &env,
                    &contract_id,
                    &token_addr,
                    &merchant,
                    &user,
                    &state,
                    now,
                );
            }
            users.push(user);
            generated.push(state);
        }

        let batch_len = 1 + rng.below(6) as usize;
        let mut batch_indices: std::vec::Vec<usize> = std::vec::Vec::new();
        let mut batch: Vec<Address> = Vec::new(&env);
        for _ in 0..batch_len {
            let index = rng.below(pool_len as u64) as usize;
            batch_indices.push(index);
            batch.push_back(users[index].clone());
        }

        let estimate = client.get_batch_charge_estimate(&batch);
        let live = client.batch_charge(&batch);

        let mut seen: std::vec::Vec<bool> = std::vec::Vec::new();
        seen.resize(pool_len, false);
        let mut charged_earlier: std::vec::Vec<bool> = std::vec::Vec::new();
        charged_earlier.resize(pool_len, false);

        for (position, index) in batch_indices.iter().enumerate() {
            let estimate_result = estimate.get(position as u32).unwrap();
            let live_result = live.get(position as u32).unwrap();
            let context = ParityBatchContext {
                repeated_address: seen[*index],
                charged_earlier: charged_earlier[*index],
            };

            match documented_parity_divergence(
                estimate_result.clone(),
                live_result.clone(),
                &context,
            ) {
                Some(reason) => {
                    whitelisted += 1;
                    assert!(
                        context.repeated_address && context.charged_earlier,
                        "whitelist matched {reason} without a repeated charged address (seed {seed})"
                    );
                }
                None => assert_eq!(
                    estimate_result, live_result,
                    "undocumented estimate/live divergence at seed {seed}, position {position}: estimate={estimate:?}, live={live:?}, batch={batch_indices:?}, state={:?}, grace={grace_period}, fee_bps={fee_bps}. Documented divergences: docs/architecture/BATCH-ESTIMATE-VS-LIVE.md",
                    generated[*index]
                ),
            }

            match live_result.clone() {
                ChargeResult::Charged => outcome_counts[0] += 1,
                ChargeResult::Skipped => outcome_counts[1] += 1,
                ChargeResult::NoSubscription => outcome_counts[2] += 1,
                ChargeResult::Inactive => outcome_counts[3] += 1,
                ChargeResult::Paused => outcome_counts[4] += 1,
                ChargeResult::GracePeriodElapsed => outcome_counts[5] += 1,
                ChargeResult::AllowanceInsufficient => outcome_counts[6] += 1,
            }

            seen[*index] = true;
            charged_earlier[*index] |= live_result == ChargeResult::Charged;
        }
    }

    assert!(
        whitelisted > 0,
        "generator never produced a whitelisted divergence; the duplicate-address path is untested"
    );
    assert!(
        outcome_counts.iter().all(|count| *count > 0),
        "generator must exercise every ChargeResult variant, saw {outcome_counts:?}"
    );
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

    subscribe(
        &client,
        &user_paused,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );
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
    let res = client.try_subscribe(
        &user,
        &merchant,
        &1_0000000,
        &0u64,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(
        res,
        Err(Ok(soroban_sdk::Error::from_contract_error(3))),
        "subscribe accepted a zero interval"
    );

    subscribe(
        &client,
        &user,
        &merchant,
        1_0000000,
        86_400,
        &token_addr,
        &None,
    );

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
    subscribe(
        &client,
        &user,
        &merchant,
        1_0000000,
        86_400u64,
        &token_addr,
        &None,
    );
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
        let res = client.try_subscribe(
            &user,
            &merchant,
            &1_0000000,
            &86_400u64,
            &token_addr,
            &None,
            &None,
        );
        assert_eq!(
            res,
            Err(Ok(soroban_sdk::Error::from_contract_error(42))),
            "subscribe was allowed below the current schema version"
        );
    }
    assert_eq!(
        client.get_active_count(),
        0,
        "no partial writes escaped the guard"
    );

    // Migration unblocks the batch for every user at once.
    let everyone = soroban_sdk::vec![&env, user_a.clone(), user_b.clone()];
    client.migrate(&everyone);
    assert_eq!(client.get_schema_version(), CURRENT_VERSION);

    for user in [user_a.clone(), user_b.clone()] {
        subscribe(
            &client,
            &user,
            &merchant,
            1_0000000,
            86_400u64,
            &token_addr,
            &None,
        );
    }
    assert_eq!(client.get_active_count(), 2);
    assert_eq!(client.get_merchant_sub_count(&merchant), 2);
}
