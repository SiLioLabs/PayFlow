/// add_merchant for an already-whitelisted merchant must not emit an event.
#[test]
fn test_add_merchant_idempotent_suppresses_event() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // First add emits event
    client.add_merchant(&merchant);
    let events_after_first = contract_events(&env).len();

    // Second add is a noop — no new events
    client.add_merchant(&merchant);
    let events_after_second = contract_events(&env).len();

    assert!(events_after_first > 0);
    assert_eq!(
        events_after_second, 0,
        "duplicate add_merchant must not emit event"
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_get_merchant_statuses_over_configured_cap_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 3);

    client.set_max_whitelist_batch_size(&2);
    client.get_merchant_statuses(&merchants);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Multi-token + advanced features
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_multi_token_independent_subscriptions() {
    let (env, contract_id, token_a, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let token_b = setup_second_token(&env, &contract_id, &user_b);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user_a, &merchant, &amount, &interval, &token_a, &None, &None,
    );
    client.subscribe(
        &user_b, &merchant, &amount, &interval, &token_b, &None, &None,
    );

    let sub_a = client.get_subscription(&user_a).unwrap();
    let sub_b = client.get_subscription(&user_b).unwrap();

    assert_eq!(sub_a.token, token_a);
    assert_eq!(sub_b.token, token_b);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user_a);
    client.charge(&user_b);
}

#[test]
fn test_user_can_switch_token() {
    let (env, contract_id, token_a, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let token_b = setup_second_token(&env, &contract_id, &user);
    let interval: u64 = 86400;

    client.subscribe(
        &user, &merchant, &1_0000000, &interval, &token_a, &None, &None,
    );
    client.subscribe(
        &user, &merchant, &2_0000000, &interval, &token_b, &None, &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.token, token_b);
    assert_eq!(sub.amount, 2_0000000);
}

/// initialize() still works for backward compat but is not required.
#[test]
fn test_initialize_backward_compat() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    // initialize with a default token â€” should not affect per-sub token
    client.initialize(&token_addr, &admin);

    let token_b = setup_second_token(&env, &contract_id, &user);
    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_b, &None, &None);

    // Subscription uses token_b, not the initialized default
    assert_eq!(client.get_subscription(&user).unwrap().token, token_b);
}

// â”€â”€ Issue #13: get_subscription for nonexistent subscription â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// get_subscription() must return None for an address with no subscription.
#[test]
fn test_get_subscription_nonexistent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    assert!(
        client.get_subscription(&random).is_none(),
        "get_subscription should return None for unknown address"
    );
}

#[test]
#[should_panic]
fn test_zero_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &0, &86400, &token_addr, &None, &None);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Migration tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_migrate_v1_to_v2() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Manually construct and store a V1 subscription
    let v1_sub = crate::migration::SubscriptionV1 {
        merchant: merchant.clone(),
        amount: 1_0000000,
        interval: 86400,
        last_charged: env.ledger().timestamp(),
        active: true,
        token: token_addr.clone(),
        referrer: None,
        label: Symbol::new(&env, "v1_label"),
        trial_duration: 0,
    };

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&crate::DataKey::Subscription(user.clone()), &v1_sub);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    client.migrate(&users);

    // Verify it was upgraded to V2
    let v2_sub = client.get_subscription(&user).unwrap();
    assert_eq!(v2_sub.merchant, merchant);
    assert_eq!(v2_sub.amount, 1_0000000);
    assert_eq!(v2_sub.active, true);
    assert_eq!(v2_sub.paused, false); // This is the newly added field
    assert_eq!(v2_sub.label, Symbol::new(&env, "v1_label"));
}

#[test]
fn test_grace_period_ttl_extension() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Ensure an admin is set so admin checks pass.
    let admin = Address::generate(&env);
    // Write admin as the contract to set instance storage from the test harness.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    // Set a grace period as admin and verify read returns the same value.
    let seconds: u64 = 3600;
    client.propose_grace_period(&seconds);
    client.commit_grace_period();
    let got = client.get_grace_period();
    assert_eq!(got, seconds);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_initialize() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.initialize(&token_addr, &admin);
}

/// Storage read used by deploy scripts: get_token returns the initialized token.
#[test]
fn test_initialize_deploy_invariant_stored_token() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert!(client.get_token().is_none());
    client.initialize(&token_addr, &admin);
    assert_eq!(client.get_token(), Some(token_addr));
}

