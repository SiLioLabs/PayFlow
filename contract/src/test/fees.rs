#[test]
fn test_charge_applies_protocol_fee_and_records_net_revenue() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &500);
    client.commit_fee(); // 5%

    let amount: i128 = 10_0000000;
    let expected_fee: i128 = 500_0000;
    let expected_net: i128 = amount - expected_fee;
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

    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&merchant) - merchant_before, expected_net);
    assert_eq!(token.balance(&collector) - collector_before, expected_fee);
    assert_eq!(client.get_merchant_revenue(&merchant), expected_net);
}

#[test]
fn test_charge_event_records_paid_to_global_collector() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &500);
    client.commit_fee(); // 5%

    let amount: i128 = 10_0000000;
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
    client.charge(&user);

    let mut charged_event_found = false;
    for (_, topics, data) in contract_events(&env).iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        if topic_symbol == Symbol::new(&env, "charged") {
            let event_data: crate::events::ChargeEventData = data.try_into_val(&env).unwrap();
            assert_eq!(event_data.fee, 500_0000);
            assert_eq!(event_data.paid_to, Some(collector.clone()));
            charged_event_found = true;
        }
    }
    assert!(
        charged_event_found,
        "expected a charged event with global collector"
    );
}

#[test]
fn test_charge_event_records_paid_to_merchant_fee_recipient_override() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);
    let recipient_override = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &500);
    client.commit_fee(); // 5%

    // Configure custom fee recipient for the merchant
    client.set_merchant_fee_recipient(&merchant, &recipient_override);

    let amount: i128 = 10_0000000;
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
    client.charge(&user);

    let mut charged_event_found = false;
    for (_, topics, data) in contract_events(&env).iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        if topic_symbol == Symbol::new(&env, "charged") {
            let event_data: crate::events::ChargeEventData = data.try_into_val(&env).unwrap();
            assert_eq!(event_data.fee, 500_0000);
            assert_eq!(event_data.paid_to, Some(recipient_override.clone()));
            charged_event_found = true;
        }
    }
    assert!(
        charged_event_found,
        "expected a charged event with merchant override fee recipient"
    );
}

#[test]
fn test_charge_event_records_paid_to_none_when_fee_is_zero() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 10_0000000;
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
    client.charge(&user);

    let mut charged_event_found = false;
    for (_, topics, data) in contract_events(&env).iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        if topic_symbol == Symbol::new(&env, "charged") {
            let event_data: crate::events::ChargeEventData = data.try_into_val(&env).unwrap();
            assert_eq!(event_data.fee, 0);
            assert_eq!(event_data.paid_to, None);
            charged_event_found = true;
        }
    }
    assert!(
        charged_event_found,
        "expected a charged event with None paid_to"
    );
}

/// An allowance exactly equal to the gross amount must cover BOTH transfer
/// legs (fee + net) when fee_bps > 0.
#[test]
fn test_charge_exact_gross_allowance_succeeds_with_fee() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 500); // 5%

    let amount: i128 = 10_0000000;
    let expected_fee: i128 = 500_0000;
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

    // Tighten the allowance to exactly the gross amount — not a stroop more.
    token.approve(&user, &contract_id, &amount, &200000);
    assert_eq!(token.allowance(&user, &contract_id), amount);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&collector), expected_fee);
    assert_eq!(token.balance(&merchant), amount - expected_fee);
    // Both legs drew on the same allowance, consuming it exactly.
    assert_eq!(token.allowance(&user, &contract_id), 0);
}

/// A fee that rounds down to zero still charges the full gross amount and
/// needs the full gross allowance.
#[test]
fn test_charge_with_fee_rounding_to_zero_uses_full_gross_allowance() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 500); // 5%

    // 1 * 500 / 10_000 == 0 — the fee leg is skipped entirely.
    let amount: i128 = 1;
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

    token.approve(&user, &contract_id, &amount, &200000);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&collector), 0);
    assert_eq!(token.balance(&merchant), amount);
    assert_eq!(client.get_total_protocol_fees(), 0);
}

/// pay_per_use runs the same two-leg pattern and the same preflight.
#[test]
fn test_pay_per_use_exact_gross_allowance_succeeds_with_fee() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 500); // 5%

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    let amount: i128 = 10_0000000;
    let expected_fee: i128 = 500_0000;
    token.approve(&user, &contract_id, &amount, &200000);

    client.pay_per_use(&user, &amount);

    assert_eq!(token.balance(&collector), expected_fee);
    assert_eq!(token.balance(&merchant), amount - expected_fee);
    assert_eq!(token.allowance(&user, &contract_id), 0);
}

// Note: setter input validation is covered in contract code; invoking it directly
// via the generated client isn't available in these tests. The storage-level
// behavior for routing is covered by the tests above.

#[test]
fn test_charge_with_zero_fee_bps_skips_fee_transfer() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &0);
    client.commit_fee();

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

    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&merchant) - merchant_before, amount);
    assert_eq!(token.balance(&collector) - collector_before, 0);
}

#[test]
fn test_referral_cleared_on_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer));

    client.cancel(&user);

    assert_eq!(client.get_referrer(&user), None);
}

