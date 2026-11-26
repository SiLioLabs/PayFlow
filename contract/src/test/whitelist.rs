#[test]
#[should_panic]
fn test_subscribe_non_whitelisted_merchant_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.set_whitelist_enabled(&true);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
}

#[test]
fn test_subscribe_whitelisted_merchant_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.set_whitelist_enabled(&true);
    client.add_merchant(&merchant);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.merchant, merchant);
    assert!(client.is_merchant_whitelisted(&merchant));
}

#[test]
fn test_is_merchant_whitelisted_returns_false_for_non_whitelisted() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.set_whitelist_enabled(&true);
    assert!(!client.is_merchant_whitelisted(&merchant));
}

#[test]
fn test_set_whitelist_enabled_false_allows_any_merchant() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.set_whitelist_enabled(&true);
    client.set_whitelist_enabled(&false);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.merchant, merchant);
}

#[test]
fn test_get_whitelist_enabled_defaults_to_true() {
    let env = Env::default();
    let contract_id = env.register(FlowPay, ());
    let client = FlowPayClient::new(&env, &contract_id);

    assert!(client.get_whitelist_enabled());
}

#[test]
fn test_get_whitelist_enabled_toggles() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlowPay, ());
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Default is true
    assert!(client.get_whitelist_enabled());

    // False after set_whitelist_enabled(false)
    client.set_whitelist_enabled(&false);
    assert!(!client.get_whitelist_enabled());

    // True after re-enabling
    client.set_whitelist_enabled(&true);
    assert!(client.get_whitelist_enabled());
}

/// Regression test for #1014: is_merchant_whitelisted must return true after
/// add_merchant even though the duplicate MerchantWhitelist write was removed.
/// Only the canonical write (with TTL extension) should remain.
#[test]
fn test_add_merchant_is_whitelisted_after_single_write() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Before add_merchant, not whitelisted
    assert!(!client.is_merchant_whitelisted(&merchant));

    client.add_merchant(&merchant);

    // After add_merchant, must be whitelisted (single canonical write suffices)
    assert!(client.is_merchant_whitelisted(&merchant));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Merchant freeze tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// subscribe to a frozen merchant panics with ContractError::MerchantFrozen.
#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_subscribe_to_frozen_merchant_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.freeze_merchant(&merchant, &None);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
}

/// An existing subscriber can still be charged after their merchant is frozen â€”
/// freeze only blocks new subscriptions, not existing charge cycles.
#[test]
fn test_charge_succeeds_after_merchant_frozen() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    client.freeze_merchant(&merchant, &None);
    assert!(client.is_merchant_frozen(&merchant));

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.last_charged, interval + 1);
}

/// pay_per_use is unaffected by merchant freeze status for an existing subscriber.
#[test]
fn test_pay_per_use_succeeds_after_merchant_frozen() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.freeze_merchant(&merchant, &None);

    client.pay_per_use(&user, &1_0000000);

    assert_eq!(client.get_merchant_revenue(&merchant), 1_0000000);
}

/// is_merchant_frozen reflects freeze/unfreeze state changes.
#[test]
fn test_is_merchant_frozen_reflects_state() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    assert!(!client.is_merchant_frozen(&merchant));

    client.freeze_merchant(&merchant, &None);
    assert!(client.is_merchant_frozen(&merchant));

    client.unfreeze_merchant(&merchant);
    assert!(!client.is_merchant_frozen(&merchant));
}

/// Freezing a merchant that is not whitelisted must still succeed â€” the two
/// states (whitelist, freeze) are independent of each other.
#[test]
fn test_freeze_merchant_independent_of_whitelist() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Merchant is not whitelisted at all, and whitelist enforcement is off.
    assert!(!client.is_merchant_whitelisted(&merchant));

    client.freeze_merchant(&merchant, &None);
    assert!(client.is_merchant_frozen(&merchant));
    assert!(!client.is_merchant_whitelisted(&merchant));
}

/// freeze_merchant is idempotent â€” freezing an already-frozen merchant must not panic.
#[test]
fn test_freeze_merchant_idempotent() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.freeze_merchant(&merchant, &None);
    client.freeze_merchant(&merchant, &None);
    assert!(client.is_merchant_frozen(&merchant));
}

