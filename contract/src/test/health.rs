// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// contract_health_check tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_health_check_initialized_unpaused() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let report = client.contract_health_check();

    assert!(
        report.is_healthy,
        "initialized and unpaused contract should be healthy"
    );
    assert!(!report.contract_paused);
    assert!(report.token_configured);
    assert!(report.admin_configured);
}

#[test]
fn test_health_check_paused() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);
    client.pause_contract();

    let report = client.contract_health_check();

    assert!(!report.is_healthy, "paused contract should not be healthy");
    assert!(report.contract_paused);
}

#[test]
fn test_health_check_pre_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlowPay, ());
    let client = FlowPayClient::new(&env, &contract_id);

    let report = client.contract_health_check();

    assert!(
        !report.token_configured,
        "token should not be configured before initialize"
    );
    assert!(
        !report.is_healthy,
        "uninitialized contract should not be healthy"
    );
}

#[test]
fn test_health_check_active_subscription_count() {
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

    let report = client.contract_health_check();
    assert_eq!(report.active_subscription_count, 1);
}

// ─────────────────────────────────────────────
// Issue 010: HealthReport field cleanup tests
// ─────────────────────────────────────────────

#[test]
fn test_health_check_healthy_fully_configured() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let report = client.contract_health_check();

    assert!(report.is_healthy);
    assert!(!report.contract_paused);
    assert!(report.token_configured);
    assert!(report.admin_configured);
    assert_eq!(report.instance_bump_age_ledgers, Some(0));
    // pending_merchant_rev_count is 0 when no merchants have revenue
    assert_eq!(report.pending_merchant_rev_count, 0);
}

#[test]
fn test_health_check_paused_not_healthy() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.pause_contract();

    let report = client.contract_health_check();

    assert!(!report.is_healthy);
    assert!(report.contract_paused);
}

#[test]
fn test_health_check_unconfigured_not_healthy() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FlowPay, ());
    let client = FlowPayClient::new(&env, &contract_id);

    let report = client.contract_health_check();

    assert!(!report.is_healthy);
    assert!(!report.token_configured);
    assert!(!report.admin_configured);
}

/// Configuration health is independent of the maintenance age.
#[test]
fn test_health_check_is_healthy_independent_of_instance_ttl_field() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let report = client.contract_health_check();
    assert_eq!(
        report.is_healthy,
        !report.contract_paused && report.token_configured && report.admin_configured
    );
    assert!(report.is_healthy);
}

#[test]
fn test_health_check_ttl_is_positive() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert_eq!(
        client.contract_health_check().instance_bump_age_ledgers,
        None
    );
    client.initialize(&token_addr, &admin);
    assert_eq!(
        client.contract_health_check().instance_bump_age_ledgers,
        Some(0)
    );
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 12);
    assert_eq!(
        client.contract_health_check().instance_bump_age_ledgers,
        Some(12)
    );

    client.bump_instance_ttl();
    assert_eq!(
        client.contract_health_check().instance_bump_age_ledgers,
        Some(0)
    );

    // Model an initialized instance upgraded without a maintenance record.
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .remove(&DataKey::LastInstanceBumpLedger);
    });
    assert_eq!(
        client.contract_health_check().instance_bump_age_ledgers,
        None
    );
    client.bump_instance_ttl();
    assert_eq!(
        client.contract_health_check().instance_bump_age_ledgers,
        Some(0)
    );
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 5);
    assert_eq!(
        client.contract_health_check().instance_bump_age_ledgers,
        Some(5)
    );
}

#[test]
fn test_health_check_pending_merchant_revenue_counter() {
    let (env, contract_id, token_addr, user1, merchant1) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    assert_eq!(client.contract_health_check().pending_merchant_rev_count, 0);

    let user2 = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user2, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user2, &contract_id, &10_000_0000000, &200000);

    let merchant2 = Address::generate(&env);

    client.subscribe(&user1, &merchant1, &1000, &86400, &token_addr, &None, &None);
    client.subscribe(&user2, &merchant2, &1000, &86400, &token_addr, &None, &None);

    env.ledger().set_timestamp(86400);
    client.charge(&user1);

    // Now merchant1 has revenue, merchant2 does not
    let report1 = client.contract_health_check();
    assert_eq!(report1.pending_merchant_rev_count, 1);

    client.charge(&user2);
    // Now both have revenue
    let report2 = client.contract_health_check();
    assert_eq!(report2.pending_merchant_rev_count, 2);

    // Merchant revenue is non-custodial: there is no withdrawal to perform, the
    // admin resets the cumulative counter once the merchant has settled off-chain.
    client.reset_merchant_revenue(&merchant1);
    let report3 = client.contract_health_check();
    assert_eq!(report3.pending_merchant_rev_count, 1);

    client.reset_merchant_revenue(&merchant2);
    let report4 = client.contract_health_check();
    assert_eq!(report4.pending_merchant_rev_count, 0);
}

// ─────────────────────────────────────────────────────────────
// Tests for Issue #635: get_subscription_health
// ─────────────────────────────────────────────────────────────