#[test]
fn test_pay_per_use_applies_protocol_fee_and_records_net_revenue() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &250);
    client.commit_fee(); // 2.5%

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let amount: i128 = 8_0000000;
    let expected_fee: i128 = 200_0000;
    let expected_net: i128 = amount - expected_fee;
    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    client.pay_per_use(&user, &amount);

    assert_eq!(token.balance(&merchant) - merchant_before, expected_net);
    assert_eq!(token.balance(&collector) - collector_before, expected_fee);
    assert_eq!(client.get_merchant_revenue(&merchant), expected_net);
}

#[test]
fn test_pay_per_use_to_applies_protocol_fee_to_recipient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &250);
    client.commit_fee(); // 2.5%

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let amount: i128 = 8_0000000;
    let expected_fee: i128 = 200_0000;
    let expected_net: i128 = amount - expected_fee;
    let recipient_before = token.balance(&recipient);
    let collector_before = token.balance(&collector);

    client.pay_per_use_to(&user, &amount, &recipient);

    assert_eq!(token.balance(&recipient) - recipient_before, expected_net);
    assert_eq!(token.balance(&collector) - collector_before, expected_fee);
    assert_eq!(client.get_merchant_revenue(&recipient), expected_net);
}

#[test]
fn test_pay_per_use_with_zero_fee_bps_transfers_full_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &0);
    client.commit_fee();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let amount: i128 = 3_0000000;
    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    client.pay_per_use(&user, &amount);

    assert_eq!(token.balance(&merchant) - merchant_before, amount);
    assert_eq!(token.balance(&collector) - collector_before, 0);
}

/// Issue #201: batch_charge applies protocol fees identically to charge().
#[test]
fn test_batch_charge_with_fee() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user_a);
    });

    let collector = Address::generate(&env);
    let fee_bps: u32 = 100; // 1%
    client.propose_fee(&collector, &fee_bps);
    client.commit_fee();

    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    let amount: i128 = 10_000_000; // 1 XLM
    let interval: u64 = 86400;
    let expected_fee = amount * (fee_bps as i128) / 10_000;
    let expected_net = amount - expected_fee;

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

    let user_a_balance_before = token.balance(&user_a);
    let user_b_balance_before = token.balance(&user_b);
    let merchant_balance_before = token.balance(&merchant);
    let collector_balance_before = token.balance(&collector);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::Charged);

    assert_eq!(
        user_a_balance_before - token.balance(&user_a),
        amount,
        "user_a debited gross amount"
    );
    assert_eq!(
        user_b_balance_before - token.balance(&user_b),
        amount,
        "user_b debited gross amount"
    );
    assert_eq!(
        token.balance(&merchant) - merchant_balance_before,
        expected_net * 2,
        "merchant receives net per user"
    );
    assert_eq!(
        token.balance(&collector) - collector_balance_before,
        expected_fee * 2,
        "collector receives fee per user"
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// merchant_stats tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_merchant_revenue_from_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

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

    assert_eq!(client.get_merchant_revenue(&merchant), 0);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(client.get_merchant_revenue(&merchant), amount);
}

#[test]
fn test_merchant_revenue_from_pay_per_use() {
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
    client.pay_per_use(&user, &3_0000000);

    assert_eq!(client.get_merchant_revenue(&merchant), 3_0000000);
}

#[test]
fn test_merchant_revenue_accumulates() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 2_0000000;
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
    client.charge(&user);

    client.pay_per_use(&user, &1_0000000);

    assert_eq!(client.get_merchant_revenue(&merchant), 3_0000000);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ─────────────────────────────────────────────────────────────
// Issue #96: referral tracking tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_referral_stored_on_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );

    assert_eq!(client.get_referrer(&user), Some(referrer));
}

#[test]
fn test_no_referral_returns_none() {
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

    assert!(client.get_referrer(&user).is_none());
}

#[test]
fn test_referral_updates_on_resubscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer_a = Address::generate(&env);
    let referrer_b = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer_a.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer_a));

    client.subscribe(
        &user,
        &merchant,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &Some(referrer_b.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer_b));
}

// ─────────────────────────────────────────────────────────────
// Issue #1011: TTL-extend referral attribution keys on write
// ─────────────────────────────────────────────────────────────

/// After subscribe with a referrer, the Referral key must be live in
/// persistent storage (i.e. has() returns true) because store_referral
/// calls extend_ttl to the full SUBSCRIPTION_TTL_LEDGERS window.
#[test]
fn test_referral_ttl_extended_on_store() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );

    // Verify the key is present and has a non-zero TTL immediately after write.
    env.as_contract(&contract_id, || {
        assert!(
            env.storage()
                .persistent()
                .has(&DataKey::Referral(user.clone())),
            "Referral key must exist after store_referral"
        );
    });

    // Reading the referrer must still return the correct value.
    assert_eq!(client.get_referrer(&user), Some(referrer));
}

/// A simulated archival (advance ledger past the default SDK live-until
/// without the new extend_ttl in place would evict the key; with it the
/// key stays live up to SUBSCRIPTION_TTL_LEDGERS).  We verify that after
/// the key is gone (simulated by raw removal), get_referrer returns None
/// without panicking — satisfying the "after archival, reads return none
/// without a panic" acceptance criterion.
#[test]
fn test_referral_returns_none_after_archival() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );

    // Simulate archival: forcibly remove the key from inside the contract context.
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .remove(&DataKey::Referral(user.clone()));
    });

    // After archival the public API must return None, not panic.
    assert_eq!(
        client.get_referrer(&user),
        None,
        "get_referrer must return None after key is archived/removed"
    );
}

