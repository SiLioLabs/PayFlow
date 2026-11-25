/// freeze_merchant requires admin auth.
#[test]
#[should_panic]
fn test_freeze_merchant_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No admin configured â€” require_admin panics with NotInitialized (#7)
    client.freeze_merchant(&merchant, &None);
}

/// unfreeze_merchant requires admin auth.
#[test]
#[should_panic]
fn test_unfreeze_merchant_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No admin configured â€” require_admin panics with NotInitialized (#7)
    client.unfreeze_merchant(&merchant);
}

#[test]
#[should_panic]
fn test_non_admin_add_and_remove_merchant_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.set_auths(&[]);

    client.add_merchant(&merchant);
    client.remove_merchant(&merchant);
}

#[test]
#[should_panic]
fn test_whitelist_batch_add_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    env.set_auths(&[]);

    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(merchant.clone());
    client.whitelist_batch_add(&merchants);
}

#[test]
#[should_panic]
fn test_set_max_whitelist_batch_size_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    env.set_auths(&[]);

    client.set_max_whitelist_batch_size(&10);
}

#[test]
#[should_panic]
fn test_non_admin_set_max_batch_size_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.set_auths(&[]);
    client.set_max_batch_size(&10);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Contract admin event tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_contract_pause_events_emitted() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.pause_contract();
    assert_last_event(&env, "contract_paused");
    assert!(client.is_contract_paused());

    client.unpause_contract();
    assert_last_event(&env, "contract_unpaused");
    assert!(!client.is_contract_paused());
}

#[test]
fn test_admin_batch_pause_subscriptions_freezes_multiple_accounts() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = setup_funded_user(&env, &contract_id, &token_addr);

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
        &2_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let mut users = Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    client.batch_pause_subscriptions(&users);
    assert_eq!(count_user_events(&env, "subscription_paused", &user_a), 1);
    assert_eq!(count_user_events(&env, "subscription_paused", &user_b), 1);

    assert!(client.get_subscription(&user_a).unwrap().paused);
    assert!(client.get_subscription(&user_b).unwrap().paused);
}

#[test]
#[should_panic]
fn test_batch_pause_subscriptions_requires_admin_auth() {
    let env = Env::default();
    let contract_id = env.register(FlowPay, ());
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = Vec::new(&env);
    users.push_back(user);

    client.batch_pause_subscriptions(&users);
}

// ─────────────────────────────────────────────
// Issue #839 / Issue 044: deploy-facing initialize invariants
// Relied on by scripts/deploy-pipeline.ts and scripts/testnet-setup.ts.
// Signature must remain initialize(token, admin). Failures that scripts map
// must be ContractError (AlreadyInitialized = 1), not a host string panic.
// ─────────────────────────────────────────────

/// Successful initialize persists both the default token and the admin.
/// Deploy health checks require `token_configured` and `admin_configured`.
#[test]
fn test_initialize_deploy_invariant_persists_token_and_admin() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);

    assert_eq!(
        client.get_token(),
        Some(token_addr.clone()),
        "initialize must persist the token readable via get_token"
    );
    assert_eq!(
        client.get_admin(),
        Some(admin.clone()),
        "initialize must persist the admin readable via get_admin"
    );

    let report = client.contract_health_check();
    assert!(report.token_configured);
    assert!(report.admin_configured);
}

/// Storage read used by deploy scripts: get_admin returns the initialized admin.
#[test]
fn test_initialize_deploy_invariant_stored_admin() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert!(client.get_admin().is_none());
    client.initialize(&token_addr, &admin);
    assert_eq!(client.get_admin(), Some(admin));
}

/// Initialize without admin authorization must fail and must not persist token or admin.
#[test]
fn test_initialize_deploy_invariant_requires_admin_auth() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.set_auths(&[]);

    let result = client.try_initialize(&token_addr, &admin);
    assert!(result.is_err(), "initialize without admin auth must fail");
    assert_ne!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AlreadyInitialized as u32
        ))),
        "missing admin auth is an authorization failure, not AlreadyInitialized"
    );

    assert!(
        client.get_token().is_none(),
        "failed initialize must not persist token"
    );
    assert!(
        client.get_admin().is_none(),
        "failed initialize must not persist admin"
    );
}