#[test]
fn test_freeze_merchant_reason_at_byte_limit() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Each character occupies two UTF-8 bytes, so this is exactly 128 bytes.
    let reason = soroban_sdk::String::from_str(&env, &"é".repeat(64));
    client.freeze_merchant(&merchant, &Some(reason.clone()));

    assert!(client.is_merchant_frozen(&merchant));
    assert_eq!(client.get_merchant_freeze_reason(&merchant), Some(reason));
}

#[test]
fn test_freeze_merchant_reason_too_long_returns_typed_error() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    let events_before = contract_events(&env).len();

    // Cover both the first invalid byte length and multibyte UTF-8 input.
    for text in ["a".repeat(129), "é".repeat(65)] {
        let reason = soroban_sdk::String::from_str(&env, &text);
        assert_eq!(
            client.try_freeze_merchant(&merchant, &Some(reason)),
            Err(Ok(soroban_sdk::Error::from_contract_error(
                crate::errors::ContractError::FreezeReasonTooLong as u32
            )))
        );
        assert!(!client.is_merchant_frozen(&merchant));
        assert_eq!(client.get_merchant_freeze_reason(&merchant), None);
        assert_eq!(contract_events(&env).len(), events_before);
    }
}

/// unfreeze_merchant on a non-frozen merchant must not panic.
#[test]
fn test_unfreeze_merchant_non_frozen_is_noop() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.unfreeze_merchant(&merchant);
    assert!(!client.is_merchant_frozen(&merchant));
}

// ─────────────────────────────────────────────────────────────────────
// Issue #821: freeze_merchant TTL archive-proofing
// ─────────────────────────────────────────────────────────────────────

/// Verify that `MerchantFrozen` and `MerchantFreezeReason` survive past the
/// SDK default live-until so a ban cannot silently lapse without an explicit
/// `unfreeze_merchant` call.
///
/// Pattern mirrors `test_extend_subscriber_index_ttl_extends_large_index`:
///   1. Raise `max_entry_ttl` so the environment accepts our extend target.
///   2. Freeze the merchant (stores both keys and calls extend_ttl).
///   3. Advance the ledger sequence past the old default archival point.
///   4. Confirm both keys still exist in persistent storage (TTL ≥ 1555200).
///   5. Confirm `is_merchant_frozen` still returns `true` (no silent un-ban).
///   6. Confirm that subscribing to the frozen merchant still panics.
#[test]
fn test_frozen_merchant_survives_past_default_archive_point() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Allow large TTL values so extend_ttl can reach the full 1555200 window.
    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    let reason = soroban_sdk::String::from_str(&env, "banned for policy violation");
    client.freeze_merchant(&merchant, &Some(reason));

    // Confirm both keys exist before the time jump.
    env.as_contract(&contract_id, || {
        assert!(
            env.storage()
                .persistent()
                .has(&DataKey::MerchantFrozen(merchant.clone())),
            "MerchantFrozen must exist immediately after freeze"
        );
        assert!(
            env.storage()
                .persistent()
                .has(&DataKey::MerchantFreezeReason(merchant.clone())),
            "MerchantFreezeReason must exist immediately after freeze"
        );
    });

    // Keep the contract instance alive across the ledger jump.
    env.as_contract(&contract_id, || {
        env.storage().instance().extend_ttl(2_000_000, 2_000_000);
    });

    // Advance past the SDK default archive point (4096 ledgers) but well within
    // the new 1555200-ledger window we extended to.
    env.ledger().with_mut(|l| {
        l.sequence_number += 100_000; // >> 4096 default, << 1555200 extended
    });

    // Both persistent keys must still be live.
    env.as_contract(&contract_id, || {
        let frozen_ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::MerchantFrozen(merchant.clone()));
        assert!(
            frozen_ttl >= 1_000_000,
            "MerchantFrozen TTL must be well above default archive point; got {frozen_ttl}"
        );

        let reason_ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::MerchantFreezeReason(merchant.clone()));
        assert!(
            reason_ttl >= 1_000_000,
            "MerchantFreezeReason TTL must be well above default archive point; got {reason_ttl}"
        );
    });

    // Public API must confirm the merchant is still frozen.
    assert!(
        client.is_merchant_frozen(&merchant),
        "is_merchant_frozen must return true after ledger advance"
    );

    // Attempting a new subscription must still be blocked.
    // NOTE: reuse the user funded in `setup()` — its token approval covers
    // 200,000 ledgers and outlives the 100,000-ledger jump above. A fresh
    // `setup_funded_user` here would approve with live_until = 200 and panic
    // inside the token contract before `subscribe` is ever reached.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.subscribe(
            &user,
            &merchant,
            &1_0000000,
            &86400,
            &token_addr,
            &None,
            &None,
        );
    }));
    assert!(
        result.is_err(),
        "subscribe to a frozen merchant must panic even after the ledger advance"
    );
}