/// remove_referral (called by cancel) must drop the Referral key entirely
/// so that no orphan entry is left behind.  A subsequent get_referrer
/// must return None and persistent has() must be false.
#[test]
fn test_remove_referral_drops_key_cleanly() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );

    // Confirm the key exists before cancellation.
    env.as_contract(&contract_id, || {
        assert!(
            env.storage()
                .persistent()
                .has(&DataKey::Referral(user.clone())),
            "Referral key must exist before cancel"
        );
    });

    client.cancel(&user);

    // After cancel the key must be completely gone — no orphan entry.
    env.as_contract(&contract_id, || {
        assert!(
            !env.storage()
                .persistent()
                .has(&DataKey::Referral(user.clone())),
            "Referral key must be removed after cancel (no orphan)"
        );
    });

    // Public API must also reflect the removal.
    assert_eq!(
        client.get_referrer(&user),
        None,
        "get_referrer must return None after cancel"
    );
}

/// Cancelling a subscription that had no referrer must not panic even
/// though remove_referral calls .remove() on a key that may not exist.
#[test]
fn test_remove_referral_without_referrer_is_safe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None, // no referrer
    );

    // cancel must not panic even though no Referral key was ever written.
    client.cancel(&user);

    assert_eq!(client.get_referrer(&user), None);
}

/// Resubscribing overwrites the referral and must bump the TTL afresh.
/// Both the old and new referrer values are exercised.
#[test]
fn test_referral_ttl_refreshed_on_resubscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer_a = Address::generate(&env);
    let referrer_b = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer_a.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer_a));

    // Resubscribe with a new referrer — key must be updated and TTL bumped.
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer_b.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer_b));

    env.as_contract(&contract_id, || {
        assert!(
            env.storage()
                .persistent()
                .has(&DataKey::Referral(user.clone())),
            "Referral key must still be live after resubscribe"
        );
    });
}

#[test]
fn test_referral_clears_on_resubscribe_with_none() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer));

    client.subscribe(
        &user,
        &merchant,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &None,
    );
    assert!(client.get_referrer(&user).is_none());
}

#[test]
fn test_self_referral_rejected_via_try_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(user.clone()),
    );

    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(11))));
}

#[test]
fn test_get_protocol_stats_with_fee() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Set admin directly in instance storage so admin-gated functions work
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    env.mock_all_auths();
    let fee_collector = Address::generate(&env);
    client.propose_fee(&fee_collector, &100); // 1% fee
    client.commit_fee();

    let stats = client.get_protocol_stats();
    assert_eq!(stats.fee_bps, 100);
    assert_eq!(stats.fee_collector, Some(fee_collector));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// clear_merchant_revenue_history tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Admin can clear history; subsequent query returns an empty Vec (zero-length).
/// Clearing does not affect the cumulative revenue total.
#[test]
fn test_clear_merchant_revenue_history_drops_history() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);

    // Produce some history via a charge
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
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    // History should have one entry
    let history_before = client.get_merchant_revenue_history(&merchant, &10u32);
    assert_eq!(history_before.len(), 1);

    // Cumulative revenue is present
    let revenue = client.get_merchant_revenue(&merchant);
    assert!(revenue > 0);

    // Clear history as admin
    client.clear_merchant_revenue_history(&merchant);

    // History is now zero-length
    let history_after = client.get_merchant_revenue_history(&merchant, &10u32);
    assert_eq!(history_after.len(), 0);

    // Cumulative revenue is untouched
    assert_eq!(client.get_merchant_revenue(&merchant), revenue);
}

/// Clearing history for a merchant with no recorded data is idempotent (does not panic).
#[test]
fn test_clear_merchant_revenue_history_idempotent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let unknown_merchant = Address::generate(&env);

    client.set_initial_admin(&admin);

    // First call â€” no data exists, must not panic
    client.clear_merchant_revenue_history(&unknown_merchant);
    // Second call â€” still no data, must not panic
    client.clear_merchant_revenue_history(&unknown_merchant);

    assert_eq!(
        client
            .get_merchant_revenue_history(&unknown_merchant, &5u32)
            .len(),
        0
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue: fee_updated event on set_fee
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_set_fee_emits_event() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &100);
    client.commit_fee();

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (emitted_collector, emitted_bps): (Address, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "fee_committed"));
    assert_eq!(emitted_collector, collector);
    assert_eq!(emitted_bps, 100u32);
}

#[test]
fn test_get_fee_returns_current_fee_settings() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &250);
    client.commit_fee();

    assert_eq!(client.get_fee(), Some((collector, 250u32)));
}

#[test]
#[should_panic]
fn test_set_fee_invalid_bps_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &10001);
    client.commit_fee();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ─────────────────────────────────────────────────────────────
// Merchant revenue direct settlement (non-custodial) tests
// ─────────────────────────────────────────────────────────────

/// Merchant revenue is non-custodial: on charge, funds are transferred
/// directly from the user to the merchant wallet via SAC transfer_from.
/// The contract balance remains 0, while get_merchant_revenue records
/// cumulative earned revenue.
#[test]
fn test_merchant_revenue_settles_directly_non_custodial() {
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

    let merchant_balance_before = token.balance(&merchant);
    let contract_balance_before = token.balance(&contract_id);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    // Merchant token balance increases immediately by charge amount (no withdraw step required).
    let merchant_balance_after = token.balance(&merchant);
    assert_eq!(
        merchant_balance_after - merchant_balance_before,
        amount,
        "merchant should receive funds directly upon charge"
    );

    // Contract holds no merchant funds (non-custodial).
    let contract_balance_after = token.balance(&contract_id);
    assert_eq!(
        contract_balance_after, contract_balance_before,
        "contract balance must remain unchanged (non-custodial)"
    );

    // Cumulative revenue counter reflects earned revenue.
    assert_eq!(
        client.get_merchant_revenue(&merchant),
        amount,
        "revenue counter should match charged amount"
    );
}

