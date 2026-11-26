// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #194: get_trial_end() tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_trial_end_with_trial_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    let trial_period: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &Some(trial_period),
        &None,
    );

    assert_eq!(client.get_trial_end(&user), Some(now + trial_period));
}

#[test]
fn test_get_trial_end_without_trial_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert!(client.get_trial_end(&user).is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_charge_before_trial_end_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &Some(86400u64),
        &None,
    );

    client.charge(&user);
}

#[test]
fn test_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active);
}

// â”€â”€ Issue #14: cancel nonexistent subscription â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// cancel() must panic with "no subscription found" when called on a user with no subscription.
#[test]
#[should_panic]
fn test_cancel_nonexistent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let random = Address::generate(&env);
    client.cancel(&random);
}

#[test]
#[should_panic]
fn test_zero_interval() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &0, &token_addr, &None, &None);
}

#[test]
#[should_panic]
fn test_interval_too_short() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &59, &token_addr, &None, &None);
}

#[test]
fn test_interval_minimum_valid() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.set_min_interval(&60u64);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.interval, 3600);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Cancel + charge edge cases
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
#[should_panic]
fn test_charge_after_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += 86401;
    });

    client.charge(&user);
}

#[test]
fn test_cancel_and_refund_prorated_transfers_expected_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    sac.mint(&merchant, &10_000_0000000);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp = 900;
    });

    let merchant_balance_before = token.balance(&merchant);
    let user_balance_before = token.balance(&user);

    client.cancel_and_refund_prorated(&user, &merchant);

    assert_eq!(
        token.balance(&merchant),
        merchant_balance_before - 7_500_000
    );
    assert_eq!(token.balance(&user), user_balance_before + 7_500_000);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active);
}

#[test]
fn test_cancel_and_refund_prorated_at_period_start_refunds_full_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    sac.mint(&merchant, &10_000_0000000);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );

    let merchant_balance_before = token.balance(&merchant);
    let user_balance_before = token.balance(&user);

    client.cancel_and_refund_prorated(&user, &merchant);

    assert_eq!(
        token.balance(&merchant),
        merchant_balance_before - 1_0000000
    );
    assert_eq!(token.balance(&user), user_balance_before + 1_0000000);
    assert!(!client.get_subscription(&user).unwrap().active);
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_cancel_and_refund_prorated_at_interval_end_rejects_zero_refund() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let sac = StellarAssetClient::new(&env, &token_addr);

    sac.mint(&merchant, &10_000_0000000);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp = 3600;
    });

    client.cancel_and_refund_prorated(&user, &merchant);
}

#[test]
#[should_panic(expected = "Error(Contract, #38)")]
fn test_cancel_and_refund_prorated_rejects_wrong_merchant() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let actual_merchant = Address::generate(&env);

    client.subscribe(
        &user,
        &actual_merchant,
        &1_0000000,
        &3600,
        &_token_addr,
        &None,
        &None,
    );

    client.cancel_and_refund_prorated(&user, &merchant);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_cancel_and_refund_prorated_missing_subscription_panics() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.cancel_and_refund_prorated(&user, &merchant);
}

#[test]
fn test_cancel_and_refund_prorated_underfunded_merchant_is_atomic() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| l.timestamp = 1800);

    let merchant_balance_before = token.balance(&merchant);
    let user_balance_before = token.balance(&user);
    let result = client.try_cancel_and_refund_prorated(&user, &merchant);

    assert!(result.is_err());
    assert_eq!(token.balance(&merchant), merchant_balance_before);
    assert_eq!(token.balance(&user), user_balance_before);
    assert!(client.get_subscription(&user).unwrap().active);
}

#[test]
fn test_cancel_and_refund_prorated_inactive_subscription_is_atomic() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);

    let result = client.try_cancel_and_refund_prorated(&user, &merchant);

    assert!(result.is_err());
    assert!(!client.get_subscription(&user).unwrap().active);
}

#[test]
fn test_cancel_and_refund_prorated_paused_subscription_is_atomic() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    let result = client.try_cancel_and_refund_prorated(&user, &merchant);

    assert!(result.is_err());
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert!(sub.paused);
}