/// `extend_merchant_state_ttl` keeps the whitelist, freeze, merchant-index and
/// merchant-revenue key groups alive past the default archive point
/// (Issue #1218). It does not change the TTL value itself.
#[test]
fn test_extend_merchant_state_ttl_extends_each_key_group() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Allow `extend_ttl` to reach the full ~90-day merchant window.
    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    let wl_merchant = Address::generate(&env);
    let frz_merchant = Address::generate(&env);
    let rev_merchant = Address::generate(&env);

    // Whitelist group (each add also lands the merchant in the index).
    client.add_merchant(&wl_merchant);
    client.add_merchant(&frz_merchant);

    // Freeze group.
    client.freeze_merchant(&frz_merchant, &None);

    // Merchant revenue group (indexed via add_merchant, revenue written directly).
    client.add_merchant(&rev_merchant);
    let today = env.ledger().timestamp() / 86400;
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(
            &DataKey::MerchantRevenue(rev_merchant.clone()),
            &5_000_000_000i128,
        );
        env.storage()
            .persistent()
            .set(&DataKey::MerchantSubCount(rev_merchant.clone()), &1u32);
        let mut days = Vec::new(&env);
        days.push_back(today);
        env.storage().persistent().set(
            &DataKey::MerchantRevenueDayIndex(rev_merchant.clone()),
            &days,
        );
        env.storage().persistent().set(
            &DataKey::MerchantRevenueDay(rev_merchant.clone(), today),
            &5_000_000_000i128,
        );
        let mut history = Vec::new(&env);
        history.push_back(5_000_000_000i128);
        env.storage().persistent().set(
            &DataKey::MerchantRevenueHistory(rev_merchant.clone()),
            &history,
        );
    });

    client.extend_merchant_state_ttl();
    let events = contract_events(&env);

    // Every key group must be extended to the merchant-state TTL window.
    env.as_contract(&contract_id, || {
        let assert_window = |key: &DataKey, label: &str| {
            let ttl = env.storage().persistent().get_ttl(key);
            assert!(
                ttl >= MERCHANT_STATE_TTL_LEDGERS / 2,
                "{label} TTL must reach the merchant window ({window}); got {ttl}",
                window = MERCHANT_STATE_TTL_LEDGERS,
            );
        };

        assert_window(&DataKey::WhitelistIndexSize, "WhitelistIndexSize");
        assert_window(&DataKey::WhitelistIndex(0), "WhitelistIndex(0)");
        assert_window(
            &DataKey::MerchantWhitelist(wl_merchant.clone()),
            "MerchantWhitelist",
        );
        assert_window(
            &DataKey::WhitelistIndexSlot(wl_merchant.clone()),
            "WhitelistIndexSlot",
        );
        assert_window(&DataKey::MerchantIndexSize, "MerchantIndexSize");
        assert_window(&DataKey::MerchantIndex(0), "MerchantIndex(0)");
        assert_window(
            &DataKey::MerchantKnown(frz_merchant.clone()),
            "MerchantKnown",
        );
        assert_window(
            &DataKey::MerchantFrozen(frz_merchant.clone()),
            "MerchantFrozen",
        );
        assert_window(
            &DataKey::MerchantRevenue(rev_merchant.clone()),
            "MerchantRevenue",
        );
        assert_window(
            &DataKey::MerchantSubCount(rev_merchant.clone()),
            "MerchantSubCount",
        );
        assert_window(
            &DataKey::MerchantRevenueDayIndex(rev_merchant.clone()),
            "MerchantRevenueDayIndex",
        );
        assert_window(
            &DataKey::MerchantRevenueDay(rev_merchant.clone(), today),
            "MerchantRevenueDay",
        );
        assert_window(
            &DataKey::MerchantRevenueHistory(rev_merchant.clone()),
            "MerchantRevenueHistory",
        );
    });

    // Count event consistent with `subscriber_index_ttl_extended`.
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let count: u64 = data.try_into_val(&env).unwrap();
    assert_eq!(
        topic_symbol,
        Symbol::new(&env, "merchant_state_ttl_extended")
    );
    assert!(
        count > 0,
        "merchant_state_ttl_extended must report a positive count"
    );
}