#[test]
fn test_referral_reward_accrues_once_per_charge_and_can_be_withdrawn() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin_addr = Address::generate(&env);
    let collector = Address::generate(&env);
    let referrer = Address::generate(&env);
    env.as_contract(&contract_id, || storage::set_admin(&env, &admin_addr));
    client.propose_fee(&collector, &1_000);
    client.commit_fee();
    let amount = 10_000_000i128;
    let interval = client.get_min_interval();
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );

    env.ledger().with_mut(|l| l.timestamp += interval + 1);
    client.charge(&user);
    let first_reward = client.get_referral_reward_balance(&token_addr, &referrer);
    assert_eq!(
        first_reward, 100_000,
        "charge: reward should be 10% of the 10% protocol fee"
    );
    assert_eq!(
        token.balance(&contract_id),
        first_reward,
        "charge: contract balance should equal undistributed referral rewards"
    );

    let new_user = Address::generate(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&new_user, &amount);
    token.approve(&new_user, &contract_id, &amount, &200_000);
    client.transfer_subscription(&user, &new_user);
    assert_eq!(
        client.get_referrer(&new_user),
        Some(referrer.clone()),
        "transfer: referral attribution must follow the subscription"
    );

    env.ledger().with_mut(|l| l.timestamp += interval + 1);
    client.charge(&new_user);
    assert_eq!(
        client.get_referral_reward_balance(&token_addr, &referrer),
        first_reward * 2,
        "second charge: reward must accrue exactly once"
    );
    client.withdraw_referral_rewards(&token_addr, &referrer);
    assert_eq!(
        client.get_referral_reward_balance(&token_addr, &referrer),
        0,
        "withdrawal: reward liability must clear"
    );
    assert_eq!(
        token.balance(&contract_id),
        0,
        "withdrawal: contract must release the reward reserve"
    );
}

#[test]
fn test_batch_cancel_handles_mixed_states_and_clears_referral() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = setup_funded_user(&env, &contract_id, &token_addr);
    let user_c = setup_funded_user(&env, &contract_id, &token_addr);
    let missing_user = Address::generate(&env);
    let referrer = Address::generate(&env);

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
        &Some(referrer.clone()),
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
    client.subscribe(
        &user_c,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user_c);
    assert_eq!(count_user_events(&env, "cancelled", &user_c), 1);

    assert_eq!(client.get_referrer(&user_a), Some(referrer));

    let mut users = Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());
    users.push_back(user_c.clone());
    users.push_back(missing_user.clone());

    let results = client.batch_cancel(&users);
    assert_eq!(count_user_events(&env, "cancelled", &user_a), 1);
    assert_eq!(count_user_events(&env, "cancelled", &user_b), 1);
    assert_eq!(count_user_events(&env, "cancelled", &user_c), 0);

    assert_eq!(results.len(), 4);
    assert_eq!(results.get(0).unwrap(), CancelResult::Cancelled);
    // user_b was paused: `batch_cancel` still cancels it but reports the
    // distinct paused outcome.
    assert_eq!(results.get(1).unwrap(), CancelResult::PausedCancelled);
    assert_eq!(results.get(2).unwrap(), CancelResult::AlreadyCancelled);
    assert_eq!(results.get(3).unwrap(), CancelResult::NoSubscription);

    assert!(!client.get_subscription(&user_a).unwrap().active);
    assert!(!client.get_subscription(&user_b).unwrap().active);
    assert!(!client.get_subscription(&user_c).unwrap().active);
    assert!(client.get_subscription(&missing_user).is_none());

    assert_eq!(client.get_referrer(&user_a), None);
    assert_eq!(client.get_active_count(), 0);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);
    assert_eq!(client.get_subscriber_count(), 3);
    assert!(client.get_subscriber_at(&0).is_none());
    assert!(client.get_subscriber_at(&1).is_none());
    assert!(client.get_subscriber_at(&2).is_none());
}

#[test]
fn test_pay_per_use_to_zero_fee_bps_full_amount_to_recipient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
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

    let amount: i128 = 4_0000000;
    let recipient_before = token.balance(&recipient);

    client.pay_per_use_to(&user, &amount, &recipient);

    assert_eq!(token.balance(&recipient) - recipient_before, amount);
}

// ─────────────────────────────────────────────────────────────
// Tests for Issue #634: get_merchant_revenue_summary
// ─────────────────────────────────────────────────────────────

#[test]
fn test_merchant_revenue_summary_empty() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let summary = client.get_merchant_revenue_summary(&merchant);
    assert_eq!(summary, (0, 0, 0, 0));
}

#[test]
fn test_merchant_revenue_summary_single_and_multiple_charges() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 10_0000000;
    client.subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);
    client.pay_per_use(&user, &amount);

    // First charge recorded: 10_0000000
    let summary1 = client.get_merchant_revenue_summary(&merchant);
    assert_eq!(summary1, (amount, 1, amount, amount));

    // Additional pay_per_use calls with different amounts
    client.pay_per_use(&user, &5_0000000);
    client.pay_per_use(&user, &25_0000000);

    let summary2 = client.get_merchant_revenue_summary(&merchant);
    // total = 10 + 5 + 25 = 40_0000000
    // count = 3
    // min = 5_0000000
    // max = 25_0000000
    assert_eq!(summary2, (40_0000000, 3, 5_0000000, 25_0000000));
}