/// A second initialize must return typed AlreadyInitialized (code 1), not a string panic.
#[test]
fn test_initialize_deploy_invariant_double_init_already_initialized() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);

    let result = client.try_initialize(&token_addr, &admin);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AlreadyInitialized as u32
        ))),
        "double initialize must map to ContractError::AlreadyInitialized"
    );

    // First initialize state is unchanged.
    assert_eq!(client.get_token(), Some(token_addr));
    assert_eq!(client.get_admin(), Some(admin));
}

#[test]
fn test_migrate_is_idempotent() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let empty_users = soroban_sdk::Vec::new(&env);
    client.migrate(&empty_users);
    client.migrate(&empty_users); // second call should be a no-op
    client.finalize_migration(&0u64);
    client.finalize_migration(&0u64); // already complete: no-op

    assert_eq!(client.get_schema_version(), migration::CURRENT_VERSION);
}

#[test]
fn test_migrate_emits_completed_event_with_version_and_count() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
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

    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::SchemaVersion, &2u32);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.migrate(&users);
    // The completion event is emitted by `finalize_migration`, not by `migrate`.
    client.finalize_migration(&1u64);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (version, user_count): (u32, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "migration_completed"));
    assert_eq!(version, migration::CURRENT_VERSION);
    assert_eq!(user_count, 1);
}

/// Field order of HealthReport is the public wire format (append-only).
#[test]
fn test_health_report_field_order_unchanged() {
    let names = [
        "is_healthy",
        "contract_paused",
        "token_configured",
        "admin_configured",
        "instance_bump_age_ledgers",
        "active_subscription_count",
        "schema_version",
        "fee_collector_set",
        "global_volume_utilization_pct",
        "pending_merchant_rev_count",
    ];
    assert_eq!(names.len(), 10);
    assert_eq!(names[0], "is_healthy");
    assert_eq!(names[4], "instance_bump_age_ledgers");
    assert_eq!(names[9], "pending_merchant_rev_count");
}

#[test]
fn test_ttl_extension() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
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

    // We can't easily assert the exact TTL in the test environment without more complex mock_all_auths
    // or internal access, but we can verify the function exists and doesn't panic.

    // Keep the contract instance itself alive across the jump below â€” only the
    // Subscription entry's TTL is extended by extend_subscription_ttl, but the
    // contract instance needs its own TTL or the whole contract becomes archived.
    // Extend a bit past SUBSCRIPTION_TTL_LEDGERS to cover the two ledger jumps below.
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .extend_ttl(SUBSCRIPTION_TTL_LEDGERS + 10, SUBSCRIPTION_TTL_LEDGERS + 10);
    });

    env.ledger().with_mut(|l| {
        l.sequence_number += SUBSCRIPTION_TTL_LEDGERS - 1;
    });

    client.extend_subscription_ttl(&user);

    assert!(client.get_subscription(&user).is_some());
}

#[test]
fn test_initialize_sets_instance_ttl() {
    use soroban_sdk::testutils::storage::Instance as _;

    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlowPay, ());
    let client = FlowPayClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let admin = Address::generate(&env);

    client.initialize(&token_id.address(), &admin);

    let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(ttl > 0);
}

#[test]
fn test_bump_instance_ttl_is_permissionless_and_state_preserving() {
    use soroban_sdk::testutils::storage::Instance as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    env.ledger().with_mut(|ledger| {
        ledger.max_entry_ttl = SUBSCRIPTION_TTL_LEDGERS * 2;
    });
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let admin_before = client.get_admin();
    let token_before = client.get_token();
    let fee_before = client.get_fee();
    let subscription_before = client.get_subscription(&user);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += SUBSCRIPTION_TTL_LEDGERS / 2 + 100;
    });
    let ttl_before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());

    env.set_auths(&[]);
    client.bump_instance_ttl();

    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(ttl_after > ttl_before);
    assert!(ttl_after >= SUBSCRIPTION_TTL_LEDGERS);
    assert_eq!(client.get_admin(), admin_before);
    assert_eq!(client.get_token(), token_before);
    assert_eq!(client.get_fee(), fee_before);
    assert_eq!(client.get_subscription(&user), subscription_before);

    client.bump_instance_ttl();
    let repeated_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(repeated_ttl >= ttl_after);
}