/// Re-freeze (freeze → unfreeze → freeze) extends the TTL on the second freeze
/// so the re-ban is also archive-proof.
#[test]
fn test_refreeze_merchant_extends_ttl() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    // First freeze, then unfreeze (removes both keys).
    client.freeze_merchant(&merchant, &None);
    client.unfreeze_merchant(&merchant);
    assert!(!client.is_merchant_frozen(&merchant));

    // Re-freeze: must write and TTL-extend the keys again.
    client.freeze_merchant(&merchant, &None);
    assert!(client.is_merchant_frozen(&merchant));

    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::MerchantFrozen(merchant.clone()));
        assert!(
            ttl >= 1_000_000,
            "MerchantFrozen TTL after re-freeze must be well above archive point; got {ttl}"
        );
    });
}

// ─────────────────────────────────────────────────────────────────────
// Issue #820: Idempotent whitelist/freeze event suppression tests
// ─────────────────────────────────────────────────────────────────────
//
// Event suppression policy (Issue #820):
//
// When an admin mutation is a noop (storage already in the desired state),
// the function must:
// 1. Not modify any storage
// 2. Not emit any event
//
// This prevents event spam when keepers or admin scripts retry operations.
// Indexers should not see duplicate events for the same logical state change.

/// freeze_merchant on an already-frozen merchant must not emit an event.
#[test]
fn test_freeze_merchant_idempotent_suppresses_event() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // First freeze emits event
    client.freeze_merchant(&merchant, &None);
    let events_after_first = contract_events(&env).len();

    // Second freeze is a noop — no new events
    client.freeze_merchant(&merchant, &None);
    let events_after_second = contract_events(&env).len();

    assert!(events_after_first > 0);
    assert_eq!(
        events_after_second, 0,
        "duplicate freeze must not emit event"
    );
}

/// unfreeze_merchant on a non-frozen merchant must not emit an event.
#[test]
fn test_unfreeze_merchant_non_frozen_suppresses_event() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let events_before = contract_events(&env).len();

    // Unfreeze on non-frozen is a noop — no events
    client.unfreeze_merchant(&merchant);
    let events_after = contract_events(&env).len();

    assert_eq!(
        events_before, events_after,
        "unfreeze on non-frozen must not emit event"
    );
}

/// remove_merchant for a non-whitelisted merchant must not emit an event.
#[test]
fn test_remove_merchant_non_whitelisted_suppresses_event() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let events_before = contract_events(&env).len();

    // Remove on non-whitelisted is a noop — no events
    client.remove_merchant(&merchant);
    let events_after = contract_events(&env).len();

    assert_eq!(
        events_before, events_after,
        "remove_merchant on non-whitelisted must not emit event"
    );
}

/// freeze_merchant preserves existing reason when re-frozen with None.
#[test]
fn test_freeze_merchant_idempotent_preserves_reason() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let reason = soroban_sdk::String::from_str(&env, "violation");
    client.freeze_merchant(&merchant, &Some(reason.clone()));

    // Re-freeze with None — noop, reason should be preserved
    client.freeze_merchant(&merchant, &None);
    assert_eq!(client.get_merchant_freeze_reason(&merchant), Some(reason));
}