#[test]
fn test_active_count_decrements_on_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_active_count(), 1);
    client.cancel(&user);
    assert_eq!(client.get_active_count(), 0);
}

// ─────────────────────────────────────────────
// Issue 013: PauseExpiry TTL coupled with subscription bump
// ─────────────────────────────────────────────

#[test]
fn test_bump_subscription_extends_pause_expiry_when_present() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &90000);

    // Verify PauseExpiry exists before bump
    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert!(
            expiry.is_some(),
            "PauseExpiry should exist after pause_until"
        );
    });

    // Bump subscription TTL — should also bump PauseExpiry
    client.bump_subscription(&user);

    // PauseExpiry should still exist (not archived)
    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert!(
            expiry.is_some(),
            "PauseExpiry should survive bump_subscription"
        );
        assert_eq!(expiry.unwrap(), 90000);
    });
}

#[test]
fn test_bump_subscription_no_op_on_absent_pause_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    // No PauseExpiry — bump should be a safe no-op
    client.bump_subscription(&user);

    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert_eq!(expiry, None, "PauseExpiry should remain absent");
    });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// min_interval tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// get_min_interval returns 3600 (1 hour) before any admin configuration.
#[test]
fn test_get_min_interval_default() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_min_interval(), 3600);
}

#[test]
fn test_min_interval_event_emitted_on_set() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);

    // Verify default value is 3600 before setting
    assert_eq!(client.get_min_interval(), 3600);

    // First set: old value should be 3600 default, new value 7200
    client.set_min_interval(&7200u64);
    let events_vec = contract_events(&env);
    assert_eq!(client.get_min_interval(), 7200);

    let (_, topics, data) = events_vec.get(events_vec.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "min_interval_set"));

    let event_data: events::MinIntervalSetEventData = data.try_into_val(&env).unwrap();
    assert_eq!(event_data.old, 3600);
    assert_eq!(event_data.new, 7200);

    // Second set: old value 7200, new value 86400
    client.set_min_interval(&86400u64);
    let events_vec2 = contract_events(&env);
    assert_eq!(client.get_min_interval(), 86400);

    let (_, topics2, data2) = events_vec2.get(events_vec2.len() - 1).unwrap();
    let topic_symbol2: Symbol = topics2.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol2, Symbol::new(&env, "min_interval_set"));

    let event_data2: events::MinIntervalSetEventData = data2.try_into_val(&env).unwrap();
    assert_eq!(event_data2.old, 7200);
    assert_eq!(event_data2.new, 86400);

    // Same value set again: old == 86400, new == 86400
    client.set_min_interval(&86400u64);
    let events_vec3 = contract_events(&env);
    let (_, topics3, data3) = events_vec3.get(events_vec3.len() - 1).unwrap();
    let topic_symbol3: Symbol = topics3.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol3, Symbol::new(&env, "min_interval_set"));

    let event_data3: events::MinIntervalSetEventData = data3.try_into_val(&env).unwrap();
    assert_eq!(event_data3.old, 86400);
    assert_eq!(event_data3.new, 86400);
}

/// set_min_interval(0) aborts with the typed IntervalMustBePositive (code 3).
#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_set_min_interval_zero_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);
    client.set_min_interval(&0u64);
}

/// set_min_interval(0) maps to the typed IntervalMustBePositive (code 3), not a
/// host panic string, and leaves the floor at its default.
#[test]
fn test_set_min_interval_zero_maps_to_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);

    assert_eq!(
        client.try_set_min_interval(&0u64),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::IntervalMustBePositive as u32
        ))),
        "set_min_interval(0) must map to ContractError::IntervalMustBePositive"
    );

    assert_eq!(
        client.get_min_interval(),
        crate::min_interval::DEFAULT_MIN_INTERVAL,
        "a rejected zero floor must not be persisted"
    );
}