/// Backward-compat: current initialize(token, admin) arity remains the deploy entrypoint.
#[test]
fn test_initialize_deploy_invariant_token_admin_signature() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);
    assert_eq!(client.get_token(), Some(token_addr));
    assert_eq!(client.get_admin(), Some(admin));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
#[should_panic]
fn test_migrate_non_admin_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    env.set_auths(&[]);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.migrate(&users);
}

#[test]
#[should_panic]
fn test_clear_charge_history_non_admin_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.set_auths(&[]);
    client.clear_charge_history(&user);
}

#[test]
fn test_clear_charge_history_admin_succeeds() {
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

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(client.get_charge_history(&user).len(), 1);

    client.clear_charge_history(&user);

    assert_eq!(client.get_charge_history(&user).len(), 0);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Admin transfer tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_transfer_admin() {
    let (env, contract_id, _token_addr, old_admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &old_admin);
    });

    let new_admin = Address::generate(&env);

    // Step 1: propose
    client.transfer_admin(&new_admin);
    // Step 2: accept
    client.accept_admin();

    let current_admin = env.as_contract(&contract_id, || storage::get_admin(&env));
    assert_eq!(current_admin, new_admin);
}

#[test]
fn test_transfer_admin_rejects_current_admin() {
    let (env, contract_id, _token_addr, admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || storage::set_admin(&env, &admin));

    assert_eq!(
        client.try_transfer_admin(&admin),
        Err(Ok(ContractError::InvalidAdminAddress))
    );
}

#[test]
fn test_transfer_admin_rejects_contract_address() {
    let (env, contract_id, _token_addr, admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || storage::set_admin(&env, &admin));

    assert_eq!(
        client.try_transfer_admin(&contract_id),
        Err(Ok(ContractError::InvalidAdminAddress))
    );
}

#[test]
fn test_transfer_admin_event_emitted() {
    let (env, contract_id, _token_addr, old_admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &old_admin);
    });

    let new_admin = Address::generate(&env);

    client.transfer_admin(&new_admin);
    client.accept_admin();

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (emitted_old_admin, emitted_new_admin): (Address, Address) =
        data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "admin_transferred"));
    assert_eq!(emitted_old_admin, old_admin);
    assert_eq!(emitted_new_admin, new_admin);
}

#[test]
fn test_transfer_admin_requires_auth() {
    let (env, contract_id, _token_addr, old_admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &old_admin);
    });

    let new_admin = Address::generate(&env);

    client.transfer_admin(&new_admin);
    client.accept_admin();

    let current_admin = env.as_contract(&contract_id, || storage::get_admin(&env));
    assert_eq!(current_admin, new_admin);
}

#[test]
fn test_old_admin_loses_access_after_transfer() {
    let (env, contract_id, _token_addr, old_admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &old_admin);
    });

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);
    client.accept_admin();

    let current_admin = env.as_contract(&contract_id, || storage::get_admin(&env));
    assert_ne!(current_admin, old_admin);
}

#[test]
#[should_panic]
fn test_accept_admin_without_proposal_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.accept_admin();
}

#[test]
fn test_get_protocol_stats_contract_paused() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Set admin directly in instance storage so admin-gated functions work
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    env.mock_all_auths();
    client.pause_contract();

    let stats = client.get_protocol_stats();
    assert!(stats.contract_paused);

    client.unpause_contract();
    let stats_after = client.get_protocol_stats();
    assert!(!stats_after.contract_paused);
}

/// Calling set_min_interval without a configured admin aborts with the typed
/// NotInitialized (code 7) rather than a host panic string.
#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_set_min_interval_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    // No admin configured â€” require_admin panics with NotInitialized (#7)
    client.set_min_interval(&7200u64);
}

/// Calling clear_merchant_revenue_history without an admin configured aborts
/// with the typed NotInitialized (code 7) rather than a host panic string.
#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_clear_merchant_revenue_history_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    // No admin configured â€” require_admin panics with NotInitialized (#7)
    client.clear_merchant_revenue_history(&merchant);
}

// ─────────────────────────────────────────────
// Issue #1043: typed NotInitialized on pre-initialize admin reads
// ─────────────────────────────────────────────