/// freeze → unfreeze → freeze cycle emits exactly 3 events (one per state change).
#[test]
fn test_freeze_unfreeze_freeze_emits_exactly_three_events() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.freeze_merchant(&merchant, &None);
    assert_eq!(contract_events(&env).len(), 1);
    client.unfreeze_merchant(&merchant);
    assert_eq!(contract_events(&env).len(), 1);
    client.freeze_merchant(&merchant, &None);
    assert_eq!(contract_events(&env).len(), 1);
}

/// freeze → freeze → unfreeze → unfreeze emits exactly 2 events.
#[test]
fn test_freeze_freeze_unfreeze_unfreeze_emits_two_events() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.freeze_merchant(&merchant, &None); // event
    assert_eq!(contract_events(&env).len(), 1);
    client.freeze_merchant(&merchant, &None); // noop
    assert_eq!(contract_events(&env).len(), 0);
    client.unfreeze_merchant(&merchant); // event
    assert_eq!(contract_events(&env).len(), 1);
    client.unfreeze_merchant(&merchant); // noop
    assert_eq!(contract_events(&env).len(), 0);
}

// ─────────────────────────────────────────────
// CONTRACT-20: whitelist_batch_add / whitelist_batch_remove tests
// ─────────────────────────────────────────────

#[test]
fn test_whitelist_batch_add_three_merchants() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());
    merchants.push_back(m2.clone());
    merchants.push_back(m3.clone());

    let count = client.whitelist_batch_add(&merchants);

    assert_eq!(count, 3);
    assert!(client.is_merchant_whitelisted(&m1));
    assert!(client.is_merchant_whitelisted(&m2));
    assert!(client.is_merchant_whitelisted(&m3));
}

#[test]
fn test_whitelist_batch_remove_two_merchants() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    client.add_merchant(&m1);
    client.add_merchant(&m2);

    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());
    merchants.push_back(m2.clone());

    let count = client.whitelist_batch_remove(&merchants);

    assert_eq!(count, 2);
    assert!(!client.is_merchant_whitelisted(&m1));
    assert!(!client.is_merchant_whitelisted(&m2));
}

#[test]
fn test_whitelist_batch_add_duplicates_does_not_panic() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());
    merchants.push_back(m1.clone());

    // Issue #1236: only the first entry is a real add; the duplicate is a
    // suppressed no-op and must not count toward the returned value.
    let count = client.whitelist_batch_add(&merchants);

    assert_eq!(count, 1);
    assert!(client.is_merchant_whitelisted(&m1));
}

#[test]
fn test_whitelist_batch_remove_non_whitelisted_is_noop() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());

    // Issue #1236: removing a non-whitelisted merchant is a suppressed no-op
    // and must not count toward the returned value.
    let count = client.whitelist_batch_remove(&merchants);

    assert_eq!(count, 0);
    assert!(!client.is_merchant_whitelisted(&m1));
}

/// Issue #1236: re-adding an already-whitelisted merchant via
/// `whitelist_batch_add` is a no-op — count 0, no `merchant_added` event.
#[test]
fn test_whitelist_batch_add_double_add_is_noop_with_suppressed_event() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());

    // First batch add changes state and emits `merchant_added`.
    assert_eq!(client.whitelist_batch_add(&merchants), 1);
    let events_after_first = contract_events(&env).len();

    // Second batch add of the same merchant is a suppressed no-op.
    assert_eq!(client.whitelist_batch_add(&merchants), 0);
    let events_after_second = contract_events(&env).len();

    assert!(events_after_first > 0);
    assert_eq!(
        events_after_second, 0,
        "duplicate whitelist_batch_add must not emit event"
    );
    assert!(client.is_merchant_whitelisted(&m1));
}

/// Issue #1236: a mixed `whitelist_batch_add` batch counts only the entries
/// that actually changed state.
#[test]
fn test_whitelist_batch_add_mixed_batch_counts_only_new() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let existing = Address::generate(&env);
    let fresh = Address::generate(&env);
    client.add_merchant(&existing);

    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(existing.clone());
    merchants.push_back(fresh.clone());

    // Only `fresh` is a real add; `existing` is a suppressed no-op.
    assert_eq!(client.whitelist_batch_add(&merchants), 1);
    assert!(client.is_merchant_whitelisted(&existing));
    assert!(client.is_merchant_whitelisted(&fresh));
}

