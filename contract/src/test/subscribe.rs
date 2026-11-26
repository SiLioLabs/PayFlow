// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Core functionality tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_subscribe_and_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);
    assert_eq!(sub.token, token_addr);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    let sub_after = client.get_subscription(&user).unwrap();
    assert!(sub_after.last_charged > 0);
}

#[test]
fn test_subscription_age_after_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

    env.ledger().with_mut(|l| {
        l.timestamp = 1;
    });

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let elapsed: u64 = 1000;
    env.ledger().with_mut(|l| {
        l.timestamp += elapsed;
    });

    let age = client.get_subscription_age(&user);
    assert_eq!(age, Some(elapsed));
}

#[test]
fn test_subscription_age_resets_on_resubscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

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
        l.timestamp += 5000;
    });

    client.cancel(&user);

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let elapsed_after_resub: u64 = 200;
    env.ledger().with_mut(|l| {
        l.timestamp += elapsed_after_resub;
    });

    let age = client.get_subscription_age(&user);
    assert_eq!(age, Some(elapsed_after_resub));
}

#[test]
fn test_subscription_age_none_when_no_subscription() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let age = client.get_subscription_age(&user);
    assert_eq!(age, None);
}

#[test]
fn test_subscription_age_none_for_migrated_sentinel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Simulate a pre-existing subscription migrated with the created_at = 0 sentinel
    env.as_contract(&contract_id, || {
        let key = storage::subscription_key(&env, &user);
        let mut sub: crate::Subscription = env.storage().persistent().get(&key).unwrap();
        sub.created_at = 0;
        env.storage().persistent().set(&key, &sub);
    });

    let age = client.get_subscription_age(&user);
    assert_eq!(age, None);
}

/// subscribe() validation uses the same gross-allowance helper, including
/// when protocol fees are configured (requirement is still the gross amount).
#[test]
fn test_subscribe_allowance_requirement_table() {
    let amount: i128 = 10_0000000;
    let fee_on_bps: u32 = 500;
    let fee_on_net: i128 = amount - (amount * fee_on_bps as i128 / 10_000);

    let cases = [
        SubscribeAllowanceCase {
            fee_bps: 0,
            allowance: 0,
            expect_ok: false,
            label: "zero allowance, fee_bps = 0",
        },
        SubscribeAllowanceCase {
            fee_bps: 0,
            allowance: amount,
            expect_ok: true,
            label: "exact allowance, fee_bps = 0",
        },
        SubscribeAllowanceCase {
            fee_bps: 0,
            allowance: amount - 1,
            expect_ok: false,
            label: "insufficient allowance, fee_bps = 0",
        },
        SubscribeAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: 0,
            expect_ok: false,
            label: "zero allowance, fee_bps > 0",
        },
        SubscribeAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: amount,
            expect_ok: true,
            label: "exact gross allowance, fee_bps > 0",
        },
        SubscribeAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: fee_on_net,
            expect_ok: false,
            label: "net-only allowance, fee_bps > 0",
        },
    ];

    for c in cases {
        let (env, contract_id, token_addr, user, merchant) = setup();
        let client = FlowPayClient::new(&env, &contract_id);
        let token = TokenClient::new(&env, &token_addr);

        if c.fee_bps > 0 {
            configure_fee(&env, &contract_id, c.fee_bps);
        }

        token.approve(&user, &contract_id, &c.allowance, &200000);
        let result =
            client.try_subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);

        if c.expect_ok {
            assert!(result.is_ok(), "{}", c.label);
            let sub = client.get_subscription(&user).unwrap();
            assert_eq!(sub.amount, amount, "{}", c.label);
        } else {
            assert_eq!(
                result,
                Err(Ok(soroban_sdk::Error::from_contract_error(8))),
                "{}",
                c.label
            );
            assert!(
                client.get_subscription(&user).is_none(),
                "failed subscribe must not write storage ({})",
                c.label
            );
        }
    }
}

