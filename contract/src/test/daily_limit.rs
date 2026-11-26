#[test]
#[should_panic]
fn test_pay_per_use_to_daily_limit_shared_with_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let recipient = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &10_0000000);

    client.pay_per_use(&user, &6_0000000);
    // Combined spend (6 + 6 = 12) exceeds the 10 limit, even though this
    // second call routes through pay_per_use_to to a different recipient.
    client.pay_per_use_to(&user, &6_0000000, &recipient);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// spending_limit tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_daily_limit() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Initial limit should be None
    assert_eq!(client.get_daily_limit(&user), None);

    // After setting, it should return Some(limit)
    client.set_daily_limit(&user, &10_0000000);
    assert_eq!(client.get_daily_limit(&user), Some(10_0000000));
}

#[test]
fn test_get_daily_limit_status_absent_limit() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(
        client.get_daily_limit_status(&user),
        DailyLimitStatus {
            limit: None,
            spent: 0,
            day_start: None,
            remaining: None,
        }
    );
}

#[test]
fn test_get_daily_limit_status_snapshot_and_rollover() {
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
    client.set_daily_limit(&user, &10_0000000);
    client.pay_per_use(&user, &2_0000000);

    let status = client.get_daily_limit_status(&user);
    assert_eq!(status.limit, Some(10_0000000));
    assert_eq!(status.spent, 2_0000000);
    assert_eq!(status.remaining, Some(8_0000000));
    assert_eq!(status.day_start, client.get_day_start(&user));

    env.as_contract(&contract_id, || {
        env.storage()
            .temporary()
            .extend_ttl(&DataKey::DailyLimit(user.clone()), 35000, 35000);
    });
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += 17281;
    });

    assert_eq!(
        client.get_daily_limit_status(&user),
        DailyLimitStatus {
            limit: Some(10_0000000),
            spent: 0,
            day_start: None,
            remaining: Some(10_0000000),
        }
    );
}

#[test]
fn test_daily_limit_allows_spend_within_limit() {
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
    client.set_daily_limit(&user, &10_0000000);
    // Should not panic
    client.pay_per_use(&user, &5_0000000);
}

#[test]
#[should_panic]
fn test_daily_limit_blocks_overspend() {
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
    client.set_daily_limit(&user, &3_0000000);
    client.pay_per_use(&user, &5_0000000);
}

#[test]
fn test_daily_limit_accumulates_across_calls() {
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
    client.set_daily_limit(&user, &5_0000000);
    client.pay_per_use(&user, &2_0000000);
    client.pay_per_use(&user, &2_0000000);
    // 4 total, limit is 5 â€” should pass
}

#[test]
#[should_panic]
fn test_daily_limit_blocks_cumulative_overspend() {
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
    client.set_daily_limit(&user, &5_0000000);
    client.pay_per_use(&user, &3_0000000);
    client.pay_per_use(&user, &3_0000000); // 6 total > 5 limit
}

#[test]
fn test_daily_limit_visibility_and_spend_tracking() {
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

    assert_eq!(client.get_daily_limit(&user), None);
    assert_eq!(client.get_daily_spent(&user), 0);

    client.set_daily_limit(&user, &4_0000000);
    assert_eq!(client.get_daily_limit(&user), Some(4_0000000));

    client.pay_per_use(&user, &1_0000000);
    assert_eq!(client.get_daily_spent(&user), 1_0000000);
    assert_eq!(client.get_daily_limit(&user), Some(4_0000000));
}

#[test]
fn test_get_day_start_visibility() {
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

    // No window before any spend
    assert!(client.get_day_start(&user).is_none());
    assert_eq!(client.get_daily_spent(&user), 0);

    client.set_daily_limit(&user, &10_0000000);
    // Setting a limit alone does not open the day window
    assert!(client.get_day_start(&user).is_none());

    client.pay_per_use(&user, &2_0000000);
    assert!(client.get_day_start(&user).is_some());
    assert_eq!(client.get_daily_spent(&user), 2_0000000);

    client.remove_daily_limit(&user);
    assert!(client.get_day_start(&user).is_none());
    assert_eq!(client.get_daily_spent(&user), 0);
}

