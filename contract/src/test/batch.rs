#[test]
fn test_batch_charge_empty() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let results = client.batch_charge(&soroban_sdk::vec![&env]);
    assert_eq!(results.len(), 0);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// batch_charge tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_batch_charge_charged_and_skipped() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    let interval: u64 = 86400;
    client.subscribe(
        &user_a,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Only advance past interval for user_a
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // user_b re-subscribes at the new timestamp so their interval hasn't elapsed
    client.subscribe(
        &user_b,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::Skipped);
}

#[test]
fn test_batch_charge_ordering() {
    let (env, contract_id, token_addr, user_1, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_2 = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_2, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_2, &contract_id, &10_000_0000000, &200);

    let user_3 = Address::generate(&env);
    // user_3 has no subscription

    let user_4 = Address::generate(&env);
    sac.mint(&user_4, &10_000_0000000);
    token.approve(&user_4, &contract_id, &10_000_0000000, &200);

    let interval = 86400;

    // user_1: valid, will be charged
    client.subscribe(
        &user_1,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // user_2: valid, will be charged
    client.subscribe(
        &user_2,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // user_4: valid but skipped (we will subscribe right before charge so interval not elapsed)

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.subscribe(
        &user_4,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let mut users = soroban_sdk::Vec::new(&env);
    // Order: user_2 (Charged), user_3 (Failed), user_4 (Skipped), user_1 (Charged)
    users.push_back(user_2.clone());
    users.push_back(user_3.clone());
    users.push_back(user_4.clone());
    users.push_back(user_1.clone());

    let results = client.batch_charge(&users);

    assert_eq!(results.len(), 4);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::NoSubscription);
    assert_eq!(results.get(2).unwrap(), crate::ChargeResult::Skipped);
    assert_eq!(results.get(3).unwrap(), crate::ChargeResult::Charged);
}

#[test]
fn test_batch_charge_no_subscription() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let unknown = Address::generate(&env);
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(unknown);

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::NoSubscription);
}

#[test]
#[cfg(feature = "bench")]
fn test_batch_charge_stress() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    env.cost_estimate().budget().reset_unlimited();

    let num_users = 50;
    let mut users = soroban_sdk::Vec::new(&env);
    let interval = 86400;

    for _ in 0..num_users {
        let u = Address::generate(&env);
        sac.mint(&u, &10_000_0000000);
        token.approve(&u, &contract_id, &10_000_0000000, &200);
        client.subscribe(
            &u,
            &merchant,
            &1_0000000,
            &interval,
            &token_addr,
            &None,
            &None,
        );
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let results = client.batch_charge(&users);

    assert_eq!(results.len(), num_users);
    for r in results.into_iter() {
        assert_eq!(r, crate::ChargeResult::Charged);
    }
}

#[test]
#[cfg(feature = "bench")]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_charge_over_default_limit_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        let u = Address::generate(&env);
        users.push_back(u);
        users.push_back(Address::generate(&env));
    }

    let res = client.try_batch_charge(&users);
    assert!(res.is_err());
}

#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_set_max_batch_size_rejects_value_above_200() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.set_max_batch_size(&201);
}

// ─────────────────────────────────────────────────────────────
// Issue #1026: max_batch_size_set event
// ─────────────────────────────────────────────────────────────

/// set_max_batch_size emits a max_batch_size_set event carrying both the
/// previous and the new cap.
#[test]
fn test_set_max_batch_size_emits_event_with_old_and_new() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Default cap before any override is MAX_BATCH_SIZE (50).
    client.set_max_batch_size(&30);

    let all_events = contract_events(&env);
    let (_, topics, data) = all_events.get(all_events.len() - 1).unwrap();

    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "max_batch_size_set"));

    let payload: events::MaxBatchSizeSetEventData = data.try_into_val(&env).unwrap();
    assert_eq!(payload.old, 50u32); // default MAX_BATCH_SIZE
    assert_eq!(payload.new, 30u32);
}

/// Updating the batch size a second time uses the previously stored value as
/// the old value, not the compile-time default.
#[test]
fn test_set_max_batch_size_event_old_value_reflects_previous_set() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.set_max_batch_size(&20);
    client.set_max_batch_size(&40);

    let all_events = contract_events(&env);
    let (_, _, data) = all_events.get(all_events.len() - 1).unwrap();
    let payload: events::MaxBatchSizeSetEventData = data.try_into_val(&env).unwrap();
    assert_eq!(payload.old, 20u32);
    assert_eq!(payload.new, 40u32);
}

#[test]
fn test_batch_charge_inactive() {
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

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Inactive);
}

/// batch_charge must return ChargeResult::Paused for a subscription that has been paused.
#[test]
fn test_batch_charge_paused() {
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

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Paused);
}