#[test]
fn test_subscription_health_non_existent_user() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let unknown = Address::generate(&env);

    let health = client.get_subscription_health(&unknown);
    assert_eq!(
        health,
        SubscriptionHealth {
            active: false,
            charge_due: false,
            within_grace: false,
            has_sufficient_allowance: false,
            is_paused: false,
            trial_active: false,
            daily_limit_set: false,
        }
    );
}

#[test]
fn test_subscription_health_active_healthy() {
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

    let health = client.get_subscription_health(&user);
    assert_eq!(health.active, true);
    assert_eq!(health.charge_due, false);
    assert_eq!(health.within_grace, false);
    assert_eq!(health.has_sufficient_allowance, true);
    assert_eq!(health.is_paused, false);
    assert_eq!(health.trial_active, false);
    assert_eq!(health.daily_limit_set, false);
}

#[test]
fn test_subscription_health_paused() {
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
    client.pause(&user);

    let health = client.get_subscription_health(&user);
    assert_eq!(health.active, true);
    assert_eq!(health.is_paused, true);
    assert_eq!(health.charge_due, false);
}

#[test]
fn test_subscription_health_trial_active() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let trial_sec = 7 * 86400;
    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &Some(trial_sec),
        &None,
    );

    let health = client.get_subscription_health(&user);
    assert_eq!(health.trial_active, true);
}

#[test]
fn test_subscription_health_grace_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.propose_grace_period(&86400);
    client.commit_grace_period();

    let interval = 86400;
    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Fast-forward ledger past interval, into grace period window
    env.ledger().with_mut(|ledger| {
        ledger.timestamp += interval + 3600;
        ledger.sequence_number = 100;
    });

    let health = client.get_subscription_health(&user);
    assert_eq!(health.charge_due, true);
    assert_eq!(health.within_grace, true);
}

#[test]
fn test_subscription_health_insufficient_allowance() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Revoke allowance
    token.approve(&user, &contract_id, &0, &1000);

    let health = client.get_subscription_health(&user);
    assert_eq!(health.has_sufficient_allowance, false);
}

#[test]
fn test_subscription_health_daily_limit_set() {
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
    client.set_daily_limit(&user, &50_0000000);

    let health = client.get_subscription_health(&user);
    assert_eq!(health.daily_limit_set, true);
}

#[test]
fn test_contract_health_check_routes_through_effective_cap() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    // Initial state: default cap GLOBAL_MAX_VOLUME_PER_HOUR, 0 utilization
    let report = client.contract_health_check();
    assert_eq!(report.global_volume_utilization_pct, 0);

    // Accumulate volume equal to half of the default cap
    let half_default = GLOBAL_MAX_VOLUME_PER_HOUR / 2;
    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, half_default);
    });

    let report = client.contract_health_check();
    assert_eq!(report.global_volume_utilization_pct, 50);

    // Set override cap to the current accumulated volume; utilization must become 100%
    client.set_global_volume_cap(&half_default);
    let report = client.contract_health_check();
    assert_eq!(report.global_volume_utilization_pct, 100);
}

// ─────────────────────────────────────────────────────────────
// Issue #1224: within_grace agrees with is_charge_due
// ─────────────────────────────────────────────────────────────

/// When grace_period == 0 (default), a healthy subscription that is charge-due
/// must report within_grace == true, not false.
#[test]
fn test_subscription_health_within_grace_no_grace_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No grace period configured (default = 0).
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

    // Advance past the interval so a charge is due.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let health = client.get_subscription_health(&user);
    assert!(health.charge_due, "charge must be due");
    assert!(
        health.within_grace,
        "within_grace must agree with charge_due when grace_period == 0"
    );
}

/// A subscription that is due inside a configured grace window remains chargeable.
#[test]
fn test_subscription_health_within_grace_with_grace_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let grace: u64 = 7200;
    let interval: u64 = 3600;
    client.propose_grace_period(&grace);
    client.commit_grace_period();
    let grace: u64 = 7_200;
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
    client.propose_grace_period(&grace);
    client.commit_grace_period();

    // Move just past the interval: the charge is due, and still inside the grace window.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let health = client.get_subscription_health(&user);
    assert!(health.charge_due, "charge must be due inside grace window");
    assert!(
        health.within_grace,
        "within_grace must be true inside grace window"
    );
    env.ledger()
        .with_mut(|ledger| ledger.timestamp += interval + 1);
    let health = client.get_subscription_health(&user);
    assert!(health.charge_due);
    assert!(health.within_grace);
}

/// When grace_period > 0 and we are past the grace window, both charge_due
/// and within_grace must be false.
#[test]
fn test_subscription_health_past_grace_window() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let grace: u64 = 3600;
    let interval: u64 = 3600;
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

    // Advance past interval AND grace window.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace + 1;
    });

    let health = client.get_subscription_health(&user);
    assert!(
        !health.charge_due,
        "charge must not be due after grace window"
    );
    assert!(
        !health.within_grace,
        "within_grace must be false after grace window"
    );
}