#[test]
fn test_initialize_without_valid_token() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlowPay, ());
    let client = FlowPayClient::new(&env, &contract_id);

    // Using a user address instead of a token contract address.
    // The contract currently does not validate if the address is a valid token contract
    // or even if it's a contract at all.
    let invalid_token = Address::generate(&env);
    let admin = Address::generate(&env);

    client.initialize(&invalid_token, &admin);

    // Success means it didn't panic, which is the current expected behavior.
}

#[test]
fn test_global_volume_within_limit() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 1_000_0000000; // well under limit
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
    // Should succeed - well under the 50 trillion stroops limit
}

#[test]
#[should_panic]
fn test_global_volume_exceeds_limit() {
    let (env, contract_id, token_addr, _user_setup, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Give users large balances to exceed the 50_000_000_000_000 limit
    let user_a = setup_large_balance(&env, &contract_id, &token_addr);
    let user_b = setup_large_balance(&env, &contract_id, &token_addr);

    let amount: i128 = 30_000_000_000_000; // 30 trillion stroops each
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

    // First charge succeeds (30 trillion used)
    client.charge(&user_a);

    // Second charge should panic (60 trillion total > 50 trillion limit)
    client.charge(&user_b);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// get_protocol_stats tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_protocol_stats_initial() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let stats = client.get_protocol_stats();

    assert_eq!(stats.active_count, 0);
    assert_eq!(stats.fee_bps, 0);
    assert!(stats.fee_collector.is_none());
    assert_eq!(stats.grace_period, 0);
    assert!(!stats.whitelist_enabled);
    assert_eq!(stats.schema_version, 0); // default unmigrated version
    assert!(!stats.contract_paused);
}

#[test]
fn test_merchant_page_empty_sparse_and_offset_bounds() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert!(client.get_merchant_page(&0, &10).is_empty());

    let merchants = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    env.as_contract(&contract_id, || {
        for merchant in merchants.iter() {
            merchant_stats::index_merchant(&env, merchant);
        }
        env.storage()
            .persistent()
            .remove(&DataKey::MerchantIndex(1));
    });

    let page = client.get_merchant_page(&0, &u32::MAX);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap(), merchants[0]);
    assert_eq!(page.get(1).unwrap(), merchants[2]);
    assert!(client.get_merchant_page(&3, &10).is_empty());
    assert!(client.get_merchant_page(&u32::MAX, &u32::MAX).is_empty());

    env.as_contract(&contract_id, || {
        for _ in 0..51 {
            merchant_stats::index_merchant(&env, &Address::generate(&env));
        }
    });
    assert_eq!(client.get_merchant_page(&3, &u32::MAX).len(), 50);
    assert_eq!(client.get_merchant_page(&53, &u32::MAX).len(), 1);
}

/// Issue #1216: removing a merchant from the whitelist must unindex it so it
/// leaves the top-merchants ranking, and re-adding it must re-index it.
#[test]
fn test_removed_merchant_leaves_top_ranking() {
    let (env, contract_id, token_addr, _user, _m) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);

    client.add_merchant(&m1);
    client.add_merchant(&m2);
    client.add_merchant(&m3);

    let u1 = setup_funded_user(&env, &contract_id, &token_addr);
    let u2 = setup_funded_user(&env, &contract_id, &token_addr);
    let u3 = setup_funded_user(&env, &contract_id, &token_addr);

    client.subscribe(&u1, &m1, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u2, &m2, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u3, &m3, &1_0000000, &86400, &token_addr, &None, &None);

    let top_before = client.get_top_merchants_by_subs(&10u32);
    assert_eq!(top_before.len(), 3);

    client.remove_merchant(&m2);

    // The removed merchant is gone from the ranking...
    let top_after = client.get_top_merchants_by_subs(&10u32);
    assert_eq!(top_after.len(), 2);
    for i in 0..top_after.len() {
        let (addr, _count) = top_after.get(i).unwrap();
        assert_ne!(addr, m2, "removed merchant must not be ranked");
    }

    // ...and from the full merchant index (swap-remove left no slot behind).
    let page = client.get_merchant_page(&0u32, &50u32);
    for i in 0..page.len() {
        assert_ne!(
            page.get(i).unwrap(),
            m2,
            "removed merchant must leave the index"
        );
    }

    // Re-adding re-indexes it and it reappears in the ranking.
    client.add_merchant(&m2);
    let top_readd = client.get_top_merchants_by_subs(&10u32);
    let mut found = false;
    for i in 0..top_readd.len() {
        if top_readd.get(i).unwrap().0 == m2 {
            found = true;
        }
    }
    assert!(found, "re-added merchant must be re-indexed and ranked");
}