#[test]
fn test_daily_limit_set_event_emitted() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.set_daily_limit(&user, &4_0000000);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let topic_user: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
    let limit: i128 = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "daily_limit_set"));
    assert_eq!(topic_user, user);
    assert_eq!(limit, 4_0000000);
}

#[test]
fn test_daily_limit_removed_event_emitted() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.set_daily_limit(&user, &4_0000000);
    client.remove_daily_limit(&user);
    assert_last_user_event(&env, "daily_limit_removed", &user);

    assert_eq!(client.get_daily_limit(&user), None);
}

#[test]
fn test_remove_daily_limit_allows_pay_per_use_after_removal() {
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
    client.set_daily_limit(&user, &3_0000000);
    client.pay_per_use(&user, &2_0000000);
    client.remove_daily_limit(&user);
    client.pay_per_use(&user, &2_0000000); // should succeed after removal
}

/// Removing a daily limit clears `DayStart` and `DailySpent` together, so
/// re-setting the limit afterwards starts a fresh window: the spend counter
/// resets to zero and the day-start anchor is re-created on the next spend
/// (issue #1235 — fresh window is the documented safety-valve semantics).
#[test]
fn test_remove_then_set_daily_limit_starts_fresh_window() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Open a window and spend part of the cap.
    client.set_daily_limit(&user, &10_0000000);
    client.pay_per_use(&user, &6_0000000);

    let day_start_before = client.get_day_start(&user);
    assert!(day_start_before.is_some());
    assert_eq!(client.get_daily_spent(&user), 6_0000000);
    assert_eq!(
        client.get_daily_limit_status(&user),
        DailyLimitStatus {
            limit: Some(10_0000000),
            spent: 6_0000000,
            day_start: day_start_before,
            remaining: Some(4_0000000),
        }
    );

    // Removing the limit discards the whole window.
    client.remove_daily_limit(&user);
    assert_eq!(client.get_daily_limit(&user), None);
    assert_eq!(client.get_daily_spent(&user), 0);
    assert!(client.get_day_start(&user).is_none());
    assert_eq!(
        client.get_daily_limit_status(&user),
        DailyLimitStatus {
            limit: None,
            spent: 0,
            day_start: None,
            remaining: None,
        }
    );

    // Advance ledger time so a preserved anchor (if one existed) would differ
    // from a freshly created one.
    env.ledger().with_mut(|l| {
        l.timestamp += 3600;
    });

    // Re-setting the limit does not resurrect the old window.
    client.set_daily_limit(&user, &10_0000000);
    assert_eq!(client.get_daily_spent(&user), 0);
    assert!(client.get_day_start(&user).is_none());
    assert_eq!(
        client.get_daily_limit_status(&user),
        DailyLimitStatus {
            limit: Some(10_0000000),
            spent: 0,
            day_start: None,
            remaining: Some(10_0000000),
        }
    );

    // The next spend opens a fresh window with a new anchor and a zeroed
    // counter — the previous 6 XLM spend does not carry over.
    client.pay_per_use(&user, &2_0000000);
    let day_start_after = client.get_day_start(&user);
    assert!(day_start_after.is_some());
    assert_ne!(day_start_before, day_start_after);
    assert_eq!(client.get_daily_spent(&user), 2_0000000);
    assert_eq!(
        client.get_daily_limit_status(&user),
        DailyLimitStatus {
            limit: Some(10_0000000),
            spent: 2_0000000,
            day_start: day_start_after,
            remaining: Some(8_0000000),
        }
    );

    // The full fresh budget is available again: an 8 XLM spend that would
    // have breached the old window (6 + 8 > 10) is now accepted.
    client.pay_per_use(&user, &8_0000000);
    assert_eq!(client.get_daily_spent(&user), 10_0000000);
}

#[test]
fn test_global_volume_window_reset() {
    let (env, contract_id, token_addr, _user_setup, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_a = setup_large_balance(&env, &contract_id, &token_addr);
    let user_b = setup_large_balance(&env, &contract_id, &token_addr);

    let amount: i128 = 1_000_0000000; // well under MAX_AMOUNT
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
    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user_a); // 5 trillion used this window

    // Advance time past the 1-hour window boundary (3601 seconds)
    env.ledger().with_mut(|l| {
        l.timestamp += 3601;
    });

    env.ledger().with_mut(|l| {
        l.timestamp += interval;
    });

    // This charge should succeed because the window has reset
    client.charge(&user_b);
}