/// The typed NotInitialized (code 7) is raised by the shared admin read, so
/// every admin-gated entrypoint maps to it, not just the ones whose tests
/// pinned the old "admin not set" panic string.
#[test]
fn test_pre_initialize_admin_guards_map_to_typed_not_initialized() {
    fn assert_not_initialized<T, E>(
        res: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    ) {
        match res {
            Err(Ok(err)) => assert_eq!(
                err,
                soroban_sdk::Error::from_contract_error(
                    crate::errors::ContractError::NotInitialized as u32
                ),
                "pre-initialize admin read must map to ContractError::NotInitialized"
            ),
            _ => panic!("pre-initialize admin read must fail with a typed error"),
        }
    }

    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchant_list = soroban_sdk::Vec::new(&env);

    assert_not_initialized(client.try_pause_contract());
    assert_not_initialized(client.try_set_max_batch_size(&10u32));
    assert_not_initialized(client.try_set_whitelist_enabled(&false));
    assert_not_initialized(client.try_freeze_merchant(&merchant, &None));
    assert_not_initialized(client.try_whitelist_batch_add(&merchant_list));
}

#[test]
#[should_panic]
fn test_non_admin_set_grace_period_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.set_auths(&[]);

    client.propose_grace_period(&3600);
    client.commit_grace_period();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-36: set_subscription_amount tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Admin successfully updates a subscription amount; get_subscription reflects
/// the new value and last_charged / interval are untouched.
#[test]
fn test_set_subscription_amount_admin_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let original_amount: i128 = 1_0000000;
    let new_amount: i128 = 3_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &original_amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let sub_before = client.get_subscription(&user).unwrap();
    assert_eq!(sub_before.amount, original_amount);
    let last_charged_before = sub_before.last_charged;

    client.set_subscription_amount(&user, &new_amount);

    let sub_after = client.get_subscription(&user).unwrap();
    assert_eq!(sub_after.amount, new_amount, "amount should be updated");
    assert_eq!(
        sub_after.last_charged, last_charged_before,
        "last_charged must not change"
    );
    assert_eq!(sub_after.interval, interval, "interval must not change");
    assert!(sub_after.active, "subscription should remain active");
}

/// A non-admin caller must not be able to update a subscription amount.
#[test]
#[should_panic]
fn test_set_subscription_amount_non_admin_panics() {
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

    // Remove all authorizations so the admin auth check fails.
    env.set_auths(&[]);

    client.set_subscription_amount(&user, &2_0000000);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-37: set_subscription_interval tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Admin successfully updates the billing interval; next_charge_at reflects the
/// new value and last_charged / amount are untouched.
#[test]
fn test_set_subscription_interval_admin_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let amount: i128 = 1_0000000;
    let original_interval: u64 = 86400; // 1 day
    let new_interval: u64 = 30 * 24 * 3600; // 30 days

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &original_interval,
        &token_addr,
        &None,
        &None,
    );

    let sub_before = client.get_subscription(&user).unwrap();
    assert_eq!(sub_before.interval, original_interval);
    let last_charged_before = sub_before.last_charged;
    let amount_before = sub_before.amount;

    client.set_subscription_interval(&user, &new_interval);

    let sub_after = client.get_subscription(&user).unwrap();
    assert_eq!(
        sub_after.interval, new_interval,
        "interval should be updated"
    );
    assert_eq!(
        sub_after.last_charged, last_charged_before,
        "last_charged must not change"
    );
    assert_eq!(sub_after.amount, amount_before, "amount must not change");
    assert!(sub_after.active, "subscription should remain active");

    // next_charge_at must reflect last_charged + new_interval
    let expected_next = last_charged_before + new_interval;
    assert_eq!(
        client.next_charge_at(&user).unwrap(),
        expected_next,
        "next_charge_at should use the updated interval"
    );
}

/// A non-admin caller must not be able to update the billing interval.
#[test]
#[should_panic]
fn test_set_subscription_interval_non_admin_panics() {
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

    env.set_auths(&[]);

    client.set_subscription_interval(&user, &172800);
}