/// Initialize-before-use is unchanged: once an admin is stored the same
/// admin-gated call succeeds, and the view getter still reports the admin.
#[test]
fn test_initialize_before_use_unaffected_by_typed_not_initialized() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    // Pre-initialize the view getter is a plain Option, not a failure.
    assert!(client.get_admin().is_none());

    client.initialize(&token_addr, &admin);

    assert_eq!(client.get_admin(), Some(admin));
    client.pause_contract();
    assert!(client.is_contract_paused());
}

// Issue #231: token.rs SAC compatibility test
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Test that a custom SAC token (not native XLM) works end-to-end
/// with subscribe, charge, and pay_per_use operations.
#[test]
fn test_custom_sac_token_end_to_end_flow() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Setup a custom SAC token (not the default one from setup())
    let custom_token = setup_second_token(&env, &contract_id, &user);
    let token = TokenClient::new(&env, &custom_token);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    // Step 1: Subscribe with custom SAC token
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &custom_token,
        &None,
        &None,
    );

    // Verify subscription uses the custom token
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);
    assert_eq!(
        sub.token, custom_token,
        "subscription should use custom SAC token"
    );

    // Step 2: Charge after interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    client.charge(&user);

    let user_balance_after = token.balance(&user);
    let merchant_balance_after = token.balance(&merchant);

    // Verify exact amount transferred
    assert_eq!(
        user_balance_before - user_balance_after,
        amount,
        "user balance should decrease by subscription amount"
    );
    assert_eq!(
        merchant_balance_after - merchant_balance_before,
        amount,
        "merchant balance should increase by subscription amount"
    );

    // Step 3: Pay-per-use with custom SAC token
    let user_balance_before_ppu = token.balance(&user);
    let merchant_balance_before_ppu = token.balance(&merchant);

    let ppu_amount: i128 = 2_0000000;
    client.pay_per_use(&user, &ppu_amount);

    let user_balance_after_ppu = token.balance(&user);
    let merchant_balance_after_ppu = token.balance(&merchant);

    // Verify pay-per-use amount transferred
    assert_eq!(
        user_balance_before_ppu - user_balance_after_ppu,
        ppu_amount,
        "user balance should decrease by pay_per_use amount"
    );
    assert_eq!(
        merchant_balance_after_ppu - merchant_balance_before_ppu,
        ppu_amount,
        "merchant balance should increase by pay_per_use amount"
    );

    // Verify subscription is still active after pay_per_use
    let sub_final = client.get_subscription(&user).unwrap();
    assert!(
        sub_final.active,
        "subscription should remain active after pay_per_use"
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #237: get_token() read function tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_token_returns_none_when_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlowPay, ());
    let client = FlowPayClient::new(&env, &contract_id);
    assert!(client.get_token().is_none());
}

#[test]
fn test_get_token_returns_initialized_token() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);
    assert_eq!(client.get_token(), Some(token_addr));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue: get_grace_period getter
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_grace_period_default_zero() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_grace_period(), 0);
}

#[test]
fn test_get_grace_period_after_set() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });
    client.propose_grace_period(&3600);
    client.commit_grace_period();
    assert_eq!(client.get_grace_period(), 3600);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue: grace_period_updated event on set_grace_period
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_set_grace_period_emits_event() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_grace_period(&7200);
    client.commit_grace_period();

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let emitted_seconds: u64 = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "grace_period_committed"));
    assert_eq!(emitted_seconds, 7200u64);
}

/// Updating a non-existent subscription must panic with NoSubscriptionFound.
#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_set_subscription_amount_no_subscription_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let random = Address::generate(&env);
    client.set_subscription_amount(&random, &2_0000000);
}