#[test]
fn test_batch_charge_grace_period_elapsed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });
    let grace_period: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

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

    // Advance ledger beyond interval + grace period
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::GracePeriodElapsed
    );
}

// -----------------------------------------------------------------
// Issue #794: batch_charge AllowanceInsufficient tolerance tests
// -----------------------------------------------------------------

/// A subscriber with zero allowance receives AllowanceInsufficient; no funds move.
#[test]
fn test_batch_charge_zero_allowance_returns_allowance_insufficient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

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

    // Revoke the allowance entirely.
    token.approve(&user, &contract_id, &0, &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient,
        "zero allowance must produce AllowanceInsufficient"
    );
    assert_eq!(
        token.balance(&user),
        user_balance_before,
        "user balance unchanged"
    );
    assert_eq!(
        token.balance(&merchant),
        merchant_balance_before,
        "merchant balance unchanged"
    );
}

/// A subscriber whose allowance is exactly the subscription amount is charged.
#[test]
fn test_batch_charge_exact_allowance_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 5_0000000;
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

    // Set allowance to exactly the gross amount.
    token.approve(&user, &contract_id, &amount, &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::Charged,
        "exact allowance must allow the charge"
    );
    assert_eq!(
        token.balance(&user),
        10_000_0000000 - amount,
        "user debited gross amount"
    );
}

/// A subscriber with allowance one stroop below sub.amount is rejected.
#[test]
fn test_batch_charge_one_below_allowance_returns_allowance_insufficient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 5_0000000;
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

    // Set allowance to one stroop below gross.
    token.approve(&user, &contract_id, &(amount - 1), &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient
    );
    assert_eq!(token.balance(&user), user_balance_before);
    assert_eq!(token.balance(&merchant), merchant_balance_before);
}

/// Mixed batch: Alice (sufficient) -> Bob (insufficient) -> Charlie (sufficient).
/// Bob's failure must not abort Alice's or Charlie's charges.
#[test]
fn test_batch_charge_mixed_allowance_does_not_abort_healthy_users() {
    let (env, contract_id, token_addr, alice, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    let bob = Address::generate(&env);
    let charlie = Address::generate(&env);
    sac.mint(&bob, &10_000_0000000);
    sac.mint(&charlie, &10_000_0000000);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    for u in [&alice, &bob, &charlie] {
        token.approve(u, &contract_id, &10_000_0000000, &200);
        client.subscribe(u, &merchant, &amount, &interval, &token_addr, &None, &None);
    }

    // Bob revokes to an insufficient amount.
    token.approve(&bob, &contract_id, &(amount / 2), &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let alice_before = token.balance(&alice);
    let bob_before = token.balance(&bob);
    let charlie_before = token.balance(&charlie);
    let merchant_before = token.balance(&merchant);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(alice.clone());
    users.push_back(bob.clone());
    users.push_back(charlie.clone());

    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::Charged,
        "Alice charged"
    );
    assert_eq!(
        results.get(1).unwrap(),
        crate::ChargeResult::AllowanceInsufficient,
        "Bob insufficient"
    );
    assert_eq!(
        results.get(2).unwrap(),
        crate::ChargeResult::Charged,
        "Charlie charged"
    );

    assert_eq!(
        alice_before - token.balance(&alice),
        amount,
        "Alice debited"
    );
    assert_eq!(token.balance(&bob), bob_before, "Bob untouched");
    assert_eq!(
        charlie_before - token.balance(&charlie),
        amount,
        "Charlie debited"
    );
    assert_eq!(
        token.balance(&merchant) - merchant_before,
        amount * 2,
        "merchant received exactly 2 charges"
    );
}

/// Multiple under-allowanced users in one batch all return AllowanceInsufficient.
#[test]
fn test_batch_charge_multiple_insufficient_allowances() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    let user_b = Address::generate(&env);
    sac.mint(&user_b, &10_000_0000000);

    let amount: i128 = 2_0000000;
    let interval: u64 = 86400;

    for u in [&user_a, &user_b] {
        token.approve(u, &contract_id, &10_000_0000000, &200);
        client.subscribe(u, &merchant, &amount, &interval, &token_addr, &None, &None);
        token.approve(u, &contract_id, &(amount - 1), &200);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let a_before = token.balance(&user_a);
    let b_before = token.balance(&user_b);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient
    );
    assert_eq!(
        results.get(1).unwrap(),
        crate::ChargeResult::AllowanceInsufficient
    );
    assert_eq!(token.balance(&user_a), a_before);
    assert_eq!(token.balance(&user_b), b_before);
}