// ─────────────────────────────────────────────
// Issue #10: get_global_volume_window tests
// ─────────────────────────────────────────────

#[test]
fn test_get_global_volume_window_returns_zero_on_fresh_contract() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let (volume, window_start) = client.get_global_volume_window();
    assert_eq!(
        volume, 0,
        "accumulated volume should be 0 on fresh contract"
    );
    assert_eq!(
        window_start, 0,
        "window start should be 0 on fresh contract"
    );
}

#[test]
fn test_get_global_volume_window_correct_values_after_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 1_000_0000000;
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

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    let charge_time = env.ledger().timestamp();
    client.charge(&user);

    let (volume, window_start) = client.get_global_volume_window();
    assert_eq!(
        volume, amount,
        "accumulated volume should equal the charged amount"
    );
    assert_eq!(
        window_start, charge_time,
        "window_start should equal ledger timestamp at charge time"
    );
}

#[test]
fn test_get_global_volume_window_resets_after_hour() {
    let (env, contract_id, token_addr, _user_setup, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_a = setup_large_balance(&env, &contract_id, &token_addr);
    let user_b = setup_large_balance(&env, &contract_id, &token_addr);

    let amount: i128 = 1_000_0000000;
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
    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user_a);

    // Confirm volume accumulated in the first window
    let (volume_before, _) = client.get_global_volume_window();
    assert_eq!(volume_before, amount);

    // Advance past the 1-hour window boundary
    env.ledger().with_mut(|l| {
        l.timestamp += 3601;
    });
    env.ledger().with_mut(|l| {
        l.timestamp += interval;
    });
    let second_charge_time = env.ledger().timestamp();
    client.charge(&user_b);

    // Window should have reset: only the second charge amount is accumulated
    let (volume_after, window_start_after) = client.get_global_volume_window();
    assert_eq!(
        volume_after, amount,
        "volume should reset to just the new charge amount after window expiry"
    );
    assert_eq!(
        window_start_after, second_charge_time,
        "window_start should be the new charge time after reset"
    );
}

#[test]
fn test_daily_limit_day_start_boundary() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &100_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &50_0000000);

    // Spend 10
    client.pay_per_use(&user, &10_0000000);
    assert_eq!(client.get_daily_spent(&user), 10_0000000);

    // Spend 10 more
    client.pay_per_use(&user, &10_0000000);
    assert_eq!(client.get_daily_spent(&user), 20_0000000);

    // Manually extend DailyLimit (and other entries touched by the upcoming pay_per_use)
    // TTL so they survive the time skip below.
    env.as_contract(&contract_id, || {
        let key = DataKey::DailyLimit(user.clone());
        // 35,000 ledgers > LEDGERS_PER_DAY (17,280)
        env.storage().temporary().extend_ttl(&key, 35000, 35000);
        env.storage().persistent().extend_ttl(
            &DataKey::MerchantRevenue(merchant.clone()),
            35000,
            35000,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::MerchantRevenueHistory(merchant.clone()),
            35000,
            35000,
        );
    });

    // Advance sequence by LEDGERS_PER_DAY + 1 to expire DayStart (17,280 + 1 = 17,281)
    env.ledger().with_mut(|l| {
        l.sequence_number += 17281;
        l.timestamp += 17281 * 5;
    });

    // Renew the token allowance, which expired when the ledger sequence jumped past it
    let token = TokenClient::new(&env, &token_addr);
    token.approve(
        &user,
        &contract_id,
        &10_000_0000000,
        &(env.ledger().sequence() + 200),
    );

    // New spend on new day
    client.pay_per_use(&user, &15_0000000);

    // Should only be 15, not 35
    assert_eq!(client.get_daily_spent(&user), 15_0000000);
}

#[test]
fn test_daily_spent_reset() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    assert!(client.get_day_start(&user).is_none());
}

/// A window start near `u64::MAX` must not wrap the rollover comparison.
#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_global_volume_window_end_overflow_fails_with_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &DataKey::GlobalVolumeWindow,
            &GlobalVolumeWindow {
                current_window_start: u64::MAX,
                accumulated_volume: 0,
            },
        );
        check_and_update_global_volume(&env, 1);
    });
}