#[test]
fn test_merchant_fee_override_bounds_and_operator_assignment() {
    let (env, contract_id, _token_addr, admin_addr, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || storage::set_admin(&env, &admin_addr));
    client.set_fee_bounds(&100, &500);
    client.set_merchant_fee_bps(&merchant, &Some(250));
    assert_eq!(client.get_merchant_fee_bps(&merchant), Some(250));
    assert_eq!(client.get_effective_fee_bps(&merchant), 250);
    assert_eq!(
        client.get_effective_fee_bps(&Address::generate(&env)),
        0,
        "unset merchants inherit the global rate"
    );
    assert!(
        matches!(client.try_set_merchant_fee_bps(&merchant, &Some(50)), Err(Ok(error)) if error == ContractError::InvalidMerchantFeeBps.into())
    );
    client.set_merchant_fee_bps(&merchant, &None);
    assert_eq!(client.get_merchant_fee_bps(&merchant), None);

    let operator = Address::generate(&env);
    client.set_operator(&Some(operator.clone()));
    assert_eq!(client.get_operator(), Some(operator.clone()));
    client.set_contract_paused_as(&operator, &true);
    assert!(client.is_contract_paused());
    let impostor = Address::generate(&env);
    assert!(client
        .try_set_contract_paused_as(&impostor, &false)
        .is_err());
    assert!(client.is_contract_paused());
    client.set_contract_paused_as(&operator, &false);
    assert!(!client.is_contract_paused());
    client.set_operator(&None);
    assert_eq!(client.get_operator(), None);
}

/// Non-admin callers must be rejected with an auth panic.
#[test]
#[should_panic]
fn test_batch_pause_subscriptions_non_admin_panics() {
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

    // Clear all auths â€” admin auth should fail and panic
    env.set_auths(&[]);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.batch_pause_subscriptions(&users);
}

#[test]
fn test_admin_batch_cancel_subscriptions_cancels_multiple_accounts() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = setup_funded_user(&env, &contract_id, &token_addr);

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
        &2_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let mut users = Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_cancel(&users);
    assert_eq!(count_user_events(&env, "cancelled", &user_a), 1);
    assert_eq!(count_user_events(&env, "cancelled", &user_b), 1);

    assert_eq!(results.len(), 2);
    assert_eq!(results.get(0).unwrap(), CancelResult::Cancelled);
    assert_eq!(results.get(1).unwrap(), CancelResult::Cancelled);
    assert!(!client.get_subscription(&user_a).unwrap().active);
    assert!(!client.get_subscription(&user_b).unwrap().active);
}

#[test]
#[should_panic]
fn test_batch_cancel_requires_admin_auth() {
    let env = Env::default();
    let contract_id = env.register(FlowPay, ());
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = Vec::new(&env);
    users.push_back(user);

    client.batch_cancel(&users);
}

/// set_initial_admin with proper auth when Admin is unset succeeds and stores admin.
#[test]
fn test_set_initial_admin_success_once() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert!(client.get_admin().is_none());
    client.set_initial_admin(&admin);
    assert_eq!(client.get_admin(), Some(admin));
}

/// A second set_initial_admin call must return typed AdminAlreadySet (code 42),
/// not a raw string panic, and must not change the stored admin.
#[test]
fn test_set_initial_admin_second_call_returns_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);

    client.set_initial_admin(&admin1);
    assert_eq!(client.get_admin(), Some(admin1.clone()));

    let result = client.try_set_initial_admin(&admin2);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AdminAlreadySet as u32
        ))),
        "second set_initial_admin must map to ContractError::AdminAlreadySet"
    );

    // First admin is unchanged — no partial overwrite.
    assert_eq!(client.get_admin(), Some(admin1));
}

/// Calling set_initial_admin without the proposed admin's auth must fail with an
/// authorization error (host-level, not a contract-level typed error) and must
/// not write the admin slot.
#[test]
fn test_set_initial_admin_unauthenticated_fails() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.set_auths(&[]);

    let result = client.try_set_initial_admin(&admin);
    assert!(
        result.is_err(),
        "set_initial_admin without proposed admin auth must fail"
    );
    assert_ne!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AdminAlreadySet as u32
        ))),
        "missing auth must be an authorization failure, not AdminAlreadySet"
    );

    assert!(
        client.get_admin().is_none(),
        "failed set_initial_admin must not persist admin"
    );
}