/// Healthy user before AND after an under-allowanced user both get charged.
#[test]
fn test_batch_charge_healthy_before_and_after_insufficient() {
    let (env, contract_id, token_addr, healthy_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    let insufficient = Address::generate(&env);
    let healthy_b = Address::generate(&env);
    sac.mint(&insufficient, &10_000_0000000);
    sac.mint(&healthy_b, &10_000_0000000);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    for u in [&healthy_a, &insufficient, &healthy_b] {
        token.approve(u, &contract_id, &10_000_0000000, &200);
        client.subscribe(u, &merchant, &amount, &interval, &token_addr, &None, &None);
    }

    token.approve(&insufficient, &contract_id, &0, &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let ha_before = token.balance(&healthy_a);
    let hb_before = token.balance(&healthy_b);
    let ins_before = token.balance(&insufficient);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(healthy_a.clone());
    users.push_back(insufficient.clone());
    users.push_back(healthy_b.clone());
    let results = client.batch_charge(&users);

    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(
        results.get(1).unwrap(),
        crate::ChargeResult::AllowanceInsufficient
    );
    assert_eq!(results.get(2).unwrap(), crate::ChargeResult::Charged);

    assert_eq!(ha_before - token.balance(&healthy_a), amount);
    assert_eq!(token.balance(&insufficient), ins_before);
    assert_eq!(hb_before - token.balance(&healthy_b), amount);
}

/// Auto-resume + insufficient allowance: subscription resumes but charge fails cleanly.
#[test]
fn test_batch_charge_auto_resume_with_insufficient_allowance() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

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
    client.pause_until(&user, &90_000);

    // Revoke allowance while paused.
    token.approve(&user, &contract_id, &0, &200);

    // Advance past both the pause expiry and the charge interval.
    env.ledger().set_timestamp(90_001);

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient,
        "auto-resume + zero allowance must not panic"
    );
    assert_eq!(token.balance(&user), user_balance_before);
    assert_eq!(token.balance(&merchant), merchant_balance_before);
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert!(!sub.paused);
}

/// get_batch_charge_estimate returns AllowanceInsufficient for an under-allowanced
/// due subscriber, mirroring the live batch behavior.
#[test]
fn test_batch_charge_estimate_reflects_allowance_insufficient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

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
    token.approve(&user, &contract_id, &(amount - 1), &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let users = soroban_sdk::vec![&env, user.clone()];
    let estimate = client.get_batch_charge_estimate(&users);
    assert_eq!(
        estimate.get(0).unwrap(),
        crate::batch::ChargeResult::AllowanceInsufficient
    );
}

/// Allowance check is against gross sub.amount, NOT the post-fee net amount.
/// Allowance == net (< gross) must still return AllowanceInsufficient.
#[test]
fn test_batch_charge_allowance_checked_against_gross_not_net() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let admin = Address::generate(&env);
    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        crate::storage::set_admin(&env, &admin);
    });
    // 10% fee: net = 90% of gross.
    client.propose_fee(&collector, &1000);
    client.commit_fee();

    let gross: i128 = 1_0000000;
    let net: i128 = gross - gross * 1000 / 10_000; // 9_000_000
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &gross,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Set allowance to exactly the net amount -- below gross.
    token.approve(&user, &contract_id, &net, &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_balance_before = token.balance(&user);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient,
        "allowance == net but < gross must still fail"
    );
    assert_eq!(token.balance(&user), user_balance_before, "no funds moved");
}

#[test]
fn test_batch_pause_subscriptions_handles_valid_missing_and_pre_paused_accounts() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = setup_funded_user(&env, &contract_id, &token_addr);
    let missing_user = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user_a);
    });

    client.subscribe(
        &user_a,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user_b);

    let mut users = Vec::new(&env);
    users.push_back(missing_user.clone());
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    client.batch_pause_subscriptions(&users);
    assert_eq!(count_user_events(&env, "subscription_paused", &user_a), 1);
    assert_eq!(count_user_events(&env, "subscription_paused", &user_b), 0);

    assert!(client.get_subscription(&user_a).unwrap().paused);
    assert!(client.get_subscription(&user_b).unwrap().paused);
    assert!(client.get_subscription(&missing_user).is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_pause_subscriptions_rejects_more_than_twenty_five_accounts() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let mut users = Vec::new(&env);
    for _ in 0..26 {
        users.push_back(Address::generate(&env));
    }

    client.batch_pause_subscriptions(&users);
}

#[test]
fn test_batch_pause_subscriptions_fresh_pause_writes_indefinite_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    let mut users = Vec::new(&env);
    users.push_back(user.clone());
    client.batch_pause_subscriptions(&users);

    assert!(client.get_subscription(&user).unwrap().paused);
    env.as_contract(&contract_id, || {
        let expiry = storage::get_pause_expiry(&env, &user);
        assert_eq!(expiry, Some(u64::MAX));
    });
}

