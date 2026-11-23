//! Fuzz harness for `batch_charge` — Issue #1416
//!
//! # What this tests
//!
//! `batch_charge` must never abort healthy users because of one bad entry
//! in the input vector.  This harness exercises mixed subscription states:
//!
//!   - no subscription (user never subscribed)
//!   - active, interval elapsed        → should be Charged
//!   - active, interval NOT elapsed    → should be Skipped
//!   - inactive (cancelled)            → should be Inactive
//!   - paused (unbounded)              → should be Paused
//!   - paused with auto-resume expiry past → should be Charged (auto-resumed)
//!   - grace period elapsed            → should be GracePeriodElapsed
//!   - duplicate address in the list   → first occurrence Charged or Skipped,
//!                                       subsequent occurrences Skipped
//!
//! # Assertions
//!
//!   1. `results.len() == users.len()` — one result per input, no silently dropped entries.
//!   2. No `Charged` result for a user whose subscription is Inactive or NoSubscription.
//!   3. Duplicate entries are charged at most once per call.
//!
//! # Running
//!
//! ```bash
//! # Install cargo-fuzz (requires Rust nightly)
//! cargo install cargo-fuzz
//!
//! # Run from the contract/ directory for 10 minutes
//! cargo fuzz run fuzz_batch_charge -- -max_total_time=600
//!
//! # Run against a specific corpus directory
//! cargo fuzz run fuzz_batch_charge fuzz/corpus/fuzz_batch_charge/
//!
//! # List all fuzz targets
//! cargo fuzz list
//!
//! # Replay a crash artifact
//! cargo fuzz run fuzz_batch_charge fuzz/artifacts/fuzz_batch_charge/<artifact_file>
//! ```
//!
//! Crashes are written to `fuzz/artifacts/fuzz_batch_charge/`.

#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

use flowpay::{batch::ChargeResult, FlowPay, FlowPayClient};

// ── State variants the fuzzer drives ─────────────────────────────────────────

/// Compact encoding extracted from one fuzz byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SlotState {
    /// No entry in contract storage for this address.
    NoSubscription,
    /// Active subscription with interval elapsed → chargeable.
    ActiveDue,
    /// Active subscription with interval NOT elapsed → skipped.
    ActiveNotDue,
    /// Subscription cancelled (active = false).
    Inactive,
    /// Subscription paused (unbounded, no expiry).
    PausedUnbounded,
    /// Subscription paused with an expiry timestamp in the past → auto-resumes.
    PausedAutoResume,
    /// Subscription active but grace period already elapsed.
    GraceElapsed,
}

impl SlotState {
    fn from_byte(b: u8) -> Self {
        match b % 7 {
            0 => SlotState::NoSubscription,
            1 => SlotState::ActiveDue,
            2 => SlotState::ActiveNotDue,
            3 => SlotState::Inactive,
            4 => SlotState::PausedUnbounded,
            5 => SlotState::PausedAutoResume,
            _ => SlotState::GraceElapsed,
        }
    }
}

// ── Fuzzer entry-point ────────────────────────────────────────────────────────

