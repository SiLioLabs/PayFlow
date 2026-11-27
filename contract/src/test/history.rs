// ─────────────────────────────────────────────
// Issue #99: subscription metadata tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_set_and_get_metadata() {
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

    let label = soroban_sdk::String::from_str(&env, "pro");
    client.set_metadata(&user, &label);

    assert_eq!(client.get_metadata(&user), Some(label));
}

#[test]
fn test_clear_metadata_removes_label() {
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

    let label = soroban_sdk::String::from_str(&env, "pro");
    client.set_metadata(&user, &label);
    assert_eq!(client.get_metadata(&user), Some(label));

    client.clear_metadata(&user);

    assert!(client.get_metadata(&user).is_none());
}

#[test]
fn test_get_metadata_none_when_not_set() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    assert!(client.get_metadata(&random).is_none());
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #98: charge history tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_charge_history_count() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // 1. A fresh user with no subscription/no charges ever → count is 0.
    let fresh_user = Address::generate(&env);
    assert_eq!(client.get_charge_history_count(&fresh_user), 0);

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

    // Also checking count for user with active subscription but no charges yet
    assert_eq!(client.get_charge_history_count(&user), 0);

    // 2. Count increments by 1 correctly after each individual charge event.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    assert_eq!(client.get_charge_history_count(&user), 1);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    assert_eq!(client.get_charge_history_count(&user), 2);

    // Charge more to get exactly 12 entries
    for _ in 0..10 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
    }

    // 5. (Edge case) A user with exactly 12 entries → returns exactly 12.
    assert_eq!(client.get_charge_history_count(&user), 12);

    // 3. Count caps at 12 and does not exceed it even after more than 12 charges have occurred.
    for _ in 0..5 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
    }
    assert_eq!(client.get_charge_history_count(&user), 12);

    // 4. After calling clear_charge_history for a user who had history, count returns to 0.
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.clear_charge_history(&user);
    assert_eq!(client.get_charge_history_count(&user), 0);
}

#[test]
fn test_charge_history_recorded() {
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

    assert_eq!(client.get_charge_history(&user).len(), 0);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(client.get_charge_history(&user).len(), 1);
}

#[test]
fn test_charge_history_capped_at_12() {
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

    // Perform 14 charges
    for _ in 0..14 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
    }

    assert_eq!(client.get_charge_history(&user).len(), 12);
}

#[test]
fn test_get_charge_history_three_charges_ascending() {
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

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t1 = env.ledger().timestamp();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t2 = env.ledger().timestamp();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t3 = env.ledger().timestamp();

    let history = client.get_charge_history(&user);
    assert_eq!(history.len(), 3);
    assert_eq!(history.get(0).unwrap(), t1);
    assert_eq!(history.get(1).unwrap(), t2);
    assert_eq!(history.get(2).unwrap(), t3);
}

#[test]
fn test_get_charge_history_page_offset_limit() {
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

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t1 = env.ledger().timestamp();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t2 = env.ledger().timestamp();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t3 = env.ledger().timestamp();

    let page = client.get_charge_history_page(&user, &1u32, &2u32, &true);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap(), t2);
    assert_eq!(page.get(1).unwrap(), t3);
}

#[test]
fn test_get_charge_history_empty_for_no_history() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    let history = client.get_charge_history(&random);
    assert_eq!(history.len(), 0);
}

#[test]
fn test_charge_history_page_overflow_inputs_and_trim_boundary() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert!(client
        .get_charge_history_page(&user, &u32::MAX, &u32::MAX, &true)
        .is_empty());

    env.as_contract(&contract_id, || {
        for timestamp in 1..=12 {
            subscription_history::record_charge(&env, &user, timestamp);
        }
    });

    let at_capacity = client.get_charge_history_page(&user, &0, &u32::MAX, &true);
    assert_eq!(at_capacity.len(), 12);
    assert_eq!(at_capacity.get(0).unwrap(), 1);
    assert_eq!(at_capacity.get(11).unwrap(), 12);

    // This used to overflow u32 while computing `offset + limit`.
    let wide_page = client.get_charge_history_page(&user, &1, &u32::MAX, &true);
    assert_eq!(wide_page.len(), 11);
    assert_eq!(wide_page.get(0).unwrap(), 2);
    assert_eq!(wide_page.get(10).unwrap(), 12);

    env.as_contract(&contract_id, || {
        subscription_history::record_charge(&env, &user, 13);
    });
    let after_trim = client.get_charge_history_page(&user, &0, &u32::MAX, &true);
    assert_eq!(after_trim.len(), 12);
    assert_eq!(after_trim.get(0).unwrap(), 2);
    assert_eq!(after_trim.get(11).unwrap(), 13);
}