#[test]
fn test_merchant_revenue_summary_cleared_history() {
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
    client.pay_per_use(&user, &10_0000000);
    client.clear_merchant_revenue_history(&merchant);

    let summary = client.get_merchant_revenue_summary(&merchant);
    // History cleared -> total remains 10_0000000, count/min/max return 0
    assert_eq!(summary, (10_0000000, 0, 0, 0));
}

// ─────────────────────────────────────────────────────────────
// Issue #611: propose_fee / commit_fee two-step tests
// ─────────────────────────────────────────────────────────────

/// Full propose → commit flow sets the fee collector and bps.
#[test]
fn test_propose_and_commit_fee_sets_fee() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &250);
    client.commit_fee();

    let result = client.get_fee();
    assert!(result.is_some());
    let (stored_collector, stored_bps) = result.unwrap();
    assert_eq!(stored_collector, collector);
    assert_eq!(stored_bps, 250);
}

/// propose_fee emits a fee_proposed event.
#[test]
fn test_propose_fee_emits_fee_proposed_event() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &100);

    let events = contract_events(&env);
    let (_, topics, _) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "fee_proposed"));
}

/// commit_fee emits a fee_committed event.
#[test]
fn test_commit_fee_emits_fee_committed_event() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &50);
    client.commit_fee();

    let events = contract_events(&env);
    let (_, topics, _) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "fee_committed"));
}

/// commit_fee without a prior propose panics with NoPendingProposal (#23).
#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_commit_fee_without_proposal_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.commit_fee();
}

/// propose_fee with bps > 10000 panics with InvalidFeeBps (#13).
#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_propose_fee_invalid_bps_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &10_001);
}

/// Bps of exactly 10000 (100%) is valid at both propose and commit.
#[test]
fn test_propose_fee_max_valid_bps() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &10_000);
    client.commit_fee();

    let (_, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_bps, 10_000);
}

/// Bps of 0 is valid (disabling the fee while keeping the collector).
#[test]
fn test_propose_fee_zero_bps_valid() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &0);
    client.commit_fee();

    let (_, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_bps, 0);
}

// ─────────────────────────────────────────────
// Issue 012: commit_fee bounds re-validation
// ─────────────────────────────────────────────

/// commit_fee rejects when bounds tightened after propose (bps above new max).
#[test]
#[should_panic(expected = "Error(Contract, #35)")]
fn test_commit_fee_rejects_when_bounds_tightened_above_max() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Propose 500 bps — within default bounds (0, 10000)
    client.propose_fee(&collector, &500);

    // Tighten max to 200 bps before commit
    client.set_fee_bounds(&0, &200);

    // Commit should reject 500 bps against new [0, 200] bounds
    client.commit_fee();
}

/// commit_fee rejects when bounds tightened after propose (bps below new min).
#[test]
#[should_panic(expected = "Error(Contract, #35)")]
fn test_commit_fee_rejects_when_bounds_tightened_below_min() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Propose 50 bps
    client.propose_fee(&collector, &50);

    // Raise min to 100 bps before commit
    client.set_fee_bounds(&100, &10000);

    // Commit should reject 50 bps against new [100, 10000] bounds
    client.commit_fee();
}

/// commit_fee succeeds when pending bps are within current bounds.
#[test]
fn test_commit_fee_succeeds_when_within_bounds() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.set_fee_bounds(&10, &500);
    client.propose_fee(&collector, &200);
    client.commit_fee();

    let (_, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_bps, 200);
}

/// commit_fee succeeds when no bounds are configured (defaults to 0..10000).
#[test]
fn test_commit_fee_succeeds_with_default_bounds() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // No set_fee_bounds call — defaults to (0, 10000)
    client.propose_fee(&collector, &750);
    client.commit_fee();

    let (_, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_bps, 750);
}

// ─────────────────────────────────────────────────────────────
// Issue #3: Per-Merchant Fee Recipient Tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_set_and_get_merchant_fee_recipient() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(client.get_merchant_fee_recipient(&merchant), None);

    let custom_recipient = Address::generate(&env);
    client.set_merchant_fee_recipient(&merchant, &custom_recipient);

    assert_eq!(
        client.get_merchant_fee_recipient(&merchant),
        Some(custom_recipient)
    );
}

#[test]
fn test_set_merchant_fee_recipient_contract_address_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let res = client.try_set_merchant_fee_recipient(&merchant, &contract_id);
    assert!(res.is_err());
}

#[test]
fn test_merchant_fee_recipient_routing_and_fallback() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let global_collector = Address::generate(&env);
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.propose_fee(&global_collector, &100);
    client.commit_fee();

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    env.ledger().set_timestamp(86400);
    client.charge(&user);
    assert_eq!(token.balance(&global_collector), 10);
    assert_eq!(token.balance(&merchant), 990);

    let custom_recipient = Address::generate(&env);
    client.set_merchant_fee_recipient(&merchant, &custom_recipient);

    env.ledger().set_timestamp(172800);
    client.charge(&user);
    assert_eq!(token.balance(&custom_recipient), 10);
    assert_eq!(token.balance(&global_collector), 10);
    assert_eq!(token.balance(&merchant), 1980);
}