/// The pre-initialize admin read behind `require_admin` maps to the typed
/// NotInitialized (code 7) so clients can branch on a wire code.
#[test]
fn test_set_min_interval_uninitialized_maps_to_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(
        client.try_set_min_interval(&7200u64),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::NotInitialized as u32
        ))),
        "pre-initialize admin read must map to ContractError::NotInitialized"
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// -------------------------------------------------------------
// Issue #45: resume/cancel on grace-lapsed subscriptions
// -------------------------------------------------------------

/// resume on a grace-lapsed subscription must panic with ResumeGraceLapsed (#100).
#[test]
#[should_panic(expected = "Error(Contract, #43)")]
fn test_resume_after_grace_lapse_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let grace_period: u64 = 86400;
    let interval: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    // Advance past interval + grace window
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period + 1;
    });

    // resume must be rejected because the grace window has closed
    client.resume(&user);
}

/// cancel on a grace-lapsed subscription must still succeed.
#[test]
fn test_cancel_after_grace_lapse_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let grace_period: u64 = 86400;
    let interval: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    // Advance past interval + grace window
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period + 1;
    });

    // cancel must still be allowed so the user can exit cleanly
    client.cancel(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active, "subscription should be inactive after cancel");
}

/// resume within a valid (non-lapsed) grace window must succeed normally.
#[test]
fn test_resume_within_grace_window_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let grace_period: u64 = 86400;
    let interval: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    // Advance past interval but still inside the grace window
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period / 2;
    });

    // resume must succeed because the grace window has not yet closed
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(
        !sub.paused,
        "subscription should not be paused after resume"
    );
    assert!(sub.active, "subscription should remain active");
}

/// resume when no grace period is configured must succeed regardless of elapsed time.
#[test]
fn test_resume_no_grace_period_always_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No grace period set -- default is 0
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
    client.pause(&user);

    // Advance far past the interval -- grace is 0 so lapse check is skipped
    env.ledger().with_mut(|l| {
        l.timestamp += interval * 10;
    });

    // resume must succeed because grace_period == 0 means no lapse
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(
        !sub.paused,
        "subscription should not be paused after resume"
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tests for pause() and resume()
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_pause_sets_paused_true() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.paused);
}

#[test]
#[should_panic]
fn test_charge_on_paused_subscription_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

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
    client.pause(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
}

#[test]
#[should_panic]
fn test_pay_per_use_on_paused_subscription_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    client.pay_per_use(&user, &1_0000000);
}

#[test]
fn test_resume_unpauses_and_charge_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

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
    client.pause(&user);
    client.resume(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.last_charged > 0);
}

#[test]
#[should_panic]
fn test_pause_on_inactive_subscription_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);
    client.pause(&user);
}

#[test]
fn test_next_charge_at_none_after_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

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
    client.cancel(&user);

    assert!(client.next_charge_at(&user).is_none());
}

#[test]
fn test_transfer_subscription_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let new_user = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&new_user, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&new_user, &contract_id, &10_000_0000000, &200);

    client.transfer_subscription(&user, &new_user);

    assert!(
        client.get_subscription(&user).is_none(),
        "old subscription should be removed"
    );

    let new_sub = client.get_subscription(&new_user).unwrap();
    assert!(new_sub.active, "new subscription should be active");
    assert_eq!(new_sub.merchant, merchant);
    assert_eq!(new_sub.amount, 1_0000000);
    assert_eq!(client.get_subscriber_count(), 2);
    assert_eq!(client.get_subscriber_at(&0u64), None);
    assert_eq!(client.get_subscriber_at(&1u64), Some(new_user));
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);
}

#[test]
fn test_transfer_subscription_to_inactive_user_reuses_tombstone_membership() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let new_user = setup_funded_user(&env, &contract_id, &token_addr);
    let inactive_merchant = Address::generate(&env);

    client.subscribe(
        &new_user,
        &inactive_merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&new_user);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.transfer_subscription(&user, &new_user);

    assert_eq!(client.get_merchant_sub_count(&merchant), 1);
    assert_eq!(client.get_merchant_sub_count(&inactive_merchant), 0);
    assert_eq!(client.get_subscriber_count(), 3);
    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap(), new_user);
}