/// Breaching the hourly cap still reports `GlobalVolumeExceeded` (#28) —
/// the overflow work above must not have changed the cap's error mapping.
#[test]
#[should_panic(expected = "Error(Contract, #28)")]
fn test_global_volume_cap_breach_still_reports_28() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, GLOBAL_MAX_VOLUME_PER_HOUR + 1);
    });
}

/// Lowering the cap via set_global_volume_cap rejects over-cap volume.
#[test]
fn test_global_volume_cap_override_lower_enforced() {
    let (env, contract_id, token_addr, _user_setup, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Set a lower cap: 10 trillion stroops
    let lower_cap: i128 = 10_000_000_000_000;
    client.set_global_volume_cap(&lower_cap);
    assert_eq!(client.get_global_volume_cap(), lower_cap);

    // Subscribe a user with amount exceeding the lowered cap
    let user = setup_large_balance(&env, &contract_id, &token_addr);
    let amount: i128 = 15_000_000_000_000; // 15 trillion > 10 trillion cap
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

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // Charge should fail with GlobalVolumeExceeded because amount > cap
    let result = client.try_charge(&user);
    assert!(result.is_err());
}

/// Raising the cap via set_global_volume_cap allows previously rejected amounts.
#[test]
fn test_global_volume_cap_override_raise_allows_more() {
    let (env, contract_id, token_addr, _user_setup, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Start with default cap (50 trillion), set a higher cap: 100 trillion
    let higher_cap: i128 = 100_000_000_000_000;
    client.set_global_volume_cap(&higher_cap);
    assert_eq!(client.get_global_volume_cap(), higher_cap);

    // Subscribe a user with amount that would exceed default but not raised cap
    let user = setup_large_balance(&env, &contract_id, &token_addr);
    let amount: i128 = 75_000_000_000_000; // 75 trillion > 50T default, < 100T raised
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

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // Charge should succeed because raised cap allows it
    client.charge(&user);
}

// ─────────────────────────────────────────────────────────────────────
// Issue #1240: Global volume cap boundary cases, rollover & unset state
// ─────────────────────────────────────────────────────────────────────

#[test]
fn test_global_volume_cap_exact_boundary_succeeds_default() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No override configured: effective cap is compile-time default
    assert_eq!(client.get_global_volume_cap(), GLOBAL_MAX_VOLUME_PER_HOUR);

    // Exactly reaching the default cap must succeed
    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, GLOBAL_MAX_VOLUME_PER_HOUR);
    });

    let (accumulated, _) = client.get_global_volume_window();
    assert_eq!(accumulated, GLOBAL_MAX_VOLUME_PER_HOUR);
}

#[test]
#[should_panic(expected = "Error(Contract, #28)")]
fn test_global_volume_cap_exceeded_by_one_stroop_fails_default() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    // Reaching exactly cap first, then exceeding by 1 stroop must panic with GlobalVolumeExceeded (#28)
    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, GLOBAL_MAX_VOLUME_PER_HOUR);
        check_and_update_global_volume(&env, 1);
    });
}

#[test]
fn test_global_volume_cap_exact_boundary_succeeds_with_override() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let custom_cap: i128 = 200_0000000;
    client.set_global_volume_cap(&custom_cap);
    assert_eq!(client.get_global_volume_cap(), custom_cap);

    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, custom_cap);
    });

    let (accumulated, _) = client.get_global_volume_window();
    assert_eq!(accumulated, custom_cap);
}

#[test]
#[should_panic(expected = "Error(Contract, #28)")]
fn test_global_volume_cap_exceeded_by_one_stroop_fails_with_override() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let custom_cap: i128 = 200_0000000;
    client.set_global_volume_cap(&custom_cap);

    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, custom_cap);
        check_and_update_global_volume(&env, 1);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #28)")]