/// Issue #1236: removing an already-removed merchant via
/// `whitelist_batch_remove` is a no-op — count 0, no `merchant_removed` event.
#[test]
fn test_whitelist_batch_remove_double_remove_is_noop_with_suppressed_event() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());
    client.add_merchant(&m1);

    // First batch remove changes state and emits `merchant_removed`.
    assert_eq!(client.whitelist_batch_remove(&merchants), 1);
    let events_after_first = contract_events(&env).len();

    // Second batch remove of the same merchant is a suppressed no-op.
    assert_eq!(client.whitelist_batch_remove(&merchants), 0);
    let events_after_second = contract_events(&env).len();

    assert!(events_after_first > 0);
    assert_eq!(
        events_after_second, 0,
        "duplicate whitelist_batch_remove must not emit event"
    );
    assert!(!client.is_merchant_whitelisted(&m1));
}

/// Issue #1236: a mixed `whitelist_batch_remove` batch counts only the
/// entries that were actually whitelisted (and therefore removed).
#[test]
fn test_whitelist_batch_remove_mixed_batch_counts_only_whitelisted() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let whitelisted_a = Address::generate(&env);
    let not_whitelisted = Address::generate(&env);
    let whitelisted_b = Address::generate(&env);
    client.add_merchant(&whitelisted_a);
    client.add_merchant(&whitelisted_b);

    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(whitelisted_a.clone());
    merchants.push_back(not_whitelisted.clone());
    merchants.push_back(whitelisted_b.clone());

    // Only the two whitelisted merchants count; the middle entry is a
    // suppressed no-op.
    assert_eq!(client.whitelist_batch_remove(&merchants), 2);
    assert!(!client.is_merchant_whitelisted(&whitelisted_a));
    assert!(!client.is_merchant_whitelisted(&not_whitelisted));
    assert!(!client.is_merchant_whitelisted(&whitelisted_b));
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_whitelist_batch_add_exceeds_max_size_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut merchants = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        merchants.push_back(Address::generate(&env));
    }
    client.whitelist_batch_add(&merchants);
}

#[test]
fn test_max_whitelist_batch_size_defaults_to_50() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    assert_eq!(client.get_max_whitelist_batch_size(), 50);
    // The whitelist knob is independent of the charge-batch knob.
    client.set_max_batch_size(&10);
    assert_eq!(client.get_max_whitelist_batch_size(), 50);
    assert_eq!(client.get_max_batch_size(), 10);
}

#[test]
fn test_set_max_whitelist_batch_size_lowers_cap() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 2);

    client.set_max_whitelist_batch_size(&2);
    assert_eq!(client.get_max_whitelist_batch_size(), 2);

    // Exactly at the configured cap still succeeds.
    assert_eq!(client.whitelist_batch_add(&merchants), 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_whitelist_batch_add_over_configured_cap_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 3);

    client.set_max_whitelist_batch_size(&2);
    client.whitelist_batch_add(&merchants);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_whitelist_batch_remove_over_configured_cap_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 3);

    client.set_max_whitelist_batch_size(&2);
    client.whitelist_batch_remove(&merchants);
}

#[test]
fn test_raised_whitelist_batch_cap_allows_more_than_default() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 51);

    // 51 entries panic under the default cap; raising the cap admits them.
    client.set_max_whitelist_batch_size(&60);
    // This checks the contract cap independently of network transaction limits.
    env.cost_estimate().disable_resource_limits();
    assert_eq!(client.whitelist_batch_add(&merchants), 51);
    assert_eq!(client.get_whitelist_size(), 51);
}

#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_set_max_whitelist_batch_size_zero_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_max_whitelist_batch_size(&0);
}

#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_set_max_whitelist_batch_size_above_ceiling_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_max_whitelist_batch_size(&(MAX_BATCH_SIZE_CEILING + 1));
}

#[test]
#[should_panic]
fn test_pay_per_use_to_rejects_non_whitelisted_recipient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.add_merchant(&merchant);
    client.set_whitelist_enabled(&true);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let recipient = Address::generate(&env); // never whitelisted
    client.pay_per_use_to(&user, &1_0000000, &recipient);
}