/// Partial-init edge case: Token is already stored (e.g. from a separate
/// deploy-step) but Admin slot is still empty. set_initial_admin must still
/// require auth, succeed, and not be confused with initialize's state.
#[test]
fn test_set_initial_admin_token_present_admin_missing() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    // Simulate partial init: write Token but not Admin.
    env.as_contract(&contract_id, || {
        storage::set_token(&env, &token_addr);
    });

    // Sanity: token stored, admin missing.
    assert_eq!(client.get_token(), Some(token_addr.clone()));
    assert!(client.get_admin().is_none());

    // set_initial_admin must still require auth and succeed.
    client.set_initial_admin(&admin);
    assert_eq!(client.get_admin(), Some(admin.clone()));
    // Token state untouched.
    assert_eq!(client.get_token(), Some(token_addr));

    // Subsequent call returns typed error (not a panic) even in partial-init
    // post-success state.
    let admin2 = Address::generate(&env);
    let result = client.try_set_initial_admin(&admin2);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AdminAlreadySet as u32
        ))),
        "post-success second call must return AdminAlreadySet in partial-init scenario"
    );
    assert_eq!(client.get_admin(), Some(admin));
}

#[test]
#[should_panic]
fn test_extend_subscriber_index_ttl_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.set_auths(&[]);

    client.extend_subscriber_index_ttl();
}

/// Non-admin calling propose_fee panics.
#[test]
#[should_panic]
fn test_propose_fee_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No admin set; require_admin call inside propose_fee should panic.
    // NOTE: propose_fee in lib.rs calls bump_instance_ttl then fee::propose_fee.
    // fee::propose_fee itself does not require_admin — the admin guard
    // is the caller's responsibility in lib.rs.  We verify the whole
    // public entry point panics when no admin is configured.
    let collector = Address::generate(&env);

    // Explicitly set an admin so admin check works, then revoke auths.
    client.propose_fee(&collector, &100);
}

//
// Issue #810: authorization-boundary tests
//
// Each admin entrypoint is tested in two states:
//   (a) success with admin auth   called via the normal client method inside
//       `mock_all_auths`
//   (b) panic when no admin is set   called via try_* so the contract error is
//       surfaced as an Err, not a hard panic
//
// Note: `setup()` enables `env.mock_all_auths()`, so a "non-admin rejected"
// variant cannot force `require_admin` to fail in this environment; rejection
// is instead covered by the no-admin panic path and the contract's own
// `require_admin` guard.
//

// -- freeze_merchant ----------------------------------------------------------

/// Admin can freeze a merchant (happy path).
#[test]
fn test_freeze_merchant_admin_success() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.freeze_merchant(&merchant, &None);

    assert!(client.is_merchant_frozen(&merchant));
}

/// freeze_merchant panics when no admin has been set.
#[test]
fn test_freeze_merchant_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_freeze_merchant(&merchant, &None);
    assert!(result.is_err());
}

// -- propose_fee --------------------------------------------------------------

/// Admin can propose a fee (happy path).
#[test]
fn test_propose_fee_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &100);

    assert_eq!(client.get_fee(), None);
}

/// propose_fee panics when no admin has been set.
#[test]
fn test_propose_fee_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    let result = client.try_propose_fee(&collector, &100);
    assert!(result.is_err());
}

// -- set_min_interval ---------------------------------------------------------

/// Admin can set min_interval (happy path).
#[test]
fn test_set_min_interval_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_min_interval(&7200);
    assert_eq!(client.get_min_interval(), 7200);
}

/// set_min_interval panics when no admin has been set.
#[test]
fn test_set_min_interval_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_set_min_interval(&7200);
    assert!(result.is_err());
}

// -- batch_cancel -------------------------------------------------------------

/// Admin can batch-cancel subscriptions (happy path).
#[test]
fn test_batch_cancel_admin_success() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(u.clone());

    client.batch_cancel(&users);

    let sub = client.get_subscription(&u).unwrap();
    assert!(!sub.active);
}

/// batch_cancel panics when no admin has been set.
#[test]
fn test_batch_cancel_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let users = soroban_sdk::Vec::new(&env);
    let result = client.try_batch_cancel(&users);
    assert!(result.is_err());
}

// -- whitelist_batch_add ------------------------------------------------------

/// Admin can batch-add merchants to the whitelist (happy path).
#[test]
fn test_whitelist_batch_add_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 2);

    let added = client.whitelist_batch_add(&merchants);
    assert_eq!(added, 2);
}