#[test]
fn test_batch_pause_overrides_stale_bounded_expiry_and_blocks_auto_resume() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    env.as_contract(&contract_id, || {
        storage::set_pause_expiry(&env, &user, 90_000);
    });
    assert!(!client.get_subscription(&user).unwrap().paused);

    let mut users = Vec::new(&env);
    users.push_back(user.clone());
    client.batch_pause_subscriptions(&users);

    env.as_contract(&contract_id, || {
        assert_eq!(storage::get_pause_expiry(&env, &user), Some(u64::MAX));
    });

    env.ledger().set_timestamp(90_000);
    let res = client.try_charge(&user);
    assert!(res.is_err());

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.paused);
    assert_eq!(
        count_user_events(&env, "subscription_auto_resumed", &user),
        0
    );
}

#[test]
fn test_batch_pause_already_paused_keeps_existing_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &300_000);

    let mut users = Vec::new(&env);
    users.push_back(user.clone());
    client.batch_pause_subscriptions(&users);

    assert!(client.get_subscription(&user).unwrap().paused);
    env.as_contract(&contract_id, || {
        assert_eq!(storage::get_pause_expiry(&env, &user), Some(300_000));
        assert!(env
            .storage()
            .persistent()
            .has(&DataKey::PauseExpiry(user.clone())));
    });
    assert_eq!(count_user_events(&env, "subscription_paused", &user), 0);
}

#[test]
fn test_batch_extend_extends_pause_expiry_when_present() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &200000);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.batch_extend_subscription_ttl(&users);

    // PauseExpiry should survive batch extend
    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert!(expiry.is_some(), "PauseExpiry should survive batch_extend");
        assert_eq!(expiry.unwrap(), 200000);
    });
}

#[test]
fn test_pause_then_batch_extend_then_auto_resume() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &90000);

    // Batch extend keeps PauseExpiry alive
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.batch_extend_subscription_ttl(&users);

    // Advance to expiry — auto-resume should still work
    env.ledger().set_timestamp(90000);
    let mut users2 = soroban_sdk::Vec::new(&env);
    users2.push_back(user.clone());
    let result = client.batch_charge(&users2);
    assert_eq!(result.get(0).unwrap(), crate::ChargeResult::Charged);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, false);
    assert_eq!(sub.active, true);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ─────────────────────────────────────────────
// CONTRACT-53: batch_pause_subscriptions tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Admin can pause multiple valid subscriptions in a single batch call.
/// The test verifies paused flag is set, events are emitted, and already-paused
/// or missing addresses are handled without disruption.
#[test]
fn test_batch_pause_subscriptions_mixed_inputs() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Set up user_b with a subscription
    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    // Set up user_c with a subscription (will be paused first)
    let user_c = Address::generate(&env);
    sac.mint(&user_c, &10_000_0000000);
    token.approve(&user_c, &contract_id, &10_000_0000000, &200);

    // Set up user_d with a subscription (valid, will be paused in batch)
    let user_d = Address::generate(&env);
    sac.mint(&user_d, &10_000_0000000);
    token.approve(&user_d, &contract_id, &10_000_0000000, &200);

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
    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_c,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_d,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Pre-pause user_c
    client.pause(&user_c);
    let sub_c_before = client.get_subscription(&user_c).unwrap();
    assert!(sub_c_before.paused);

    // Verify all others start unpaused
    assert!(!client.get_subscription(&user_a).unwrap().paused);
    assert!(!client.get_subscription(&user_b).unwrap().paused);
    assert!(!client.get_subscription(&user_d).unwrap().paused);

    // Build batch with mixed inputs: valid, missing, already-paused, valid
    let no_sub_user = Address::generate(&env);
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone()); // valid â†’ should be paused
    users.push_back(no_sub_user.clone()); // no subscription â†’ skipped
    users.push_back(user_c.clone()); // already paused â†’ no-op
    users.push_back(user_b.clone()); // valid â†’ should be paused
    users.push_back(user_d.clone()); // valid â†’ should be paused

    client.batch_pause_subscriptions(&users);
    let events_after = contract_events(&env);

    // All valid subscriptions must be paused
    let sub_a = client.get_subscription(&user_a).unwrap();
    assert!(sub_a.paused, "user_a should be paused");

    let sub_b = client.get_subscription(&user_b).unwrap();
    assert!(sub_b.paused, "user_b should be paused");

    let sub_d = client.get_subscription(&user_d).unwrap();
    assert!(sub_d.paused, "user_d should be paused");

    // Already-paused user_c remains paused
    let sub_c = client.get_subscription(&user_c).unwrap();
    assert!(sub_c.paused, "user_c should remain paused");

    // No subscription was created for no_sub_user
    assert!(
        client.get_subscription(&no_sub_user).is_none(),
        "no_sub_user should have no subscription"
    );

    // Verify events: three subscription_paused events (user_a, user_b, user_d)
    let paused_event_count = (0..events_after.len())
        .filter(|&i| {
            let (_, topics, _) = events_after.get(i).unwrap();
            let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
            topic_symbol == Symbol::new(&env, "subscription_paused")
        })
        .count();
    assert_eq!(
        paused_event_count, 3,
        "should emit 3 subscription_paused events"
    );
}