// ─────────────────────────────────────────────────────────────
// Tests for Issue #637: WhitelistIndex & pagination
// ─────────────────────────────────────────────────────────────

#[test]
fn test_whitelist_index_size_page_and_swap_remove() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    assert_eq!(client.get_whitelist_size(), 0);
    assert_eq!(client.get_whitelist_page(&0, &10).len(), 0);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);

    client.add_merchant(&m1);
    client.add_merchant(&m2);
    client.add_merchant(&m3);

    // Idempotent double add does not increment index size
    client.add_merchant(&m2);

    assert_eq!(client.get_whitelist_size(), 3);

    let page_all = client.get_whitelist_page(&0, &10);
    assert_eq!(page_all.len(), 3);
    assert_eq!(page_all.get(0).unwrap(), m1);
    assert_eq!(page_all.get(1).unwrap(), m2);
    assert_eq!(page_all.get(2).unwrap(), m3);

    // Test pagination offset & limit
    let page_subset = client.get_whitelist_page(&1, &1);
    assert_eq!(page_subset.len(), 1);
    assert_eq!(page_subset.get(0).unwrap(), m2);

    // Remove middle item (m2) -> swap-remove moves m3 into index 1
    client.remove_merchant(&m2);
    assert_eq!(client.get_whitelist_size(), 2);

    let page_after_remove = client.get_whitelist_page(&0, &10);
    assert_eq!(page_after_remove.len(), 2);
    assert_eq!(page_after_remove.get(0).unwrap(), m1);
    assert_eq!(page_after_remove.get(1).unwrap(), m3);

    // Idempotent double remove does nothing
    client.remove_merchant(&m2);
    assert_eq!(client.get_whitelist_size(), 2);
}

/// Regression: get_whitelist_page must not trap on extreme u32 offset/limit
/// pairs and must clamp the page size like the other *_page readers
/// (Issue #1220).
#[test]
fn test_get_whitelist_page_overflow_safe() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    client.add_merchant(&m1);
    client.add_merchant(&m2);

    // limit == 0 returns an empty page.
    assert!(client.get_whitelist_page(&0, &0).is_empty());

    // offset past the size returns an empty page.
    assert!(client.get_whitelist_page(&100, &10).is_empty());

    // u32::MAX offset must not trap; the whitelist is smaller than the offset.
    assert!(client.get_whitelist_page(&u32::MAX, &10).is_empty());

    // u32::MAX limit is clamped to WHITELIST_PAGE_SIZE; only 2 merchants exist.
    let page = client.get_whitelist_page(&0, &u32::MAX);
    assert!(page.len() <= 2);
    assert!(page.iter().any(|m| m == m1));
    assert!(page.iter().any(|m| m == m2));

    // Both extreme at once must not trap.
    assert!(client.get_whitelist_page(&u32::MAX, &u32::MAX).is_empty());
}

// ─────────────────────────────────────────────────────────────
// Issue 041 (#836): MerchantFeeRecipient clearing tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_merchant_fee_recipient_cleared_on_remove_and_freeze() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let client = FlowPayClient::new(&env, &contract_id);
    let recipient = Address::generate(&env);

    client.add_merchant(&merchant);
    client.set_merchant_fee_recipient(&merchant, &recipient);
    assert_eq!(
        client.get_merchant_fee_recipient(&merchant),
        Some(recipient.clone())
    );

    client.remove_merchant(&merchant);
    assert_eq!(client.get_merchant_fee_recipient(&merchant), None);

    client.add_merchant(&merchant);
    client.set_merchant_fee_recipient(&merchant, &recipient);
    assert_eq!(
        client.get_merchant_fee_recipient(&merchant),
        Some(recipient.clone())
    );

    client.freeze_merchant(&merchant, &None);
    assert_eq!(client.get_merchant_fee_recipient(&merchant), None);
}

// ── #1027: whitelist_enabled ──────────────────────────────────

#[test]
fn test_whitelist_enabled_event_emitted_on_enable() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // setup() starts with whitelist disabled; turn it on.
    client.set_whitelist_enabled(&true);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let enabled: bool = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "whitelist_enabled"));
    assert!(enabled);
}