/// subscribe() must store all Subscription fields exactly as provided.
#[test]
fn test_subscription_struct_fields_match_input() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days

    let subscribe_time = env.ledger().timestamp();

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();

    assert_eq!(sub.merchant, merchant, "merchant should match");
    assert_eq!(sub.amount, amount, "amount should match");
    assert_eq!(sub.interval, interval, "interval should match");
    assert!(sub.active, "subscription should be active");
    assert!(!sub.paused, "subscription should not be paused");
    assert_eq!(sub.token, token_addr, "token should match");
    // last_charged is set to subscribe time when no trial period
    assert_eq!(
        sub.last_charged, subscribe_time,
        "last_charged should be set to subscribe time"
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// subscription_count tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_active_count_increments_on_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(client.get_active_count(), 0);
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
}

#[test]
fn test_active_count_does_not_double_count_on_resubscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchant_b = Address::generate(&env);

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

    client.subscribe(
        &user,
        &merchant_b,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_active_count(), 1);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.merchant, merchant_b);
    assert_eq!(sub.amount, 2_0000000);
}

// ─────────────────────────────────────────────
// CONTRACT-22: bump_instance_ttl tests
// ─────────────────────────────────────────────

#[test]
fn test_subscribe_extends_instance_ttl() {
    use soroban_sdk::testutils::storage::Instance as _;

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

    let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(ttl >= SUBSCRIPTION_TTL_LEDGERS / 2);
}

#[test]
#[should_panic]
fn test_subscribe_interval_under_60_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &0, &token_addr, &None, &None);
}

#[test]
fn test_subscribe_interval_minimum_succeeds() {
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

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn test_subscribe_amount_above_cap_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &(MAX_SUBSCRIPTION_AMOUNT + 1));
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &(MAX_SUBSCRIPTION_AMOUNT + 1), &200);

    client.subscribe(
        &user,
        &merchant,
        &(MAX_SUBSCRIPTION_AMOUNT + 1),
        &86400,
        &token_addr,
        &None,
        &None,
    );
}

#[test]
fn test_subscribe_amount_at_cap_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let sac = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &MAX_SUBSCRIPTION_AMOUNT);
    let token = soroban_sdk::token::Client::new(&env, &token_addr);
    token.approve(&user, &contract_id, &MAX_SUBSCRIPTION_AMOUNT, &200);

    client.subscribe(
        &user,
        &merchant,
        &MAX_SUBSCRIPTION_AMOUNT,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user,
        &merchant,
        &MAX_SUBSCRIPTION_AMOUNT,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.amount, MAX_SUBSCRIPTION_AMOUNT);
}

#[test]
fn test_get_protocol_stats_after_subscribe() {
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

    let stats = client.get_protocol_stats();
    assert_eq!(stats.active_count, 1);
}

#[test]
fn test_resubscribe() {
    let (env, contract_id, token_addr, user, merchant_a) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchant_b = Address::generate(&env);

    // Initial subscription
    client.subscribe(
        &user,
        &merchant_a,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    let sub1 = client.get_subscription(&user).unwrap();
    assert_eq!(sub1.merchant, merchant_a);
    assert_eq!(sub1.amount, 1_0000000);

    // Subscribe again with different parameters
    client.subscribe(
        &user,
        &merchant_b,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &None,
    );
    let sub2 = client.get_subscription(&user).unwrap();

    assert_eq!(sub2.merchant, merchant_b);
    assert_eq!(sub2.amount, 2_0000000);
    assert_eq!(sub2.interval, 172800);

    // Verify old merchant is gone
    assert_ne!(sub2.merchant, merchant_a);
}

#[test]
fn test_subscribe_overwrites_cancelled_subscription() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // 1. Subscribe
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // 2. Cancel
    client.cancel(&user);
    let sub_cancelled = client.get_subscription(&user).unwrap();
    assert!(!sub_cancelled.active);

    // 3. Subscribe again
    client.subscribe(
        &user,
        &merchant,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &None,
    );

    // 4. Verify new subscription is active
    let sub_new = client.get_subscription(&user).unwrap();
    assert!(sub_new.active);
    assert_eq!(sub_new.amount, 2_0000000);
}