/// Batch size exceeding 25 must panic with BatchTooLarge.
#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_pause_subscriptions_exceeds_max_size_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Build a vector with 26 entries
    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..26 {
        users.push_back(Address::generate(&env));
    }
    client.batch_pause_subscriptions(&users);
}

#[test]
fn test_batch_cancel_matches_single_cancel_side_effects() {
    let (env, contract_id, token_addr, user_single, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_batch = setup_funded_user(&env, &contract_id, &token_addr);
    let referrer = Address::generate(&env);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user_single,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    client.subscribe(
        &user_batch,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer),
    );

    client.cancel(&user_single);
    assert_eq!(count_user_events(&env, "cancelled", &user_single), 1);
    let mut users = Vec::new(&env);
    users.push_back(user_batch.clone());
    let results = client.batch_cancel(&users);
    assert_eq!(count_user_events(&env, "cancelled", &user_batch), 1);

    assert_eq!(results.get(0).unwrap(), CancelResult::Cancelled);
    assert_eq!(
        client.get_subscription(&user_single),
        client.get_subscription(&user_batch)
    );
    assert_eq!(client.get_referrer(&user_single), None);
    assert_eq!(client.get_referrer(&user_batch), None);
    assert_eq!(client.get_active_count(), 0);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);
    assert_eq!(client.get_subscriber_count(), 2);
    assert!(client.get_subscriber_at(&0).is_none());
    assert!(client.get_subscriber_at(&1).is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_cancel_exceeds_max_size_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..26 {
        users.push_back(Address::generate(&env));
    }
    client.batch_cancel(&users);
}

#[test]
fn test_batch_cancel_at_max_size_succeeds() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..25 {
        users.push_back(Address::generate(&env));
    }

    let results = client.batch_cancel(&users);
    assert_eq!(results.len(), 25);
    for result in results.iter() {
        assert_eq!(result, CancelResult::NoSubscription);
    }
}

// ─────────────────────────────────────────────
// New Feature Unit Tests (Issues #628, #638, #640, #641)
// ─────────────────────────────────────────────

#[test]
fn test_batch_extend_subscription_ttl_extends_valid_and_skips_unknown() {
    let (env, contract_id, token_addr, user1, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user2 = Address::generate(&env);
    let user3_unknown = Address::generate(&env);

    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user2, &contract_id, &1_000_000_000, &100);

    client.subscribe(
        &user1,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user2,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user1.clone());
    users.push_back(user2.clone());
    users.push_back(user3_unknown.clone());

    let extended = client.batch_extend_subscription_ttl(&users);
    assert_eq!(extended.len(), 2);
    assert_eq!(extended.get(0).unwrap(), user1);
    assert_eq!(extended.get(1).unwrap(), user2);
}

#[test]
#[should_panic]
fn test_batch_extend_subscription_ttl_over_limit_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        users.push_back(Address::generate(&env));
    }

    client.batch_extend_subscription_ttl(&users);
}

#[test]
fn test_batch_charge_estimate() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let users = soroban_sdk::vec![&env, user.clone()];
    let estimate = client.get_batch_charge_estimate(&users);

    assert_eq!(estimate.len(), 1);
    assert_eq!(
        estimate.get(0).unwrap(),
        crate::batch::ChargeResult::NoSubscription
    );
}

#[test]
fn test_get_next_charge_batch_empty_and_bounds() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let batch = client.get_next_charge_batch(&0, &10, &None);
    assert_eq!(batch.len(), 0);

    let batch_oob = client.get_next_charge_batch(&5, &10, &None);
    assert_eq!(batch_oob.len(), 0);
}