fn test_global_volume_window_no_rollover_one_second_before_hour() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let cap: i128 = 100_0000000;
    client.set_global_volume_cap(&cap);

    let start_time = env.ledger().timestamp();

    // Fill current window completely to the cap
    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, cap);
    });

    // Exactly 1 second before rollover (start_time + HOUR_IN_SECONDS - 1)
    env.ledger().with_mut(|l| {
        l.timestamp = start_time + HOUR_IN_SECONDS - 1;
    });

    // Window must NOT have rolled over; adding 1 stroop must panic with GlobalVolumeExceeded (#28)
    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, 1);
    });
}

#[test]
fn test_global_volume_window_rollover_at_exact_hour_boundary() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let cap: i128 = 100_0000000;
    client.set_global_volume_cap(&cap);

    let start_time = env.ledger().timestamp();

    // Fill current window completely to the cap
    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, cap);
    });
    let (vol, win_start) = client.get_global_volume_window();
    assert_eq!(vol, cap);
    assert_eq!(win_start, start_time);

    // Advance to exactly the hour boundary (start_time + HOUR_IN_SECONDS)
    env.ledger().with_mut(|l| {
        l.timestamp = start_time + HOUR_IN_SECONDS;
    });

    // Window rolls over: volume resets to 0 and accommodates up to cap
    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, cap);
    });

    let (vol_after, win_start_after) = client.get_global_volume_window();
    assert_eq!(vol_after, cap);
    assert_eq!(win_start_after, start_time + HOUR_IN_SECONDS);
}

// ── #1030: global_volume_cap_set ──────────────────────────────

#[test]
fn test_global_volume_cap_set_event_emitted() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let new_cap: i128 = 1_000_000_000;
    client.set_global_volume_cap(&new_cap);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (_old, new): (i128, i128) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "global_volume_cap_set"));
    assert_eq!(new, new_cap);
}

#[test]
fn test_global_volume_cap_set_event_old_value_is_default_before_first_override() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // First call — old should be the compile-time default (50 trillion).
    let new_cap: i128 = 20_000_000_000_000;
    client.set_global_volume_cap(&new_cap);

    let events = contract_events(&env);
    let (_, _, data) = events.get(events.len() - 1).unwrap();
    let (old, new): (i128, i128) = data.try_into_val(&env).unwrap();

    assert_eq!(old, 50_000_000_000_000i128); // GLOBAL_MAX_VOLUME_PER_HOUR
    assert_eq!(new, new_cap);
}

#[test]
fn test_global_volume_cap_set_event_old_value_tracks_previous_override() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let first_cap: i128 = 10_000_000_000;
    let second_cap: i128 = 5_000_000_000;

    client.set_global_volume_cap(&first_cap);
    client.set_global_volume_cap(&second_cap);

    let events = contract_events(&env);
    let (_, _, data) = events.get(events.len() - 1).unwrap();
    let (old, new): (i128, i128) = data.try_into_val(&env).unwrap();

    assert_eq!(old, first_cap);
    assert_eq!(new, second_cap);
}

// ─────────────────────────────────────────────────────────────
// Issue #1213: set_daily_limit validation and overflow-safe accumulation
// ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_set_daily_limit_zero_rejected() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.set_daily_limit(&user, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_set_daily_limit_negative_rejected() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.set_daily_limit(&user, &-1);
}

#[test]
fn test_daily_limit_exact_limit_spend_allowed() {
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
    client.set_daily_limit(&user, &5_0000000);
    client.pay_per_use(&user, &2_0000000);
    client.pay_per_use(&user, &3_0000000);
    let status = client.get_daily_limit_status(&user);
    assert_eq!(status.spent, 5_0000000);
    assert_eq!(status.remaining, Some(0));
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_daily_limit_over_limit_spend_rejected() {
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
    client.set_daily_limit(&user, &5_0000000);
    client.pay_per_use(&user, &5_0000000);
    client.pay_per_use(&user, &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_daily_limit_enforce_overflow_is_typed() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    env.as_contract(&contract_id, || {
        spending_limit::set_daily_limit(&env, &user, i128::MAX);
        spending_limit::record_spend(&env, &user, i128::MAX);
        spending_limit::enforce_limit(&env, &user, 1);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_daily_limit_record_spend_overflow_is_typed() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    env.as_contract(&contract_id, || {
        spending_limit::record_spend(&env, &user, i128::MAX);
        spending_limit::record_spend(&env, &user, 1);
    });
}