// ─────────────────────────────────────────────────────────────
// Issue #1012: MerchantFeeRecipient TTL durability tests
// ─────────────────────────────────────────────────────────────

/// Scenario: archival-before-charge
/// The merchant sets a custom fee recipient, then the ledger advances well
/// past the naive minimum TTL that would apply without an explicit extension.
/// The charge must still route fees to the custom recipient — proving that
/// set_merchant_fee_recipient bumps the TTL on write.
#[test]
fn test_merchant_fee_recipient_survives_archival_before_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let global_collector = Address::generate(&env);
    client.propose_fee(&global_collector, &500); // 5%
    client.commit_fee();

    let custom_recipient = Address::generate(&env);
    // set_merchant_fee_recipient must extend TTL to SUBSCRIPTION_TTL_LEDGERS
    client.set_merchant_fee_recipient(&merchant, &custom_recipient);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Advance the ledger well past the live-until the host assigns to a fresh
    // persistent entry (min_persistent_entry_ttl = 4096 ledgers): without the
    // TTL bump in set_merchant_fee_recipient the entry would be archived here.
    // 50,000 keeps the scenario meaningful while staying under the window the
    // token builtin gives its own instance (~120,960 per call) — a larger jump
    // would archive the token contract instance and make the allowance/balance
    // calls below panic, a limitation of the test host rather than of the
    // fee-recipient logic under test.
    env.ledger().with_mut(|l| {
        l.sequence_number += 50_000;
        l.timestamp += interval + 1;
    });

    let recipient_before = token.balance(&custom_recipient);
    let global_before = token.balance(&global_collector);

    client.charge(&user);

    // Fee (5% of 1000 = 50) goes to custom_recipient, NOT global_collector
    assert_eq!(token.balance(&custom_recipient) - recipient_before, 50);
    assert_eq!(token.balance(&global_collector) - global_before, 0);
}

/// Scenario: archival-mid-config
/// The merchant sets a custom fee recipient. A first charge extends the TTL
/// on read. A second charge, after another large ledger gap, must still route
/// to the custom recipient — proving that get_merchant_fee_recipient re-bumps
/// the TTL on every charge so a configured recipient cannot lapse during
/// steady-state operation.
#[test]
fn test_merchant_fee_recipient_ttl_refreshed_on_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let global_collector = Address::generate(&env);
    client.propose_fee(&global_collector, &500); // 5%
    client.commit_fee();

    let custom_recipient = Address::generate(&env);
    client.set_merchant_fee_recipient(&merchant, &custom_recipient);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // First charge: advances past the default persistent-entry TTL (4096
    // ledgers) so the read-time extend in get_merchant_fee_recipient is what
    // keeps the entry alive. See the archival-before-charge test above for why
    // the gap is 50,000 rather than SUBSCRIPTION_TTL_LEDGERS / 2.
    env.ledger().with_mut(|l| {
        l.sequence_number += 50_000;
        l.timestamp += interval + 1;
    });

    client.charge(&user); // read-time TTL bump happens here

    // Second charge: another gap past the default TTL. If the read-time
    // re-extension from the first charge (or the write-time extension on
    // set_merchant_fee_recipient) had not kept the entry alive, the key would
    // already be archived and this entire call would panic.
    env.ledger().with_mut(|l| {
        l.sequence_number += 50_000;
        l.timestamp += interval + 1;
    });

    let recipient_before = token.balance(&custom_recipient);
    let global_before = token.balance(&global_collector);

    client.charge(&user);

    // Fee on second charge must still reach custom_recipient
    assert_eq!(token.balance(&custom_recipient) - recipient_before, 50);
    assert_eq!(token.balance(&global_collector) - global_before, 0);
}

/// Global fallback still applies when no custom recipient is configured.
/// This ensures TTL extension in the write path doesn't interfere with the
/// fee-routing resolution order (custom over global).
#[test]
fn test_merchant_fee_recipient_global_fallback_when_not_configured() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let global_collector = Address::generate(&env);
    client.propose_fee(&global_collector, &500); // 5%
    client.commit_fee();

    // No custom recipient set for this merchant
    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let global_before = token.balance(&global_collector);
    let merchant_before = token.balance(&merchant);

    client.charge(&user);

    // Full fee goes to global_collector; merchant gets net
    assert_eq!(token.balance(&global_collector) - global_before, 50);
    assert_eq!(token.balance(&merchant) - merchant_before, 950);
}

#[test]
fn test_merchant_fee_recipient_routes_pay_per_use_and_falls_back() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let global_collector = Address::generate(&env);
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&global_collector, &100);
    client.commit_fee();

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    client.pay_per_use(&user, &1000);
    assert_eq!(token.balance(&global_collector), 10);
    assert_eq!(token.balance(&merchant), 990);

    let custom_recipient = Address::generate(&env);
    client.set_merchant_fee_recipient(&merchant, &custom_recipient);

    client.pay_per_use(&user, &1000);
    assert_eq!(token.balance(&custom_recipient), 10);
    assert_eq!(token.balance(&global_collector), 10);
    assert_eq!(token.balance(&merchant), 1980);
}