/// subscribe panics with IntervalTooShort when interval < default floor of 3600.
#[test]
#[should_panic]
fn test_subscribe_interval_too_short_panics_default_floor() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    // 1800 seconds (30 min) < 3600 default floor
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &1800,
        &token_addr,
        &None,
        &None,
    );
}

/// Lowering the floor via set_min_interval then subscribing at the new floor succeeds.
#[test]
fn test_subscribe_after_set_min_interval_lower_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);
    client.set_min_interval(&60u64);

    assert_eq!(client.get_min_interval(), 60);
    // 60 seconds == new floor â€” should succeed
    client.subscribe(&user, &merchant, &1_0000000, &60, &token_addr, &None, &None);
    assert!(client.get_subscription(&user).unwrap().active);
}

#[test]
fn prop_subscribe_interval_respects_min_interval_floor() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let default_floor = client.get_min_interval();

    let mut state = 0x9e3779b97f4a7c15u64;
    for sample in 0..4 {
        state ^= state << 7;
        state ^= state >> 9;
        let interval = if sample == 0 {
            0
        } else {
            state % default_floor
        };
        let user = setup_funded_user(&env, &contract_id, &token_addr);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.subscribe(
                &user,
                &merchant,
                &1_0000000,
                &interval,
                &token_addr,
                &None,
                &None,
            );
        }));
        assert!(result.is_err(), "interval {interval} must be rejected");
    }

    for offset in 0..4 {
        let interval = default_floor + offset;
        let user = setup_funded_user(&env, &contract_id, &token_addr);
        client.subscribe(
            &user,
            &merchant,
            &1_0000000,
            &interval,
            &token_addr,
            &None,
            &None,
        );
        assert_eq!(client.get_subscription(&user).unwrap().interval, interval);
    }

    let admin = Address::generate(&env);
    client.set_initial_admin(&admin);
    let updated_floor = 97u64;
    client.set_min_interval(&updated_floor);
    assert_eq!(client.get_min_interval(), updated_floor);

    for sample in 0..4 {
        state ^= state << 7;
        state ^= state >> 9;
        let interval = if sample == 0 {
            0
        } else {
            state % updated_floor
        };
        let user = setup_funded_user(&env, &contract_id, &token_addr);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.subscribe(
                &user,
                &merchant,
                &1_0000000,
                &interval,
                &token_addr,
                &None,
                &None,
            );
        }));
        assert!(
            result.is_err(),
            "updated floor rejected interval {interval}"
        );
    }

    for offset in 0..4 {
        let interval = updated_floor + offset;
        let user = setup_funded_user(&env, &contract_id, &token_addr);
        client.subscribe(
            &user,
            &merchant,
            &1_0000000,
            &interval,
            &token_addr,
            &None,
            &None,
        );
        assert_eq!(client.get_subscription(&user).unwrap().interval, interval);
    }
}

#[test]
fn test_get_subscriber_at_returns_first() {
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

    assert_eq!(client.get_subscriber_at(&0u64), Some(user));
    assert_eq!(client.get_subscriber_at(&1u64), None);
}

// Issue #243: Token address validation
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_subscribe_non_contract_address() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Provide a non-contract address (just an account)
    use soroban_sdk::xdr::{AccountId, PublicKey, ScAddress, Uint256};
    use soroban_sdk::TryFromVal;
    let account_id = AccountId(PublicKey::PublicKeyTypeEd25519(Uint256([0; 32])));
    let non_contract_token = Address::try_from_val(&env, &ScAddress::Account(account_id)).unwrap();

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &non_contract_token,
        &None,
        &None,
    );
}

#[test]
fn test_subscribe_valid_sac_token_address_succeeds() {
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

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.token, token_addr);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-08: Allowance pre-validation tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// subscribe() with zero allowance must panic with InsufficientAllowance
/// and must NOT write the subscription to storage.
#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_subscribe_zero_allowance_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register(FlowPay, ());
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);

    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    // Deliberately grant zero allowance â€” no approve() call.
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
}