#[test]
fn test_transfer_subscription_event_emitted() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let new_user = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&new_user, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&new_user, &contract_id, &10_000_0000000, &200);

    client.transfer_subscription(&user, &new_user);

    let mut seen_detailed = false;
    let mut seen_compact = false;
    for (_, topics, data) in contract_events(&env).iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        if topic_symbol == Symbol::new(&env, "subscription_transferred") {
            let topic_from: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
            let topic_to: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
            assert_eq!(topic_from, user);
            assert_eq!(topic_to, new_user);

            let event_payload: (Address, i128, u64, Address) = data.try_into_val(&env).unwrap();
            assert_eq!(event_payload.0, merchant);
            assert_eq!(event_payload.1, 1_0000000);
            assert_eq!(event_payload.2, 86400);
            assert_eq!(event_payload.3, token_addr);
            seen_detailed = true;
        }
        if topic_symbol == Symbol::new(&env, "sub_transferred") {
            let topic_from: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
            let new_addr: Address = data.try_into_val(&env).unwrap();
            assert_eq!(topic_from, user);
            assert_eq!(new_addr, new_user);
            seen_compact = true;
        }
    }

    assert!(seen_detailed, "expected a subscription_transferred event");
    assert!(seen_compact, "expected a sub_transferred event");
}

#[test]
#[should_panic]
fn test_transfer_subscription_to_active_user_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let new_user = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&new_user, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&new_user, &contract_id, &10_000_0000000, &200);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &new_user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.transfer_subscription(&user, &new_user);
}

/// Setting an interval of zero must panic with IntervalMustBePositive.
#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_set_subscription_interval_zero_panics() {
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

    client.set_subscription_interval(&user, &0);
}

/// Updating the interval for a non-existent subscription must panic with
/// NoSubscriptionFound.
#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_set_subscription_interval_no_subscription_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let random = Address::generate(&env);
    client.set_subscription_interval(&random, &86400);
}

/// Token conservation across charge, pay-per-use and prorated refund. Merchant
/// revenue remains a tracking counter because funds settle directly to wallets.
#[test]
fn test_accounting_invariant_across_charge_pay_per_use_and_refund() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let amount = 10_000_000i128;
    let interval = 10_000u64;
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let total = || token.balance(&user) + token.balance(&merchant) + token.balance(&contract_id);
    let before = total();
    env.ledger().with_mut(|l| l.timestamp += interval + 1);
    client.charge(&user);
    assert_eq!(total(), before, "charge: token balances must be conserved");
    assert_eq!(
        client.get_merchant_revenue(&merchant),
        amount,
        "charge: revenue counter must equal merchant settlement"
    );

    client.pay_per_use(&user, &1_000_000);
    assert_eq!(
        total(),
        before,
        "pay_per_use: token balances must be conserved"
    );
    assert_eq!(
        client.get_merchant_revenue(&merchant),
        amount + 1_000_000,
        "pay_per_use: revenue counter must include net settlement"
    );

    client.cancel_and_refund_prorated(&user, &merchant);
    assert_eq!(total(), before, "refund: token balances must be conserved");
}

#[test]
fn test_next_charge_at_none_for_paused_subscription() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    assert!(client.next_charge_at(&user).is_none());
}

#[test]
fn test_is_charge_due_transitions_after_interval() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

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

    // Before interval elapses: not due
    assert!(!client.is_charge_due(&user));

    env.ledger().with_mut(|l| {
        l.timestamp += interval;
    });
    assert!(client.is_charge_due(&user));
}

#[test]
fn test_is_charge_due_false_for_paused_subscription() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

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
    client.pause(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    assert!(!client.is_charge_due(&user));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-07: get_merchant_sub_count tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_merchant_sub_count_two_users_cancel_one() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user_a,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);

    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant), 2);

    client.cancel(&user_a);
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);
}

#[test]
fn test_merchant_sub_count_double_cancel_no_underflow() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);

    client.cancel(&user);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);

    // Second cancel must not underflow
    client.cancel(&user);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn test_set_subscription_interval_below_min_interval_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Setting interval to 100 seconds when MinInterval is default 3600 panics with #19 (IntervalTooShort)
    client.set_subscription_interval(&user, &100);
}