#[test]
fn test_get_next_charge_batch_filtering() {
    let (env, contract_id, token_addr, user_due, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_not_due = setup_funded_user(&env, &contract_id, &token_addr);
    let user_paused = setup_funded_user(&env, &contract_id, &token_addr);
    let user_cancelled = setup_funded_user(&env, &contract_id, &token_addr);

    let interval: u64 = 86400;

    client.subscribe(
        &user_due,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_paused,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_cancelled,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    client.pause(&user_paused);
    client.cancel(&user_cancelled);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.subscribe(
        &user_not_due,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let batch = client.get_next_charge_batch(&0, &10, &None);
    assert_eq!(batch.len(), 1);
    assert_eq!(batch.get(0).unwrap(), user_due);
}

#[test]
fn test_get_next_charge_batch_pagination() {
    let (env, contract_id, token_addr, user1, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user2 = setup_funded_user(&env, &contract_id, &token_addr);
    let user3 = setup_funded_user(&env, &contract_id, &token_addr);

    let interval: u64 = 86400;

    client.subscribe(
        &user1,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user2,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user3,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let batch1 = client.get_next_charge_batch(&0, &2, &None);
    assert_eq!(batch1.len(), 2);
    assert_eq!(batch1.get(0).unwrap(), user1);
    assert_eq!(batch1.get(1).unwrap(), user2);

    let batch2 = client.get_next_charge_batch(&2, &2, &None);
    assert_eq!(batch2.len(), 1);
    assert_eq!(batch2.get(0).unwrap(), user3);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_get_next_charge_batch_exceeds_limit_panics() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.get_next_charge_batch(&0, &51, &None);
}

#[test]
fn test_get_next_charge_batch_exclude_lapsed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });
    let grace_period: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

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

    // Advance ledger beyond interval, but WITHIN grace period
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period - 100;
    });

    // It should be returned because it's due and not lapsed
    let batch = client.get_next_charge_batch(&0, &10, &Some(true));
    assert_eq!(batch.len(), 1);
    assert_eq!(batch.get(0).unwrap(), user);

    // Advance ledger beyond interval + grace period
    env.ledger().with_mut(|l| {
        l.timestamp += 200; // past the grace period
    });

    // When exclude_lapsed is Some(true) or None, it should NOT be returned
    let batch_exclude = client.get_next_charge_batch(&0, &10, &Some(true));
    assert_eq!(batch_exclude.len(), 0);

    let batch_default = client.get_next_charge_batch(&0, &10, &None);
    assert_eq!(batch_default.len(), 0);

    // When exclude_lapsed is Some(false), it should be returned
    let batch_include = client.get_next_charge_batch(&0, &10, &Some(false));
    assert_eq!(batch_include.len(), 1);
    assert_eq!(batch_include.get(0).unwrap(), user);
}

#[test]
fn test_pause_until_auto_resume_on_batch_charge_and_clears_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &90000);

    env.ledger().set_timestamp(90000);
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let result = client.batch_charge(&users);
    assert_eq!(result.get(0).unwrap(), crate::ChargeResult::Charged);

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

/// A batch mixing charges with paused / cancelled / missing / grace-elapsed
/// subscriptions emits one summary event whose counts reconcile with the
/// returned results.
#[test]
fn test_batch_charge_emits_skips_summary_with_counts() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let interval: u64 = 86400;

    install_admin(&env, &contract_id);
    client.propose_grace_period(&3600);
    client.commit_grace_period();

    let paused_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let cancelled_user =
        subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let grace_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let unknown_user = Address::generate(&env);

    client.pause(&paused_user);
    client.cancel(&cancelled_user);

    // Push grace_user past its interval AND its grace window.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 3601 + 1;
    });

    // Subscribe the chargeable user now, then advance just past its interval so
    // it is due but still inside the grace window.
    let chargeable = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(chargeable.clone());
    users.push_back(paused_user.clone());
    users.push_back(cancelled_user.clone());
    users.push_back(grace_user.clone());
    users.push_back(unknown_user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), ChargeResult::Paused);
    assert_eq!(results.get(2).unwrap(), ChargeResult::Inactive);
    assert_eq!(results.get(3).unwrap(), ChargeResult::GracePeriodElapsed);
    assert_eq!(results.get(4).unwrap(), ChargeResult::NoSubscription);

    let summary = find_batch_charge_skips(&env).expect("expected a batch_charge_skips event");
    assert_eq!(summary.total, 5);
    assert_eq!(summary.charged, 1);
    assert_eq!(summary.not_due, 0);
    assert_eq!(summary.paused, 1);
    assert_eq!(summary.inactive, 1);
    assert_eq!(summary.grace_elapsed, 1);
    assert_eq!(summary.no_subscription, 1);
    assert_eq!(summary.ledger_sequence, env.ledger().sequence());

    // The counts must account for every submitted address.
    assert_eq!(
        summary.charged
            + summary.not_due
            + summary.paused
            + summary.inactive
            + summary.grace_elapsed
            + summary.no_subscription
            + summary.allowance_insufficient,
        summary.total
    );
}

/// An all-success batch must not emit the summary — and its `charged` events
/// are unchanged.
#[test]
fn test_batch_charge_all_charged_emits_no_skips_summary() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let interval: u64 = 86400;

    let user_a = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let user_b = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), ChargeResult::Charged);

    assert!(
        find_batch_charge_skips(&env).is_none(),
        "an all-charged batch must stay silent"
    );

    // `charged` events are untouched by this feature.
    let charged_events = contract_events(&env)
        .iter()
        .filter(|(_, topics, _)| {
            let s: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
            s == Symbol::new(&env, "charged")
        })
        .count();
    assert_eq!(charged_events, 2);
}