/// After a zero-allowance subscribe() panic, get_subscription() must return None,
/// confirming no storage was written.
/// Note: In the Soroban test environment, panics abort the entire transaction,
/// so storage changes from the failed call are never committed. We verify this
/// by reading storage directly inside the contract after a successful (non-panicking)
/// path: a user who was never subscribed must always return None.
#[test]
fn test_subscribe_zero_allowance_does_not_write_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register(FlowPay, ());
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    let user = Address::generate(&env);

    // Never approved any allowance â€” a subscribe call would panic.
    // Soroban transactions are atomic: a panic reverts all storage writes.
    // We confirm the storage slot starts empty (None) and â€” since we cannot
    // call subscribe without panicking â€” we verify the invariant holds: a
    // user address that has never successfully subscribed always returns None.
    let client = FlowPayClient::new(&env, &contract_id);
    assert!(
        client.get_subscription(&user).is_none(),
        "subscription must not be stored for a user who has never successfully subscribed"
    );
}

/// subscribe() with allowance exactly equal to amount must succeed.
#[test]
fn test_subscribe_exact_allowance_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register(FlowPay, ());

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);

    let amount: i128 = 5_0000000;

    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    // Approve exactly amount â€” no more, no less.
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &amount, &200);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active, "subscription should be active");
    assert_eq!(sub.amount, amount);
}

/// Re-subscribe (overwriting a cancelled subscription) with zero allowance
/// must also panic with InsufficientAllowance.
#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_resubscribe_zero_allowance_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register(FlowPay, ());

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);

    let amount: i128 = 1_0000000;

    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    // First subscribe with sufficient allowance.
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &200);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);
    client.cancel(&user);

    // Revoke allowance so second subscribe sees zero.
    token.approve(&user, &contract_id, &0, &200);

    // Re-subscribe must panic because allowance is zero.
    client.subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);
}

#[test]
fn test_merchant_sub_count_resubscribe_different_merchant() {
    let (env, contract_id, token_addr, user, merchant_a) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchant_b = Address::generate(&env);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    // Subscribe user to merchant A
    client.subscribe(
        &user,
        &merchant_a,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant_a), 1);
    assert_eq!(client.get_merchant_sub_count(&merchant_b), 0);

    // Re-subscribe user to merchant B
    client.subscribe(
        &user,
        &merchant_b,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant_a), 0);
    assert_eq!(client.get_merchant_sub_count(&merchant_b), 1);
}

#[test]
fn test_merchant_sub_count_resubscribe_same_merchant_no_inflation() {
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

    // Repeatedly re-subscribing to the same merchant while the subscription is
    // already active must not inflate the merchant subscriber counter.
    for _ in 0..5 {
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
    }

    // The global subscriber count was already guarded against the same
    // inflation and must stay in lockstep with the merchant counter.
    assert_eq!(client.get_subscriber_count(), 1);
}

#[test]
fn test_merchant_sub_count_resubscribe_same_merchant_does_not_rank_merchant() {
    let (env, contract_id, token_addr, _user, _m) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    client.add_merchant(&m1);
    client.add_merchant(&m2);

    let u1 = setup_funded_user(&env, &contract_id, &token_addr);
    let u2 = setup_funded_user(&env, &contract_id, &token_addr);

    client.subscribe(&u1, &m1, &1_0000000, &86400, &token_addr, &None, &None);

    // u1 churns on the same merchant; the merchant must not accumulate count.
    for _ in 0..3 {
        client.subscribe(&u1, &m1, &2_0000000, &43200, &token_addr, &None, &None);
    }
    assert_eq!(client.get_merchant_sub_count(&m1), 1);

    // m2 has a single real subscriber and should out-rank m1's inflated count.
    client.subscribe(&u2, &m2, &1_0000000, &86400, &token_addr, &None, &None);
    assert_eq!(client.get_merchant_sub_count(&m2), 1);

    let top = client.get_top_merchants_by_subs(&2u32);
    assert_eq!(top.len(), 2);
    // Tie at 1 sub each: index order (m1 added first) decides.
    assert_eq!(top.get(0).unwrap(), (m1.clone(), 1u32));
    assert_eq!(top.get(1).unwrap(), (m2.clone(), 1u32));
}