// ─────────────────────────────────────────────────────────────
// Issue #4: Bounded Pause with Auto-Resume Tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_pause_until_auto_resume_on_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    client.pause_until(&user, &90000);

    env.ledger().set_timestamp(86400);
    let res = client.try_charge(&user);
    assert!(res.is_err());

    env.ledger().set_timestamp(90000);
    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, false);
    assert_eq!(sub.active, true);
    assert_eq!(token.balance(&merchant), 1000);
}

#[test]
fn test_pause_until_invalid_expiry_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    env.ledger().set_timestamp(200000);
    let res = client.try_pause_until(&user, &200000);
    assert!(res.is_err());
    let res2 = client.try_pause_until(&user, &150000);
    assert!(res2.is_err());
}

#[test]
fn test_resume_clears_pause_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    client.pause_until(&user, &300000);
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, false);
    assert_eq!(sub.active, true);

    env.as_contract(&contract_id, || {
        let pause_expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert_eq!(pause_expiry, None);
    });
}

#[test]
fn test_pause_until_emits_distinct_event_with_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    let expiry = 90000u64;
    client.pause_until(&user, &expiry);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let topic_user: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "pause_until"));
    assert_eq!(topic_user, user);

    let event_data: crate::events::PauseUntilEventData = data.try_into_val(&env).unwrap();
    assert_eq!(event_data.expiry_timestamp, expiry);

    // Also assert pause() still emits "paused"
    client.resume(&user);
    client.pause(&user);
    assert_last_user_event(&env, "paused", &user);
}

// ─────────────────────────────────────────────────────────────
// Issue #1009: pause_until keeps PauseExpiry + Subscription alive
// and paused-subscription active-flag semantics
// ─────────────────────────────────────────────────────────────

/// `pause_until` must TTL-extend BOTH the `Subscription` entry and its
/// `PauseExpiry` entry (via `extend_subscription_ttl`), so they archive
/// together. Pre-#1009 it wrote `PauseExpiry` with no extension, so the key
/// could archive while the subscription survived — silently disabling
/// bounded-pause auto-resume.
#[test]
fn test_pause_until_extends_subscription_and_pause_expiry_ttl() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &90000);

    env.as_contract(&contract_id, || {
        let sub_ttl = env
            .storage()
            .persistent()
            .get_ttl(&storage::subscription_key(&env, &user));
        let expiry_ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::PauseExpiry(user.clone()));

        // extend_subscription_ttl extends both entries to the full
        // SUBSCRIPTION_TTL_LEDGERS window; accept the half-window floor.
        assert!(
            sub_ttl >= SUBSCRIPTION_TTL_LEDGERS / 2,
            "Subscription TTL must be extended by pause_until"
        );
        assert!(
            expiry_ttl >= SUBSCRIPTION_TTL_LEDGERS / 2,
            "PauseExpiry TTL must be extended by pause_until (issue #1009)"
        );
    });
}

/// Worst-case archival mock: a ledger advance that would archive a key on
/// the SDK default ~4096-ledger live-until (what pre-#1009 `pause_until`
/// gave `PauseExpiry`) must not take either entry offline, and auto-resume
/// must still fire afterwards.
#[test]
fn test_auto_resume_fires_after_worst_case_ttl_archival() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &90000);

    // Keep the contract instance alive across the ledger jump.
    env.as_contract(&contract_id, || {
        env.storage().instance().extend_ttl(2_000_000, 2_000_000);
    });

    // Advance past the SDK default archive point (4096 ledgers) but well
    // within the SUBSCRIPTION_TTL_LEDGERS window pause_until now extends
    // both entries to. Pre-#1009 this jump archived PauseExpiry while the
    // Subscription row survived — auto-resume then lost its trigger key.
    env.ledger().with_mut(|l| {
        l.sequence_number += 100_000; // >> 4096 default, << 6307200 window
    });

    // Both entries must still be live after the jump.
    env.as_contract(&contract_id, || {
        assert!(
            env.storage()
                .persistent()
                .has(&storage::subscription_key(&env, &user)),
            "Subscription must survive the archival window"
        );
        assert!(
            env.storage()
                .persistent()
                .has(&DataKey::PauseExpiry(user.clone())),
            "PauseExpiry must survive the archival window (issue #1009)"
        );
    });

    // Auto-resume still fires on the next batch charge after expiry.
    env.ledger().set_timestamp(90000);
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let result = client.batch_charge(&users);
    assert_eq!(result.get(0).unwrap(), crate::ChargeResult::Charged);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, false);
    assert_eq!(sub.active, true);
    assert_eq!(token.balance(&merchant), 1000);

    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert_eq!(expiry, None, "PauseExpiry must be cleared on auto-resume");
    });
}