/// Not-due skips are the common, uninteresting outcome and must not emit.
#[test]
fn test_batch_charge_not_due_only_emits_no_skips_summary() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let interval: u64 = 86400;

    let user_a = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let user_b = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), ChargeResult::Skipped);
    assert_eq!(results.get(1).unwrap(), ChargeResult::Skipped);

    assert!(
        find_batch_charge_skips(&env).is_none(),
        "a not-due-only batch must stay silent"
    );
}

/// An allowance shortfall is a per-user `AllowanceInsufficient` result (it does
/// not abort the batch) and is an interesting failure: it alone must emit the
/// summary, since a keeper needs to know a subscriber has to re-approve.
#[test]
fn test_batch_charge_allowance_insufficient_counted_in_skips_summary() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let interval: u64 = 86400;

    let ok_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let broke_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);

    // One stroop short of the gross subscription amount.
    token.approve(&broke_user, &contract_id, &(1_0000000 - 1), &200000);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(ok_user.clone());
    users.push_back(broke_user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), ChargeResult::AllowanceInsufficient);

    let summary = find_batch_charge_skips(&env).expect("expected a batch_charge_skips event");
    assert_eq!(summary.total, 2);
    assert_eq!(summary.charged, 1);
    assert_eq!(summary.allowance_insufficient, 1);
    assert_eq!(summary.not_due, 0);
    assert_eq!(
        summary.charged
            + summary.not_due
            + summary.paused
            + summary.inactive
            + summary.grace_elapsed
            + summary.no_subscription
            + summary.allowance_insufficient,
        summary.total
    );
}

/// A single interesting failure alongside not-due skips is enough to emit,
/// and the not-due count rides along for reconciliation.
#[test]
fn test_batch_charge_single_interesting_failure_emits_with_not_due_count() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let interval: u64 = 86400;

    let not_due_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let unknown_user = Address::generate(&env);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(not_due_user.clone());
    users.push_back(unknown_user.clone());

    client.batch_charge(&users);

    let summary = find_batch_charge_skips(&env).expect("expected a batch_charge_skips event");
    assert_eq!(summary.total, 2);
    assert_eq!(summary.not_due, 1);
    assert_eq!(summary.no_subscription, 1);
    assert_eq!(summary.charged, 0);
}

// Issue #813: batch_charge stress / resource-envelope coverage
//
// These tests exercise `batch_charge` at the configured max batch size and one
// above it, matching the resource envelope documented for `set_max_batch_size`.
// Soroban's per-invocation budget is finite, so each test resets it to
// unlimited up front (`env.cost_estimate().budget().reset_unlimited()`, as the existing
// `test_batch_charge_stress` does) so the setup + one `batch_charge` invocation
// is measured without being throttled by the 200 M default budget.
//
// Approximate resource usage for a max-size batch at the default cap (50):
//   - cost(n) ~= 50 x (storage read + fee + token transfer_from + events)
//   - at a configured cap of 5 the per-entry cost is identical; only `n` varies.
// The relevant ceiling enforced here is the batch-size check in `batch.rs`,
// which fires *before* any charging, so exceeding the cap panics with
// `ContractError::BatchTooLarge` (#20) rather than executing partial work.

/// Batch-charge exactly the configured max batch size; all entries succeed.
#[test]
fn test_batch_charge_at_configured_max() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    env.cost_estimate().budget().reset_unlimited();
    install_admin(&env, &contract_id);
    let client = FlowPayClient::new(&env, &contract_id);

    let batch_limit: u32 = 5;
    client.set_max_batch_size(&batch_limit);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..batch_limit {
        let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 1;
    });

    let results = client.batch_charge(&users);
    assert_eq!(results.len(), batch_limit);
    for r in results.into_iter() {
        assert_eq!(r, crate::ChargeResult::Charged);
    }
    for i in 0..batch_limit {
        let u = users.get(i).unwrap();
        assert!(client.get_subscription(&u).unwrap().active);
    }
}

/// Batch-charge one above the configured max panics with BatchTooLarge (#20).
#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_charge_above_configured_max_panics() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    env.cost_estimate().budget().reset_unlimited();
    install_admin(&env, &contract_id);
    let client = FlowPayClient::new(&env, &contract_id);

    let batch_limit: u32 = 5;
    client.set_max_batch_size(&batch_limit);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..=batch_limit {
        let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 1;
    });

    client.batch_charge(&users);
}