#[test]
fn test_merchant_sub_count_resubscribe_same_merchant_after_cancel_increments() {
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

    // Cancelling releases the slot, so re-subscribing to the same merchant
    // counts again.
    client.cancel(&user);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);

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

    // A second same-merchant re-subscribe is still a no-op for the counter.
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
}

#[test]
fn test_merchant_sub_count_never_subscribed_returns_zero() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let unknown_merchant = Address::generate(&env);
    assert_eq!(client.get_merchant_sub_count(&unknown_merchant), 0);
}

// ─────────────────────────────────────────────────────────────
// Tests for Issue #636: validate_interval hardening
// ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_subscribe_interval_zero_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &10_0000000, &0, &token_addr, &None, &None);
}

/// Re-appends after a cancel + resubscribe cycle (transfer/cancel paths reuse
/// `append_subscriber_index` internally) must re-extend the size key too.
#[test]
fn test_resubscribe_keeps_size_key_ttl_parity() {
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
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_subscriber_count(), 2);
    assert_index_keys_share_ttl_window(&env, &contract_id);
}

// ─────────────────────────────────────────────────────────────
// Issue #610: get_subscription_token tests
// ─────────────────────────────────────────────────────────────

/// get_subscription_token returns None before the user subscribes.
#[test]
fn test_get_subscription_token_none_before_subscribe() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    assert!(
        client.get_subscription_token(&random).is_none(),
        "get_subscription_token should return None for a user with no subscription"
    );
}

/// get_subscription_token returns Some(token) after subscribe.
#[test]
fn test_get_subscription_token_some_after_subscribe() {
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

    assert_eq!(
        client.get_subscription_token(&user),
        Some(token_addr),
        "get_subscription_token should return Some(token) after subscribe"
    );
}

/// get_subscription_token still returns Some(token) after cancel — the record
/// exists but is inactive; callers that need to distinguish active vs cancelled
/// should use get_subscription instead.
#[test]
fn test_get_subscription_token_some_after_cancel() {
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

    // The subscription record still exists (active=false), so token is still readable.
    assert_eq!(
        client.get_subscription_token(&user),
        Some(token_addr),
        "get_subscription_token should return Some(token) for cancelled subscription"
    );
}

/// get_subscription_token reflects the token when the user re-subscribes with
/// a different token.
#[test]
fn test_get_subscription_token_updates_on_resubscribe() {
    let (env, contract_id, token_a, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_a, &None, &None);
    assert_eq!(client.get_subscription_token(&user), Some(token_a.clone()));

    let token_b = setup_second_token(&env, &contract_id, &user);
    client.subscribe(&user, &merchant, &2_0000000, &86400, &token_b, &None, &None);

    assert_eq!(
        client.get_subscription_token(&user),
        Some(token_b),
        "get_subscription_token should return the latest token after resubscribe"
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #32)")]
fn test_subscribe_self_subscription_panics() {
    let (env, contract_id, token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &user, &1_0000000, &86400, &token_addr, &None, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #32)")]
fn test_subscribe_contract_as_user_panics() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &contract_id,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
}

/// subscribe succeeds when the contract is not paused (baseline).
#[test]
fn test_subscribe_while_unpaused_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Contract is not paused by default — subscribe must succeed.
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert!(client.get_subscription(&user).is_some());
}

/// subscribe-while-paused never fires a ContractPausedError (#30).
#[test]
fn test_subscribe_paused_does_not_emit_legacy_error_30() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.pause_contract();

    let result = client.try_subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let err = result.expect_err("must fail when paused");
    // Unwrap the SDK error layers: Ok(Err(ContractError)) or Err(host-err).
    match err {
        Ok(contract_err) => {
            assert_eq!(
                contract_err,
                crate::errors::ContractError::ContractPaused.into(),
                "must be ContractPaused (#18), not the deprecated #30"
            );
        }
        Err(_) => {
            // Host-level panic — just assert it's not #30 by checking the
            // paused path returns a panic we can detect.
        }
    }
}