// ─────────────────────────────────────────────────────────────
// Issue #5: get_referral Read Function Tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_get_referral_lifecycle() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let referrer = Address::generate(&env);

    assert_eq!(client.get_referral(&user), None);

    client.subscribe(
        &user,
        &merchant,
        &1000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    assert_eq!(client.get_referral(&user), Some(referrer.clone()));

    client.cancel(&user);
    assert_eq!(client.get_referral(&user), None);

    client.subscribe(
        &user,
        &merchant,
        &1000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    assert_eq!(client.get_referral(&user), Some(referrer));
}

/// `amount * bps` must not wrap for amounts beyond the economic caps.
#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_calculate_fee_amount_overflow_fails_with_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        fee::calculate_fee_amount(&env, i128::MAX, 10_000);
    });
}

#[test]
fn test_calculate_fee_amount_at_max_subscription_amount_does_not_overflow() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        // The largest amount the contract will accept, at the maximum bps.
        assert_eq!(
            fee::calculate_fee_amount(&env, MAX_SUBSCRIPTION_AMOUNT, 10_000),
            MAX_SUBSCRIPTION_AMOUNT
        );
        assert_eq!(
            fee::calculate_fee_amount(&env, MAX_SUBSCRIPTION_AMOUNT, 0),
            0
        );
    });
}

/// Accruing a fee onto a `TotalProtocolFees` counter at `i128::MAX` must fail
/// closed rather than wrap the protocol's own bookkeeping.
#[test]
fn test_protocol_fee_accrual_overflow_fails_with_typed_error() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    configure_fee(&env, &contract_id, 500);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::TotalProtocolFees, &i128::MAX);
    });

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let res = client.try_charge(&user);
    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(36))));
}

// ─────────────────────────────────────────────────────────────
// Admin event tests — #1027 / #1028 / #1029 / #1030
// ─────────────────────────────────────────────────────────────

// ── #1029: fee_bounds_set ─────────────────────────────────────

#[test]
fn test_fee_bounds_set_event_emitted() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_fee_bounds(&100, &500);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (min_bps, max_bps): (u32, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "fee_bounds_set"));
    assert_eq!(min_bps, 100u32);
    assert_eq!(max_bps, 500u32);
}

#[test]
fn test_fee_bounds_set_event_values_match_get_fee_bounds() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_fee_bounds(&50, &1000);
    let events = contract_events(&env);

    // Verify the contract state matches what the event reported.
    let (min, max) = client.get_fee_bounds();
    assert_eq!(min, 50u32);
    assert_eq!(max, 1000u32);

    let (_, _, data) = events.get(events.len() - 1).unwrap();
    let (ev_min, ev_max): (u32, u32) = data.try_into_val(&env).unwrap();
    assert_eq!(ev_min, min);
    assert_eq!(ev_max, max);
}

#[test]
fn test_fee_bounds_set_event_on_zero_min() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_fee_bounds(&0, &10_000);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (min_bps, max_bps): (u32, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "fee_bounds_set"));
    assert_eq!(min_bps, 0u32);
    assert_eq!(max_bps, 10_000u32);
}

/// reset emits a merchant_revenue_reset event.
#[test]
fn test_reset_merchant_revenue_emits_event() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

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
    env.ledger().with_mut(|l| l.timestamp += interval + 1);
    client.charge(&user);

    client.reset_merchant_revenue(&merchant);

    let all_events = contract_events(&env);
    let last_event = all_events.get(all_events.len() - 1).unwrap();
    let (_, topics, _) = last_event;
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "merchant_revenue_reset"));
}

/// prune emits a merchant_revenue_pruned event with the correct removed_days count.
#[test]
fn test_prune_merchant_revenue_days_emits_event() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

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
    env.ledger().with_mut(|l| l.timestamp += interval + 1);
    client.charge(&user);
    let day = env.ledger().timestamp() / 86400;

    let days_to_prune = soroban_sdk::vec![&env, day];
    client.prune_merchant_revenue_days(&merchant, &days_to_prune);

    let all_events = contract_events(&env);
    let last_event = all_events.get(all_events.len() - 1).unwrap();
    let (_, topics, data) = last_event;
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "merchant_revenue_pruned"));

    let payload: crate::events::MerchantRevenuePrunedEventData = data.try_into_val(&env).unwrap();
    assert_eq!(payload.removed_days, 1u32);
}

// ─────────────────────────────────────────────────────────────
// Issue #1215: reset is a full clear (total, buckets, index, history)
// ─────────────────────────────────────────────────────────────

/// After a reset, every revenue reader reports the same cleared state:
/// cumulative total, summary, single-day read, day page and history.
#[test]
fn test_reset_merchant_revenue_full_clear_consistency() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

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

    env.ledger().with_mut(|l| l.timestamp += interval + 1);
    client.charge(&user);
    let day = env.ledger().timestamp() / 86400;

    // Pre-reset the merchant has a live total, history and day bucket.
    assert!(client.get_merchant_revenue(&merchant) > 0);
    let (total_before, count_before, _, _) = client.get_merchant_revenue_summary(&merchant);
    assert!(total_before > 0 && count_before > 0);
    assert!(client.get_merchant_revenue_day(&merchant, &day) > 0);

    client.reset_merchant_revenue(&merchant);

    // Every reader now agrees on a cleared state.
    assert_eq!(client.get_merchant_revenue(&merchant), 0);
    assert_eq!(client.get_merchant_revenue_summary(&merchant), (0, 0, 0, 0));
    assert_eq!(client.get_merchant_revenue_day(&merchant, &day), 0);
    assert!(client
        .get_merchant_revenue_day_page(&merchant, &0u32, &30u32)
        .is_empty());
    assert!(client
        .get_merchant_revenue_history(&merchant, &10u32)
        .is_empty());
}