/// Paused-subscription active-flag semantics (issue #1009): `pause_until`
/// sets `paused = true` and leaves `active = true`, so a bounded-paused
/// subscription stays counted as active, stays listed in the subscriber
/// index page, and reports `active: true, is_paused: true` in its health.
#[test]
fn test_pause_until_keeps_active_flag_true_across_readers() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    let user_b = setup_funded_user(&env, &contract_id, &token_addr);
    client.subscribe(&user_b, &merchant, &1000, &86400, &token_addr, &None, &None);

    // Sanity: both counted before the pause.
    assert_eq!(client.get_active_count(), 2);

    client.pause_until(&user, &90000);

    // The paused subscription row keeps active = true.
    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, true);
    assert_eq!(
        sub.active, true,
        "pause_until must not clear the active flag (issue #1009)"
    );

    // Reader agreement: counts, index pages and health all treat the
    // paused subscription as a live subscriber.
    assert_eq!(client.get_active_count(), 2);
    let page = client.get_active_subscriber_page(&0, &10);
    assert!(
        page.contains(&user),
        "paused subscription must stay listed in the subscriber index page"
    );
    let health = client.get_subscription_health(&user);
    assert_eq!(health.active, true);
    assert_eq!(health.is_paused, true);
}

// ─────────────────────────────────────────────
// CONTRACT-804: checked arithmetic in trial, fee, and volume paths
// ─────────────────────────────────────────────

#[test]
fn test_extend_trial_pushes_last_charged_forward() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    let before = client.get_subscription(&user).unwrap().last_charged;

    client.extend_trial(&user, &86400);

    assert_eq!(
        client.get_subscription(&user).unwrap().last_charged,
        before + 86400
    );
}

/// Extending a paused subscription's trial must fail closed with the typed
/// `SubscriptionPaused` (#17) error rather than advancing `last_charged` into
/// a chargeable state.
#[test]
fn test_extend_trial_on_paused_subscription_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    let before = client.get_subscription(&user).unwrap().last_charged;

    client.pause(&user);

    let res = client.try_extend_trial(&user, &86400);
    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(17))));
    assert_eq!(client.get_subscription(&user).unwrap().last_charged, before);
}

// ─────────────────────────────────────────────────────────────
// Issue 034 (#829): Self-transfer & contract-as-user hazards
// ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #32)")]
fn test_transfer_subscription_self_transfer_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.transfer_subscription(&user, &user);
}

#[test]
#[should_panic(expected = "Error(Contract, #32)")]
fn test_transfer_subscription_to_contract_address_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.transfer_subscription(&user, &contract_id);
}

// ─────────────────────────────────────────────────────────────
// Issue #1013 — Bound subscription intervals to prevent
// last_charged timestamp overflow
// ─────────────────────────────────────────────────────────────

/// subscribe() with interval == MAX_SUBSCRIPTION_INTERVAL (exactly on the
/// boundary) must succeed.
#[test]
fn test_interval_at_max_boundary_is_accepted() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Exactly at the cap — should not panic.
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &MAX_SUBSCRIPTION_INTERVAL,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.interval, MAX_SUBSCRIPTION_INTERVAL);
}