#[test]
fn test_whitelist_enabled_event_emitted_on_disable() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Enable first, then disable to check the disable event.
    client.set_whitelist_enabled(&true);
    client.set_whitelist_enabled(&false);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let enabled: bool = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "whitelist_enabled"));
    assert!(!enabled);
}

#[test]
fn test_whitelist_enabled_event_emitted_on_repeated_toggle() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Even a no-op toggle (same value) still emits — the contract does not
    // suppress duplicate-value calls, matching the issue scope.
    let expected = Symbol::new(&env, "whitelist_enabled");
    for _ in 0..2 {
        client.set_whitelist_enabled(&false);
        let count = contract_events(&env)
            .iter()
            .filter(|(_, topics, _)| {
                topics
                    .get(0)
                    .as_ref()
                    .and_then(|t| TryIntoVal::<_, Symbol>::try_into_val(t, &env).ok())
                    .is_some_and(|s| s == expected)
            })
            .count();

        assert_eq!(count, 1);
    }
}

// ── #1028: max_whitelist_batch_size_set ───────────────────────

#[test]
fn test_max_whitelist_batch_size_set_event_emitted() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_max_whitelist_batch_size(&25);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (old, new): (u32, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "max_wl_batch_size_set"));
    assert_eq!(old, 50u32); // default MAX_WHITELIST_BATCH_SIZE
    assert_eq!(new, 25u32);
}

#[test]
fn test_max_whitelist_batch_size_set_event_old_tracks_previous_value() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_max_whitelist_batch_size(&30);
    client.set_max_whitelist_batch_size(&10);

    let events = contract_events(&env);
    let (_, _, data) = events.get(events.len() - 1).unwrap();
    let (old, new): (u32, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(old, 30u32);
    assert_eq!(new, 10u32);
}

#[test]
fn test_max_whitelist_batch_size_set_event_old_is_default_before_first_override() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // First override — old must be the compile-time default (50).
    client.set_max_whitelist_batch_size(&100);

    let events = contract_events(&env);
    let (_, _, data) = events.get(events.len() - 1).unwrap();
    let (old, new): (u32, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(old, 50u32);
    assert_eq!(new, 100u32);
}

// ─────────────────────────────────────────────────────────────
// Issue #1219: O(1) remove_merchant with reverse whitelist index
// ─────────────────────────────────────────────────────────────

/// Regression: get_whitelist_page returns the same set before and after
/// removal when the whitelist is large (exercises the O(1) path).
#[test]
fn test_remove_merchant_large_whitelist_page_consistent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Add 20 merchants.
    let mut merchants: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);
    for _ in 0..20 {
        let m = Address::generate(&env);
        client.add_merchant(&m);
        merchants.push_back(m);
    }
    assert_eq!(client.get_whitelist_size(), 20);

    // Collect the full page before removal.
    let before = client.get_whitelist_page(&0, &20);
    assert_eq!(before.len(), 20);

    // Remove a merchant from the middle to trigger a swap-remove.
    let to_remove = merchants.get(10).unwrap();
    client.remove_merchant(&to_remove);

    assert_eq!(client.get_whitelist_size(), 19);
    assert!(!client.is_merchant_whitelisted(&to_remove));

    // The remaining page must contain every original merchant except the removed one.
    let after = client.get_whitelist_page(&0, &20);
    assert_eq!(after.len(), 19);
    for m in after.iter() {
        assert!(m != to_remove, "removed merchant must not appear in page");
        assert!(client.is_merchant_whitelisted(&m));
    }

    // Also verify the first merchant (slot 0) is still reachable.
    let first = merchants.get(0).unwrap();
    assert!(client.is_merchant_whitelisted(&first));
}

/// Removing all merchants one-by-one must leave an empty whitelist with no
/// stale index entries.
#[test]
fn test_remove_all_merchants_empties_whitelist() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let mut merchants: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);
    for _ in 0..10 {
        let m = Address::generate(&env);
        client.add_merchant(&m);
        merchants.push_back(m);
    }

    for m in merchants.iter() {
        client.remove_merchant(&m);
    }

    assert_eq!(client.get_whitelist_size(), 0);
    assert!(client.get_whitelist_page(&0, &10).is_empty());
}