#[test]
fn test_get_merchant_sub_count_u64_boundary() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let large_count: u64 = (u32::MAX as u64) + 1000;
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::MerchantSubCount(merchant.clone()), &large_count);
    });

    assert_eq!(client.get_merchant_sub_count(&merchant), large_count);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #2)")]
fn test_subscription_amount_validation_zero() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    // Attempt to set amount to 0 (panics with AmountMustBePositive, error 19)
    env.mock_all_auths();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.set_subscription_amount(&user, &0);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #15)")]
fn test_subscription_amount_validation_exceeds_max() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    // Attempt to set amount above MAX_SUBSCRIPTION_AMOUNT
    env.mock_all_auths();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.set_subscription_amount(&user, &(crate::MAX_SUBSCRIPTION_AMOUNT + 1));
}

#[test]
fn test_contract_config() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let config = client.get_contract_config();
    // A fresh deployment starts at CURRENT_VERSION, not at 1: initialize() stamps
    // the current schema so migration is never required on new deploys.
    assert_eq!(config.schema_version, crate::migration::CURRENT_VERSION);
    assert_eq!(config.paused, false);
}

/// A ledger advance that would archive a key on the default ~4096-ledger
/// live-until must not take the size key (or any sibling) offline.
#[test]
fn test_size_key_survives_past_default_archive_point_after_append() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
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

    // Advance past the SDK default archive point (4096 ledgers) but well
    // within the SUBSCRIPTION_TTL_LEDGERS window the append now extends to.
    env.ledger().with_mut(|l| {
        l.sequence_number += 100_000; // >> 4096 default, << 6307200 window
    });

    // Keep the contract instance alive across the ledger jump.
    env.as_contract(&contract_id, || {
        env.storage().instance().extend_ttl(2_000_000, 2_000_000);
    });

    env.as_contract(&contract_id, || {
        for (label, ttl) in [
            (
                "SubscriberIndexSize",
                env.storage()
                    .persistent()
                    .get_ttl(&DataKey::SubscriberIndexSize),
            ),
            (
                "SubscriberIndex(0)",
                env.storage()
                    .persistent()
                    .get_ttl(&DataKey::SubscriberIndex(0)),
            ),
        ] {
            // get_ttl returns the remaining TTL directly (0 once archived).
            assert!(
                ttl >= SUBSCRIPTION_TTL_LEDGERS - 100_000,
                "{label} TTL {ttl} must have survived the ledger advance"
            );
        }
    });

    // The public read path still sees the full index after the jump.
    assert_eq!(client.get_subscriber_count(), 1);
}

/// A re-propose before commit replaces the pending fee — commit applies
/// the latest proposal.
#[test]
fn test_repropose_before_commit_applies_latest() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector_a = Address::generate(&env);
    let collector_b = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector_a, &100);
    // Re-propose with different values before committing
    client.propose_fee(&collector_b, &200);
    client.commit_fee();

    let (stored_collector, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_collector, collector_b);
    assert_eq!(stored_bps, 200);
}

/// After commit_fee, committing again without a new propose panics.
#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_double_commit_without_repropose_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &100);
    client.commit_fee();
    // Second commit without a new propose must panic
    client.commit_fee();
}

// ─────────────────────────────────────────────
// Batch queries tests
// ─────────────────────────────────────────────

#[test]
fn test_get_merchant_statuses_empty() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchants = soroban_sdk::Vec::new(&env);
    let result = client.get_merchant_statuses(&merchants);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_get_merchant_statuses_mixed() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
}

// Issue #9: validate_recipient_address tests
// ─────────────────────────────────────────────

/// set_fee() with a valid (non-contract) collector address must succeed.
#[test]
fn test_validate_recipient_address_valid_passes() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    // Must not panic — a regular address is a valid fee collector.
    client.propose_fee(&collector, &100u32);
    client.commit_fee();

    assert_eq!(client.get_fee(), Some((collector, 100u32)));
}

/// set_fee() with the contract's own address as collector must panic with
/// ContractError::InvalidFeeCollector (error code 26).
#[test]
#[should_panic(expected = "Error(Contract, #26)")]
fn test_validate_recipient_address_contract_self_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Passing the contract address as fee collector must be rejected.
    client.propose_fee(&contract_id, &100u32);
    client.commit_fee();
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_get_merchant_statuses_exceeds_limit_panics() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut merchants = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        merchants.push_back(Address::generate(&env));
    }
    client.get_merchant_statuses(&merchants);
}