/// subscribe() with interval == MAX_SUBSCRIPTION_INTERVAL + 1 must be
/// rejected with ContractError::IntervalExceedsMaximum (code 46).
#[test]
fn test_interval_above_max_boundary_is_rejected() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let over_cap = MAX_SUBSCRIPTION_INTERVAL + 1;
    assert_eq!(
        client.try_subscribe(
            &user,
            &merchant,
            &1_0000000,
            &over_cap,
            &token_addr,
            &None,
            &None,
        ),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::IntervalExceedsMaximum as u32
        ))),
        "interval one above cap must return IntervalExceedsMaximum"
    );
}

/// subscribe() with interval == u64::MAX must be rejected with
/// ContractError::IntervalExceedsMaximum (code 46) — not a host panic.
#[test]
fn test_interval_u64_max_is_rejected() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(
        client.try_subscribe(
            &user,
            &merchant,
            &1_0000000,
            &u64::MAX,
            &token_addr,
            &None,
            &None,
        ),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::IntervalExceedsMaximum as u32
        ))),
        "u64::MAX interval must return IntervalExceedsMaximum"
    );
}

// ─────────────────────────────────────────────────────────────
// Issue #1223: legacy `paused && !active` rows remain excluded
// from get_active_subscriber_page (design invariant regression test)
// ─────────────────────────────────────────────────────────────

/// A legacy paused row stays in the raw index but is excluded from active readers.
#[test]
fn test_legacy_paused_subscription_remains_listed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86_400,
        &token_addr,
        &None,
        &None,
    );

    // Sanity: user is in the active page before we mutate the row.
    let page_before = client.get_active_subscriber_page(&0u64, &10u32);
    assert!(
        page_before.contains(&user),
        "user must be listed before mutation"
    );

    // Simulate a legacy `paused && !active` row by writing the subscription
    // directly into storage with active=false, paused=true. This reproduces the
    // state that pre-#1009 `pause_until` could write. We do NOT call cancel(),
    // so the cancellation counter path is bypassed and only the flags differ.
    env.as_contract(&contract_id, || {
        let key = storage::subscription_key(&env, &user);
        let mut sub: Subscription = env.storage().persistent().get(&key).unwrap();
        sub.active = false;
        sub.paused = true;
        env.storage().persistent().set(&key, &sub);
    });

    // Confirm the raw stored state.
    let raw = client.get_subscription(&user).unwrap();
    assert!(!raw.active, "raw active must be false (legacy state)");
    assert!(raw.paused, "raw paused must be true (legacy state)");

    // Design invariant: get_active_subscriber_page uses sub.active, so a
    // legacy `paused && !active` row must NOT appear in the active page.
    // This matches the documented behavior in storage.rs and locks the
    // same invariant as scenario_legacy_paused_inactive_row_reader_semantics.
    let page_after = client.get_active_subscriber_page(&0u64, &10u32);
    assert!(
        !page_after.contains(&user),
        "legacy paused&&!active row must remain EXCLUDED from get_active_subscriber_page \
         (sub.active is the intentional gate; see storage.rs design notes)"
    );

    // The raw append-only page still enumerates the slot (it does not filter
    // by active state).
    let raw_page = client.get_subscriber_page(&0u64, &10u32);
    assert!(
        raw_page.contains(&user),
        "legacy row must still appear in the raw get_subscriber_page"
    );
    assert!(!client
        .get_active_subscriber_page(&0u64, &10u32)
        .contains(&user));
    assert!(client.get_subscriber_page(&0u64, &10u32).contains(&user));
}

#[test]
fn test_cancelled_subscription_not_listed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86_400,
        &token_addr,
        &None,
        &None,
    );
    assert!(client
        .get_active_subscriber_page(&0u64, &10u32)
        .contains(&user));

    // Cancel through the normal path: active=false, paused=false.
    client.cancel(&user);

    let page = client.get_active_subscriber_page(&0u64, &10u32);
    assert!(
        !page.contains(&user),
        "cancelled subscription must not appear in get_active_subscriber_page"
    );
    client.cancel(&user);
    assert!(!client
        .get_active_subscriber_page(&0u64, &10u32)
        .contains(&user));
}