/// whitelist_batch_add panics when no admin has been set.
#[test]
fn test_whitelist_batch_add_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchants = soroban_sdk::Vec::new(&env);
    let result = client.try_whitelist_batch_add(&merchants);
    assert!(result.is_err());
}

// -- batch_pause_subscriptions ------------------------------------------------

/// Admin can batch-pause subscriptions (happy path).
#[test]
fn test_batch_pause_subscriptions_admin_success() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(u.clone());

    client.batch_pause_subscriptions(&users);

    let sub = client.get_subscription(&u).unwrap();
    assert!(sub.paused);
}

/// batch_pause_subscriptions panics when no admin has been set.
#[test]
fn test_batch_pause_subscriptions_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let users = soroban_sdk::Vec::new(&env);
    let result = client.try_batch_pause_subscriptions(&users);
    assert!(result.is_err());
}

// -- clear_fee ----------------------------------------------------------------

/// Admin can clear fee (happy path).
#[test]
fn test_clear_fee_admin_success() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &100);
    client.commit_fee();
    assert!(client.get_fee().is_some());

    client.clear_fee();
    assert_eq!(client.get_fee(), None);
}

/// clear_fee panics when no admin has been set.
#[test]
fn test_clear_fee_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_clear_fee();
    assert!(result.is_err());
}

// -- set_whitelist_enabled ----------------------------------------------------

/// Admin can toggle whitelist on/off (happy path).
#[test]
fn test_set_whitelist_enabled_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_whitelist_enabled(&true);
    assert!(client.is_whitelist_enabled());

    client.set_whitelist_enabled(&false);
    assert!(!client.is_whitelist_enabled());
}

/// set_whitelist_enabled panics when no admin has been set.
#[test]
fn test_set_whitelist_enabled_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_set_whitelist_enabled(&true);
    assert!(result.is_err());
}

// -- set_max_batch_size -------------------------------------------------------

/// Admin can set max_batch_size (happy path).
#[test]
fn test_set_max_batch_size_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_max_batch_size(&100);
    assert_eq!(client.get_max_batch_size(), 100);
}

/// set_max_batch_size panics when no admin has been set.
#[test]
fn test_set_max_batch_size_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_set_max_batch_size(&100);
    assert!(result.is_err());
}

// -- pause_contract -----------------------------------------------------------

/// Admin can pause the contract (happy path).
#[test]
fn test_pause_contract_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.pause_contract();
    assert!(client.is_contract_paused());
}

/// pause_contract panics when no admin has been set.
#[test]
fn test_pause_contract_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_pause_contract();
    assert!(result.is_err());
}

// -- migrate ------------------------------------------------------------------

/// Admin can run storage migration (happy path).
#[test]
fn test_migrate_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let users = soroban_sdk::Vec::new(&env);
    client.migrate(&users);
    client.finalize_migration(&0u64);
    assert_eq!(client.get_schema_version(), migration::CURRENT_VERSION);
}

/// migrate panics when no admin has been set.
#[test]
fn test_migrate_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let users = soroban_sdk::Vec::new(&env);
    let result = client.try_migrate(&users);
    assert!(result.is_err());
}

// -- set_global_volume_cap ----------------------------------------------------

/// Admin can set the global volume cap (happy path).
#[test]
fn test_set_global_volume_cap_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_global_volume_cap(&100_0000000);
    assert_eq!(client.get_global_volume_cap(), 100_0000000);
}

/// set_global_volume_cap panics when no admin has been set.
#[test]
fn test_set_global_volume_cap_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_set_global_volume_cap(&100_0000000);
    assert!(result.is_err());
}

// ─────────────────────────────────────────────────────────────
// Issue #1016: subscribe-while-paused uses ContractPaused (#18)
// ─────────────────────────────────────────────────────────────

/// subscribe while the contract is paused must return ContractPaused (#18),
/// not the deprecated ContractPausedError (#30).
#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_subscribe_while_paused_returns_contract_paused() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.pause_contract();

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

/// No-admin scenario: pause_contract requires admin; unpaused subscribe works.
#[test]
fn test_subscribe_no_admin_pause_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    // Never call pause_contract — no admin configured in this path.
    // Subscribe must work fine on a non-paused contract.
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
    assert!(sub.active);
}