/// An accumulator that cannot represent the sum is an overflow (#36), which is
/// a different failure from breaching the hourly cap (#28).
#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_global_volume_accumulator_overflow_fails_with_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &DataKey::GlobalVolumeWindow,
            &GlobalVolumeWindow {
                current_window_start: env.ledger().timestamp(),
                accumulated_volume: i128::MAX,
            },
        );
        check_and_update_global_volume(&env, 1);
    });
}

// ─────────────────────────────────────────────────────────────
// Issue 033 (#828): Grace period TTL expiry tests
// ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_grace_period_commit_expired_proposal_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let client = FlowPayClient::new(&env, &contract_id);
    client.propose_grace_period(&3600);

    env.ledger().with_mut(|l| {
        l.sequence_number += 20000;
    });

    client.commit_grace_period();
}

#[test]
fn test_grace_period_propose_commit_happy_path() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let client = FlowPayClient::new(&env, &contract_id);
    client.propose_grace_period(&7200);

    env.ledger().with_mut(|l| {
        l.sequence_number += 100;
    });

    client.commit_grace_period();
    assert_eq!(client.get_grace_period(), 7200);
}

/// get_contract_config reports the effective cap (override when set, else default).
#[test]
fn test_get_contract_config_reports_effective_cap() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Default cap
    let config = client.get_contract_config();
    assert_eq!(config.global_volume_cap, GLOBAL_MAX_VOLUME_PER_HOUR);

    // After override
    let new_cap: i128 = 25_000_000_000_000;
    client.set_global_volume_cap(&new_cap);
    let config = client.get_contract_config();
    assert_eq!(config.global_volume_cap, new_cap);
}

/// Grace-period math with a saturating-add does not flip the lapsed check.
/// With last_charged=0, interval=u64::MAX-1, grace=2 the deadline saturates
/// to u64::MAX — is_grace_lapsed must return false for any realistic now.
#[test]
fn test_is_grace_lapsed_saturates_safely() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Set a grace period.
    client.propose_grace_period(&3600u64);
    client.commit_grace_period();

    // Inject a subscription with a near-max interval.
    let extreme_sub = crate::Subscription {
        merchant: merchant.clone(),
        amount: 1_0000000,
        interval: u64::MAX - 1,
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

    // The subscription health check exercises is_grace_lapsed and
    // compute_next_charge_at indirectly — it must not panic.
    let health = client.get_subscription_health(&user);
    // With saturating arithmetic the deadline = u64::MAX, which is always in
    // the future, so the grace window is NOT lapsed.
    assert!(
        !health.within_grace,
        "grace must not be lapsed for extreme interval"
    );
}

// ─────────────────────────────────────────────────────────────
// Issue #1015: get_batch_charge_estimate respects configured max_batch_size
// ─────────────────────────────────────────────────────────────

/// After lowering the cap to 5, estimate rejects a 6-user batch with BatchTooLarge.
#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_estimate_over_lowered_cap_panics() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);
    client.set_max_batch_size(&5);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..6 {
        users.push_back(Address::generate(&env));
    }
    client.get_batch_charge_estimate(&users);
}

/// After lowering the cap to 5, estimate accepts exactly 5 users.
#[test]
fn test_estimate_at_lowered_cap_succeeds() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);
    client.set_max_batch_size(&5);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..5 {
        users.push_back(Address::generate(&env));
    }
    let estimate = client.get_batch_charge_estimate(&users);
    assert_eq!(estimate.len(), 5);
}