#[test]
fn test_cancelled_subscription_remains_excluded_inside_grace_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);
    let grace: u64 = 3_600;
    let interval: u64 = 3_600;
    client.propose_grace_period(&grace);
    client.commit_grace_period();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Advance past interval but still inside grace window.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace / 2;
    });

    let health = client.get_subscription_health(&user);
    assert!(health.charge_due, "charge must be due inside grace window");
    assert!(
        health.within_grace,
        "within_grace must be true inside grace window"
    );
    client.cancel(&user);
    assert!(!client
        .get_active_subscriber_page(&0u64, &10u32)
        .contains(&user));
}

#[test]
fn test_refund_last_charge_cannot_be_repeated() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let sac = StellarAssetClient::new(&env, &token_addr);

    sac.mint(&merchant, &10_000_0000000);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| {
        l.timestamp = 3600;
    });
    client.charge(&user);
    client.refund_last_charge(&user, &merchant);

    let res = client.try_refund_last_charge(&user, &merchant);
    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(50))));
}

#[test]
#[should_panic(expected = "Error(Contract, #50)")]
fn test_refund_last_charge_without_charge_fails_typed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    client.refund_last_charge(&user, &merchant);
}

#[test]
#[should_panic(expected = "Error(Contract, #38)")]
fn test_refund_last_charge_rejects_wrong_merchant() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let sac = StellarAssetClient::new(&env, &token_addr);
    let other = Address::generate(&env);

    sac.mint(&merchant, &10_000_0000000);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| {
        l.timestamp = 3600;
    });
    client.charge(&user);
    client.refund_last_charge(&user, &other);
}

// ─────────────────────────────────────────────────────────────
// Issue #1427: one-time skip next charge
// ─────────────────────────────────────────────────────────────

#[test]
fn test_skip_next_charge_moves_schedule_exactly_one_interval() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.next_charge_at(&user), Some(3600));

    client.skip_next_charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.last_charged, 3600);
    assert_eq!(client.next_charge_at(&user), Some(7200));
    assert!(sub.active);
    assert!(!sub.paused);
}

#[test]
fn test_skip_next_charge_enforces_one_per_interval() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    client.skip_next_charge(&user);

    let res = client.try_skip_next_charge(&user);
    assert_eq!(
        res,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::SkipCooldownActive as u32
        )))
    );

    // Once a full interval has elapsed since the previous skip, a new skip is
    // allowed and advances the schedule by exactly one more interval.
    env.ledger().with_mut(|l| {
        l.timestamp = 3600;
    });
    client.skip_next_charge(&user);
    assert_eq!(client.next_charge_at(&user), Some(10800));
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_skip_next_charge_rejects_paused_subscription() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);
    client.skip_next_charge(&user);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_skip_next_charge_rejects_cancelled_subscription() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);
    client.skip_next_charge(&user);
}

// ─────────────────────────────────────────────────────────────
// Issue #1428: bounded trial extensions
// ─────────────────────────────────────────────────────────────

#[test]
fn test_extend_trial_accepts_exact_max_extension() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    let before = client.get_subscription(&user).unwrap().last_charged;

    client.extend_trial(&user, &trial::MAX_TRIAL_EXTENSION);

    assert_eq!(
        client.get_subscription(&user).unwrap().last_charged,
        before + trial::MAX_TRIAL_EXTENSION
    );
}

#[test]
fn test_extend_trial_rejects_extension_over_max_with_typed_error() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    let res = client.try_extend_trial(&user, &(trial::MAX_TRIAL_EXTENSION + 1));
    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(48))));
}

#[test]
fn test_extend_trial_enforces_total_trial_cap() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    for _ in 0..(trial::MAX_TOTAL_TRIAL / trial::MAX_TRIAL_EXTENSION) {
        client.extend_trial(&user, &trial::MAX_TRIAL_EXTENSION);
    }

    let res = client.try_extend_trial(&user, &trial::MAX_TRIAL_EXTENSION);
    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(48))));
}