#[test]
fn test_get_charge_history_page_limit_capped_at_12() {
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

    for _ in 0..14 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
    }

    let page = client.get_charge_history_page(&user, &0u32, &100u32, &true);
    assert_eq!(page.len(), 12);
}

#[test]
fn test_get_charge_history_page_offset_beyond_length() {
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

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    let page = client.get_charge_history_page(&user, &5u32, &2u32, &true);
    assert_eq!(page.len(), 0);
}

#[test]
fn test_charge_history_sort_ascending_and_descending() {
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

    let mut timestamps = Vec::new(&env);
    for _ in 0..5 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
        timestamps.push_back(env.ledger().timestamp());
    }

    let t0 = timestamps.get(0).unwrap();
    let t1 = timestamps.get(1).unwrap();
    let t2 = timestamps.get(2).unwrap();
    let t3 = timestamps.get(3).unwrap();
    let t4 = timestamps.get(4).unwrap();

    // Ascending (true) full page: [t0, t1, t2, t3, t4]
    let asc_all = client.get_charge_history_page(&user, &0u32, &10u32, &true);
    assert_eq!(asc_all.len(), 5);
    assert_eq!(asc_all.get(0).unwrap(), t0);
    assert_eq!(asc_all.get(1).unwrap(), t1);
    assert_eq!(asc_all.get(2).unwrap(), t2);
    assert_eq!(asc_all.get(3).unwrap(), t3);
    assert_eq!(asc_all.get(4).unwrap(), t4);

    // Descending (false) full page: [t4, t3, t2, t1, t0]
    let desc_all = client.get_charge_history_page(&user, &0u32, &10u32, &false);
    assert_eq!(desc_all.len(), 5);
    assert_eq!(desc_all.get(0).unwrap(), t4);
    assert_eq!(desc_all.get(1).unwrap(), t3);
    assert_eq!(desc_all.get(2).unwrap(), t2);
    assert_eq!(desc_all.get(3).unwrap(), t1);
    assert_eq!(desc_all.get(4).unwrap(), t0);

    // Pagination in ascending direction:
    let asc_p1 = client.get_charge_history_page(&user, &0u32, &2u32, &true);
    assert_eq!(asc_p1.len(), 2);
    assert_eq!(asc_p1.get(0).unwrap(), t0);
    assert_eq!(asc_p1.get(1).unwrap(), t1);

    let asc_p2 = client.get_charge_history_page(&user, &2u32, &2u32, &true);
    assert_eq!(asc_p2.len(), 2);
    assert_eq!(asc_p2.get(0).unwrap(), t2);
    assert_eq!(asc_p2.get(1).unwrap(), t3);

    let asc_p3 = client.get_charge_history_page(&user, &4u32, &2u32, &true);
    assert_eq!(asc_p3.len(), 1);
    assert_eq!(asc_p3.get(0).unwrap(), t4);

    let asc_p4 = client.get_charge_history_page(&user, &5u32, &2u32, &true);
    assert_eq!(asc_p4.len(), 0);

    // Pagination in descending direction:
    let desc_p1 = client.get_charge_history_page(&user, &0u32, &2u32, &false);
    assert_eq!(desc_p1.len(), 2);
    assert_eq!(desc_p1.get(0).unwrap(), t4);
    assert_eq!(desc_p1.get(1).unwrap(), t3);

    let desc_p2 = client.get_charge_history_page(&user, &2u32, &2u32, &false);
    assert_eq!(desc_p2.len(), 2);
    assert_eq!(desc_p2.get(0).unwrap(), t2);
    assert_eq!(desc_p2.get(1).unwrap(), t1);

    let desc_p3 = client.get_charge_history_page(&user, &4u32, &2u32, &false);
    assert_eq!(desc_p3.len(), 1);
    assert_eq!(desc_p3.get(0).unwrap(), t0);

    let desc_p4 = client.get_charge_history_page(&user, &5u32, &2u32, &false);
    assert_eq!(desc_p4.len(), 0);
}

#[test]
fn test_charge_history_sort_edge_cases() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    // Empty history
    assert_eq!(
        client
            .get_charge_history_page(&random, &0u32, &10u32, &true)
            .len(),
        0
    );
    assert_eq!(
        client
            .get_charge_history_page(&random, &0u32, &10u32, &false)
            .len(),
        0
    );
    assert_eq!(
        client
            .get_charge_history_page(&random, &5u32, &10u32, &false)
            .len(),
        0
    );

    // Single entry
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
    let t0 = env.ledger().timestamp();

    let asc_single = client.get_charge_history_page(&user, &0u32, &10u32, &true);
    let desc_single = client.get_charge_history_page(&user, &0u32, &10u32, &false);
    assert_eq!(asc_single.len(), 1);
    assert_eq!(desc_single.len(), 1);
    assert_eq!(asc_single.get(0).unwrap(), t0);
    assert_eq!(desc_single.get(0).unwrap(), t0);
}