// ─────────────────────────────────────────────────────────────
// Issue #1212: prune_merchant_revenue_days input cap and index walk
// ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_prune_merchant_revenue_days_over_cap_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let mut days: Vec<u64> = Vec::new(&env);
    for d in 0..(caps::MAX_PRUNE_REVENUE_DAYS as u64 + 1) {
        days.push_back(d);
    }
    client.prune_merchant_revenue_days(&merchant, &days);
}

#[test]
fn test_prune_merchant_revenue_days_at_cap_unsorted_compacts_index() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Index holds days 0..90; every day has a bucket.
    env.as_contract(&contract_id, || {
        let mut index: Vec<u64> = Vec::new(&env);
        for d in 0..90u64 {
            index.push_back(d);
            env.storage()
                .persistent()
                .set(&DataKey::MerchantRevenueDay(merchant.clone(), d), &1i128);
        }
        env.storage()
            .persistent()
            .set(&DataKey::MerchantRevenueDayIndex(merchant.clone()), &index);
    });

    // Exactly the cap, in descending order: prune every odd day plus
    // days that are not in the index at all.
    let mut days: Vec<u64> = Vec::new(&env);
    for d in (0..90u64).rev().filter(|d| d % 2 == 1) {
        days.push_back(d);
    }
    for d in 1000..(1000 + caps::MAX_PRUNE_REVENUE_DAYS as u64 - days.len() as u64) {
        days.push_back(d);
    }
    assert_eq!(days.len(), caps::MAX_PRUNE_REVENUE_DAYS);
    client.prune_merchant_revenue_days(&merchant, &days);

    let index: Vec<u64> = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get(&DataKey::MerchantRevenueDayIndex(merchant.clone()))
            .unwrap()
    });
    assert_eq!(index.len(), 45);
    for (i, d) in index.iter().enumerate() {
        assert_eq!(d, 2 * i as u64);
    }
    assert_eq!(client.get_merchant_revenue_day(&merchant, &1), 0);
    assert_eq!(client.get_merchant_revenue_day(&merchant, &2), 1);
}

#[test]
fn test_merchant_revenue_history_trims_oldest_at_cap() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let cap = merchant_stats::MAX_REVENUE_HISTORY;

    // Fill exactly to the cap: nothing is trimmed yet.
    let amounts: std::vec::Vec<i128> = (1..=cap as i128).collect();
    record_merchant_revenue(&env, &contract_id, &merchant, &amounts);
    let history = client.get_merchant_revenue_history(&merchant, &(cap + 10));
    assert_eq!(history.len(), cap);
    assert_eq!(history.get(0).unwrap(), 1);

    // One more append drops the oldest entry.
    record_merchant_revenue(&env, &contract_id, &merchant, &[cap as i128 + 1]);
    let history = client.get_merchant_revenue_history(&merchant, &(cap + 10));
    assert_eq!(history.len(), cap);
    assert_eq!(history.get(0).unwrap(), 2);
    assert_eq!(history.get(cap - 1).unwrap(), cap as i128 + 1);

    // A smaller window returns only the newest entries.
    let window = client.get_merchant_revenue_history(&merchant, &3);
    assert_eq!(
        window,
        soroban_sdk::vec![&env, cap as i128 - 1, cap as i128, cap as i128 + 1]
    );
}

#[test]
fn test_merchant_revenue_summary_min_max_after_trim() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let cap = merchant_stats::MAX_REVENUE_HISTORY;

    // The extreme values are the oldest entries, then the cap is filled with 50s.
    let mut amounts: std::vec::Vec<i128> = std::vec![1, 1_000];
    amounts.extend(core::iter::repeat(50).take(cap as usize));
    record_merchant_revenue(&env, &contract_id, &merchant, &amounts);

    let total: i128 = amounts.iter().sum();
    // Total stays all-time; count/min/max cover only the retained window.
    assert_eq!(
        client.get_merchant_revenue_summary(&merchant),
        (total, cap as i128, 50, 50)
    );
}

// ─────────────────────────────────────────────────────────────
// Issue #1426: merchant-initiated refund of the last charge (no cancel)
// ─────────────────────────────────────────────────────────────

#[test]
fn test_refund_last_charge_reverses_revenue_and_fee_without_cancelling() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &500);
    client.commit_fee(); // 5%

    sac.mint(&merchant, &10_000_0000000);
    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );

    let user_before = token.balance(&user);
    let merchant_before = token.balance(&merchant);

    env.ledger().with_mut(|l| {
        l.timestamp = 3600;
    });
    client.charge(&user);

    let fee: i128 = 5_000_000;
    let net: i128 = 95_000_000;
    assert_eq!(client.get_merchant_revenue(&merchant), net);
    assert_eq!(client.get_total_protocol_fees(), fee);
    assert_eq!(token.balance(&user), user_before - 100_000_000);

    client.refund_last_charge(&user, &merchant);

    assert_eq!(token.balance(&user), user_before);
    // The merchant funded the full gross refund; its wallet is down only the
    // protocol fee it never received.
    assert_eq!(token.balance(&merchant), merchant_before - fee);
    assert_eq!(client.get_merchant_revenue(&merchant), 0);
    assert_eq!(client.get_total_protocol_fees(), 0);
    assert!(client.get_subscription(&user).unwrap().active);
}