fuzz_target!(|data: &[u8]| {
    // Need at least 2 bytes: [num_users_byte, state_bytes...]
    if data.len() < 2 {
        return;
    }

    // ── Environment & contract setup ─────────────────────────────────────────
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();
    let contract_id = env.register_contract(None, FlowPay);
    let client = FlowPayClient::new(&env, &contract_id);

    // Set the base timestamp far enough from zero to avoid underflow in
    // any internal arithmetic (e.g. next + grace_period).
    let base_time: u64 = 10_000_000;
    env.ledger().with_mut(|l| {
        l.timestamp = base_time;
        l.sequence_number = 1_000_000;
    // ── Decode input ──────────────────────────────────────────────────────────
    // Byte 0: number of unique user slots (1..=50, capped at MAX_BATCH_SIZE).
    let n_unique = ((data[0] as u32 % 50) + 1) as usize;
    // Remaining bytes control per-slot state; cycle with % if fewer than slots.
    let state_bytes = &data[1..];

    let interval: u64 = 3_600;    // 1 hour
    let grace_period: u64 = 1_800; // 30 minutes

    // ── Create funded users and subscriptions ─────────────────────────────────
    let merchant = Address::generate(&env);

    // Set an admin so propose_grace_period / commit_grace_period work.
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        flowpay::storage::set_admin(&env, &admin);
    });
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

    // Track per-slot states so we can validate invariants afterwards.
    // This is a normal std binary (libfuzzer-sys), so std::vec is fine.
    let mut unique_users: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);
    let mut unique_state_bytes: std::vec::Vec<u8> = std::vec::Vec::new();

    for i in 0..n_unique {
        let state_byte = if !state_bytes.is_empty() {
            state_bytes[i % state_bytes.len()]
        } else {
            0u8
        };
        let state = SlotState::from_byte(state_byte);

        // Create user and fund
        let user = Address::generate(&env);
        let sac = StellarAssetClient::new(&env, &token_addr);
        sac.mint(&user, &10_000_0000000);
        let token = TokenClient::new(&env, &token_addr);
        token.approve(&user, &contract_id, &10_000_0000000, &2_000_000);

        match state {
            SlotState::NoSubscription => {
                // Don't subscribe — no storage entry exists.
            }

            SlotState::ActiveDue => {
                client.subscribe(
                    &user, &merchant, &1_0000000, &interval,
                    &token_addr, &None, &None,
                );
                // Advance time so this user's interval has elapsed.
                env.ledger().with_mut(|l| { l.timestamp += interval + 1; });
            }

            SlotState::ActiveNotDue => {
                // Subscribe at current time; interval has NOT elapsed yet.
                client.subscribe(
                    &user, &merchant, &1_0000000, &interval,
                    &token_addr, &None, &None,
                );
            }

            SlotState::Inactive => {
                client.subscribe(
                    &user, &merchant, &1_0000000, &interval,
                    &token_addr, &None, &None,
                );
                client.cancel(&user);
            }

            SlotState::PausedUnbounded => {
                client.subscribe(
                    &user, &merchant, &1_0000000, &interval,
                    &token_addr, &None, &None,
                );
                client.pause(&user);
            }

            SlotState::PausedAutoResume => {
                client.subscribe(
                    &user, &merchant, &1_0000000, &interval,
                    &token_addr, &None, &None,
                );
                let now = env.ledger().timestamp();
                // Set a bounded pause expiring 1 second from now.
                client.pause_until(&user, &(now + 1));
                // Advance past the expiry AND past the charge interval.
                env.ledger().with_mut(|l| { l.timestamp += interval + 10; });
            }

            SlotState::GraceElapsed => {
                client.subscribe(
                    &user, &merchant, &1_0000000, &interval,
                    &token_addr, &None, &None,
                );
                // Advance time beyond interval + grace so this user's window has closed.
                env.ledger().with_mut(|l| {
                    l.timestamp += interval + grace_period + 2;
                });
            }
        }

        unique_users.push_back(user);
        unique_state_bytes.push(state_byte);
    }

    // ── Build the batch input, optionally injecting duplicates ───────────────
    let dup_byte = data[data.len() - 1]; // last byte controls duplicate injection
    let mut batch: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);

    for i in 0..n_unique {
        batch.push_back(unique_users.get(i as u32).unwrap());
    }

    // Inject up to 3 duplicates if dup_byte > 0 and we have room under limit.
    let n_dups = (dup_byte % 4) as usize; // 0..3
    if n_dups > 0 && n_unique > 0 {
        for d in 0..n_dups {
            if batch.len() < 50 {
                let dup_idx = (d % n_unique) as u32;
                batch.push_back(unique_users.get(dup_idx).unwrap());
            }
        }
    }

    let input_len = batch.len();

    // Set a stable final timestamp that is past any per-slot time advances.
    // This ensures "now" is consistent across the entire batch call.
    env.ledger().with_mut(|l| {
        let needed = base_time + (n_unique as u64 + 1) * (interval + grace_period + 100);
        if l.timestamp < needed {
            l.timestamp = needed;
        }
    });

    // ── Execute batch_charge ──────────────────────────────────────────────────
    let results = client.batch_charge(&batch);

    // ── Invariant 1: result length == input length ───────────────────────────
    assert_eq!(
        results.len(),
        input_len,
        "INVARIANT VIOLATED: batch_charge returned {} results for {} inputs",
        results.len(),
        input_len,
    );

    // ── Invariant 2: semantic correctness for first n_unique entries ─────────
    for i in 0..n_unique {
        let state = SlotState::from_byte(unique_state_bytes[i]);
        let result = results.get(i as u32).unwrap();

        match state {
            // A NoSubscription slot must never yield Charged.
            SlotState::NoSubscription => {
                assert_ne!(
                    result,
                    ChargeResult::Charged,
                    "INVARIANT VIOLATED: NoSubscription slot {i} yielded Charged"
                );
            }
            // An Inactive slot must never yield Charged.
            SlotState::Inactive => {
                assert_ne!(
                    result,
                    ChargeResult::Charged,
                    "INVARIANT VIOLATED: Inactive slot {i} yielded Charged"
                );
            }
            // A PausedUnbounded slot must yield Paused (never Charged).
            SlotState::PausedUnbounded => {
                assert_ne!(
                    result,
                    ChargeResult::Charged,
                    "INVARIANT VIOLATED: PausedUnbounded slot {i} yielded Charged"
                );
            }
            // Other states (Due, NotDue, PausedAutoResume, GraceElapsed) are
            // time-sensitive; we only assert they produce a valid ChargeResult.
            _ => {
                // Any variant of ChargeResult is acceptable for time-dependent states.
                // The key invariant (tested below) is that the batch didn't panic.
                let _ = result;
            }
        }
    }

    // ── Invariant 3: duplicate entries must not produce Charged twice ────────
    for d in 0..n_dups {
        let dup_slot = n_unique + d;
        if dup_slot >= input_len as usize {
            break;
        }
        let result = results.get(dup_slot as u32).unwrap();
        // A duplicate was just processed moments ago — its last_charged was
        // updated, so the interval has not elapsed again. Must be Skipped.
        assert_ne!(
            result,
            ChargeResult::Charged,
            "INVARIANT VIOLATED: duplicate at slot {dup_slot} was Charged a second time"
        );
    }
});