/// Batch-charge the default max (50) without explicit configuration succeeds.
#[test]
fn test_batch_charge_at_default_max() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    env.cost_estimate().budget().reset_unlimited();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..50 {
        let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 1;
    });

    // This checks the contract cap independently of network transaction limits.
    env.cost_estimate().disable_resource_limits();
    let results = client.batch_charge(&users);
    assert_eq!(results.len(), 50);
    for r in results.into_iter() {
        assert_eq!(r, crate::ChargeResult::Charged);
    }
    for i in 0..50u32 {
        let u = users.get(i).unwrap();
        assert!(client.get_subscription(&u).unwrap().active);
    }
}

/// Batch-charge one above the default max panics with BatchTooLarge (#20).
#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_charge_over_default_max_panics() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    env.cost_estimate().budget().reset_unlimited();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 1;
    });

    client.batch_charge(&users);
}

/// A batch_charge where one user has an extreme legacy interval (injected
/// directly into storage, bypassing validation) must NOT abort the batch —
/// all other users in the batch must still be processed.
#[test]
fn test_overflow_interval_in_batch_does_not_abort_batch() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // user2 has a normal subscription.
    let user2 = setup_funded_user(&env, &contract_id, &token_addr);
    client.subscribe(
        &user2,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Inject a legacy subscription with interval = u64::MAX directly into
    // storage, simulating a subscription that pre-dates the cap.
    let extreme_sub = crate::Subscription {
        merchant: merchant.clone(),
        amount: 1_0000000,
        interval: u64::MAX,
        last_charged: 0,
        active: true,
        paused: false,
        token: token_addr.clone(),
        referrer: None,
        label: Symbol::new(&env, ""),
        trial_duration: 0,
        created_at: 0,
    };
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&storage::subscription_key(&env, &user), &extreme_sub);
    });

    // Advance time so user2's interval has elapsed.
    env.ledger().with_mut(|l| {
        l.timestamp += 86401;
    });

    let mut users: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    users.push_back(user2.clone());

    // The batch must not panic. The extreme-interval user is skipped (NotDue
    // because last_charged + u64::MAX saturates to u64::MAX, which is always
    // in the future), and user2 is charged successfully.
    let results = client.batch_charge(&users);
    assert_eq!(results.len(), 2);

    // user with u64::MAX interval: last_charged=0, interval=u64::MAX →
    // next = saturating_add(0, u64::MAX) = u64::MAX → NotDue (Skipped).
    assert_eq!(results.get(0).unwrap(), ChargeResult::Skipped);

    // user2 with normal interval must be charged.
    assert_eq!(results.get(1).unwrap(), ChargeResult::Charged);
}

// ─────────────────────────────────────────────────────────────
// Issue #1017: set_max_batch_size rejects zero
// ─────────────────────────────────────────────────────────────

/// size = 0 must be rejected with InvalidBatchSize (#29).
#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_set_max_batch_size_zero_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);
    client.set_max_batch_size(&0);
}

/// size = 1 (minimum valid) must be accepted.
#[test]
fn test_set_max_batch_size_one_accepted() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);
    client.set_max_batch_size(&1);
    assert_eq!(client.get_max_batch_size(), 1);
}

/// size = 200 (ceiling) must be accepted.
#[test]
fn test_set_max_batch_size_ceiling_accepted() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);
    client.set_max_batch_size(&200);
    assert_eq!(client.get_max_batch_size(), 200);
}

/// size = 201 (above ceiling) must be rejected with InvalidBatchSize (#29).
#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_set_max_batch_size_above_ceiling_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);
    client.set_max_batch_size(&201);
}

// ─────────────────────────────────────────────────────────────
// Issue #1200: saturating grace-period math in precheck_charge
// ─────────────────────────────────────────────────────────────

/// Regression: batch_charge must complete per-user (not abort) when a
/// subscriber has a near-u64::MAX grace_period and an extreme interval.
/// Before the fix, the raw `next + grace_period` addition trapped on the
/// host (overflow-checks = true), rolling back the entire transaction.
#[test]
fn test_batch_charge_survives_extreme_grace_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Set a grace period near u64::MAX / 2 (the admin ceiling in grace.rs).
    let huge_grace: u64 = u64::MAX / 2;
    client.propose_grace_period(&huge_grace);
    client.commit_grace_period();

    // Subscribe with the default minimum interval so the charge is due after
    // one interval. (Interval 1 would now trip `ContractError::IntervalTooShort`
    // because `subscribe` enforces the configurable min-interval floor.)
    let interval: u64 = 3600;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Advance past the interval so the charge is due.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // batch_charge must return a per-user result vector and not trap, even
    // with a near-u64::MAX grace period configured.
    // It returns a per-user result vector and does not trap.
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    // Exactly one result, and it must be a successful charge (not an error).
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
}