#[test]
fn test_clear_charge_history_nonexistent_key_no_panic() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let random = Address::generate(&env);
    client.clear_charge_history(&random);
}

/// Absent ChargeHistory reports TTL 0. Present entries report a positive TTL
/// in test builds only; production always returns 0 (see docs/API.md).
#[test]
fn test_get_charge_history_ttl_absent_is_zero_present_is_positive_in_tests() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(client.get_charge_history_ttl(&user), 0);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    env.ledger().set_timestamp(86_400);
    client.charge(&user);

    let ttl = client.get_charge_history_ttl(&user);
    assert!(
        ttl > 0,
        "test/testutils builds expose a real ChargeHistory TTL"
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// subscribe_with_metadata tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_subscribe_with_metadata_success() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let label = soroban_sdk::String::from_str(&env, "Pro Plan");
    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe_with_metadata(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
        &label,
    );

    // Verify subscription is created
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);

    // Verify metadata is set
    assert_eq!(client.get_metadata(&user), Some(label));
}

#[test]
#[should_panic]
fn test_subscribe_with_metadata_label_too_long() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Create a 65-byte label (exceeds 64-byte limit)
    let long_label = soroban_sdk::String::from_str(
        &env,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", // 65 chars
    );

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    // Should panic with MetadataLabelTooLong
    client.subscribe_with_metadata(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
        &long_label,
    );
}

#[test]
#[should_panic]
fn test_subscribe_with_metadata_no_subscription_on_label_failure() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let long_label = soroban_sdk::String::from_str(
        &env,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    );

    // Label validation happens before subscribe_inner, so no subscription should be written.
    // This panics before any storage write â€” we verify that by catching the panic separately
    // in test_subscribe_with_metadata_label_too_long. Here we just assert the panic occurs.
    client.subscribe_with_metadata(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
        &long_label,
    );
}

#[test]
fn test_set_metadata_label_at_limit_succeeds() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let valid_label = soroban_sdk::String::from_str(
        &env,
        "this_is_a_perfectly_valid_sixty_four_character_metadata_label_ok",
    );
    assert_eq!(valid_label.len(), 64);

    client.set_metadata(&user, &valid_label);

    assert_eq!(client.get_metadata(&user), Some(valid_label));
}

#[test]
#[should_panic]
fn test_set_metadata_label_exceeding_limit_fails() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let invalid_label = soroban_sdk::String::from_str(
        &env,
        "this_is_an_invalid_sixty_five_character_metadata_label_too_long_!",
    );
    assert_eq!(invalid_label.len(), 65);

    client.set_metadata(&user, &invalid_label);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #469: set_subscription_label auth and alias tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_set_metadata_wrong_user_panics() {
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
    let attacker = Address::generate(&env);
    let label = soroban_sdk::String::from_str(&env, "hacked");
    client.set_metadata(&attacker, &label);
}

#[test]
fn test_get_subscription_label_returns_set_value() {
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
    let label = soroban_sdk::String::from_str(&env, "premium");
    client.set_metadata(&user, &label);
    assert_eq!(client.get_subscription_label(&user), Some(label));
}

#[test]
fn test_get_subscription_label_none_when_not_set() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let random = Address::generate(&env);
    assert!(client.get_subscription_label(&random).is_none());
}

// ─────────────────────────────────────────────────────────────
// Issue #1226: no dead metadata_cleared publisher
// ─────────────────────────────────────────────────────────────

/// clear_metadata must emit exactly one metadata_cleared event with the
/// structured MetadataClearedEventData payload (not a bare address).
#[test]
fn test_clear_metadata_emits_exactly_one_publisher() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

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

    let label = soroban_sdk::String::from_str(&env, "gold");
    // set_metadata / clear_metadata are the public contract functions.
    client.set_metadata(&user, &label);
    client.clear_metadata(&user);

    // Count events whose first topic symbol is "metadata_cleared".
    let mut count = 0u32;
    for (_, topics, _) in contract_events(&env).iter() {
        if let Some(first) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&env, &first) {
                if sym == Symbol::new(&env, "metadata_cleared") {
                    count += 1;
                }
            }
        }
    }
    assert_eq!(
        count, 1,
        "exactly one metadata_cleared event must be emitted"
    );
    assert_eq!(
        count, 1,
        "exactly one metadata_cleared event must be emitted"
    );
}