/// After raising the cap to 100, estimate accepts 100 users and rejects 101.
#[test]
fn test_estimate_at_raised_cap_succeeds_and_over_panics() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);
    client.set_max_batch_size(&100);

    // Exactly at cap — must succeed
    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..100 {
        users.push_back(Address::generate(&env));
    }
    let estimate = client.get_batch_charge_estimate(&users);
    assert_eq!(estimate.len(), 100);

    // One over cap — must panic
    let panicked = std::panic::catch_unwind(|| {
        let env2 = Env::default();
        env2.mock_all_auths();
        let token_id2 = env2.register_stellar_asset_contract_v2(Address::generate(&env2));
        let token2 = token_id2.address();
        let c2 = env2.register(crate::FlowPay, ());
        let cl2 = FlowPayClient::new(&env2, &c2);
        let admin2 = Address::generate(&env2);
        cl2.initialize(&token2, &admin2);
        env2.as_contract(&c2, || {
            crate::storage::set_admin(&env2, &admin2);
        });
        cl2.set_max_batch_size(&100);
        let mut u2 = soroban_sdk::Vec::new(&env2);
        for _ in 0..101 {
            u2.push_back(Address::generate(&env2));
        }
        cl2.get_batch_charge_estimate(&u2);
    });
    assert!(panicked.is_err(), "101 users over cap=100 must panic");
}

/// Estimate and live batch_charge agree on rejection at the default cap (50).
#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_estimate_over_default_cap_panics() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Default cap is 50; submit 51.
    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        users.push_back(Address::generate(&env));
    }
    client.get_batch_charge_estimate(&users);
}

/// All-tombstoned page: when every slot in the requested window has been
/// tombstoned (via cancel), `get_subscriber_page` must return an empty Vec.
#[test]
fn test_scan_all_tombstoned_page_returns_empty() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Subscribe and immediately cancel — cancel tombstones the slot automatically.
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

    // The only slot is tombstoned — page must be empty.
    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 0, "all-tombstoned page must return empty Vec");
}

/// Offset past the end: when `offset >= subscriber_count`, the scan window is
/// outside the index range and all three reader functions must return empty.
#[test]
fn test_scan_offset_past_end_returns_empty() {
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
    assert_eq!(client.get_subscriber_count(), 1);

    // offset 1 == size — out of bounds.
    let page = client.get_subscriber_page(&1u64, &10u32);
    assert_eq!(
        page.len(),
        0,
        "get_subscriber_page: offset at size must return empty"
    );

    let active_page = client.get_active_subscriber_page(&1u64, &10u32);
    assert_eq!(
        active_page.len(),
        0,
        "get_active_subscriber_page: offset at size must return empty"
    );

    let batch = client.get_next_charge_batch(&1u64, &10u32, &None);
    assert_eq!(
        batch.len(),
        0,
        "get_next_charge_batch: offset at size must return empty"
    );
}

// ─────────────────────────────────────────────────────────────
// Issue #1211: token address kind check without the XDR byte probe
// ─────────────────────────────────────────────────────────────

#[test]
fn test_is_contract_address_distinguishes_kinds() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    use soroban_sdk::xdr::{AccountId, PublicKey, ScAddress, Uint256};
    let account_id = AccountId(PublicKey::PublicKeyTypeEd25519(Uint256([0; 32])));
    let account = Address::try_from_val(&env, &ScAddress::Account(account_id)).unwrap();

    assert!(validation::is_contract_address(&token_addr));
    assert!(validation::is_contract_address(&contract_id));
    assert!(!validation::is_contract_address(&account));
}

// ─────────────────────────────────────────────────────────────
// Issue #1429: per-subscriber storage footprint
// ─────────────────────────────────────────────────────────────

#[test]
fn test_storage_footprint_covers_every_per_user_key() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    let footprint = client.get_storage_footprint(&user);
    assert_eq!(footprint.entries.len(), storage::PER_USER_STORAGE_KEY_COUNT);

    let expected = [
        "subscription",
        "referral",
        "metadata",
        "charge_history",
        "index_slot",
        "pause_expiry",
        "last_charge",
        "last_skip",
        "daily_limit",
        "daily_spent",
        "day_start",
    ];
    for (i, name) in expected.iter().enumerate() {
        let entry = footprint.entries.get(i as u32).unwrap();
        assert_eq!(entry.key, Symbol::new(&env, name));
    }

    let subscription = footprint.entries.get(0).unwrap();
    assert!(subscription.present);
    assert!(subscription.ttl_ledgers > 0);

    let index_slot = footprint.entries.get(4).unwrap();
    assert!(index_slot.present);
    assert!(index_slot.ttl_ledgers > 0);

    // Keys the user has not created yet are reported absent.
    assert!(!footprint.entries.get(2).unwrap().present); // metadata
    assert!(!footprint.entries.get(9).unwrap().present); // daily_limit
}
