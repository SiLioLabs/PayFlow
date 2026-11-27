// ─────────────────────────────────────────────────────────────
// Issue #1025: upgrade event must carry the new WASM hash
// ─────────────────────────────────────────────────────────────

/// The `upgrade` event data must contain the new WASM hash so indexers and
/// keepers can audit which implementation went live.
#[test]
fn test_upgrade_event_carries_new_wasm_hash() {
    let env = Env::default();
    let contract_id = env.register(FlowPay, ());
    let expected_hash = BytesN::from_array(&env, &[0xAB; 32]);

    env.as_contract(&contract_id, || {
        events::publish_upgraded(&env, &expected_hash);
    });

    let all_events = contract_events(&env);
    let (_, topics, data) = all_events.get(all_events.len() - 1).unwrap();

    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "upgrade"));

    let emitted_hash: BytesN<32> = data.try_into_val(&env).unwrap();
    assert_eq!(emitted_hash, expected_hash);
}

// ─────────────────────────────────────────────────────────────
// Issue #45: get_pending_upgrade tests
// ─────────────────────────────────────────────────────────────

/// Returns None when no upgrade has been proposed.
#[test]
fn test_get_pending_upgrade_none_when_not_proposed() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    assert_eq!(client.get_pending_upgrade(), None);
}

/// Returns the proposed WASM hash after propose_upgrade is called.
#[test]
fn test_get_pending_upgrade_returns_proposed_hash() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let new_wasm_hash = BytesN::from_array(&env, &[0xAB; 32]);
    client.propose_upgrade(&new_wasm_hash);

    assert_eq!(client.get_pending_upgrade(), Some(new_wasm_hash));
}

/// Returns None after commit_upgrade consumes the pending hash.
#[test]
fn test_get_pending_upgrade_none_after_commit() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let new_wasm_hash = BytesN::from_array(&env, &[0xCD; 32]);
    client.propose_upgrade(&new_wasm_hash);

    // Hash is visible before commit
    assert_eq!(client.get_pending_upgrade(), Some(new_wasm_hash));

    client.commit_upgrade();

    // Cleared after commit
    assert_eq!(client.get_pending_upgrade(), None);
}

#[test]
fn test_cancel_pending_upgrade_clears_pending_upgrade_and_emits_event() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let new_wasm_hash = BytesN::from_array(&env, &[0xEF; 32]);
    client.propose_upgrade(&new_wasm_hash);
    client.cancel_pending_upgrade();
    assert_last_event(&env, "upg_cancelled");

    assert_eq!(client.get_pending_upgrade(), None);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_commit_upgrade_requires_pending_upgrade_after_cancel() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    client.propose_upgrade(&BytesN::from_array(&env, &[0xEF; 32]));
    client.cancel_pending_upgrade();
    client.commit_upgrade();
}

#[test]
fn test_pending_upgrade_expires() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    client.propose_upgrade(&BytesN::from_array(&env, &[0xEF; 32]));
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += upgrade::PENDING_UPGRADE_TTL_LEDGERS + 1;
    });

    assert_eq!(client.get_pending_upgrade(), None);
}

#[test]
fn test_repropose_refreshes_pending_upgrade_ttl() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let first_hash = BytesN::from_array(&env, &[0x01; 32]);
    let second_hash = BytesN::from_array(&env, &[0x02; 32]);
    client.propose_upgrade(&first_hash);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += upgrade::PENDING_UPGRADE_TTL_LEDGERS - 1;
    });
    client.propose_upgrade(&second_hash);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += upgrade::PENDING_UPGRADE_TTL_LEDGERS - 1;
    });

    assert_eq!(client.get_pending_upgrade(), Some(second_hash));
}

/// A second propose_upgrade overwrites the first pending hash.
#[test]
fn test_get_pending_upgrade_overwritten_by_second_proposal() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let hash_a = BytesN::from_array(&env, &[0x01; 32]);
    let hash_b = BytesN::from_array(&env, &[0x02; 32]);

    client.propose_upgrade(&hash_a);
    assert_eq!(client.get_pending_upgrade(), Some(hash_a));

    client.propose_upgrade(&hash_b);
    assert_eq!(client.get_pending_upgrade(), Some(hash_b));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #97: migration tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_migrate_sets_schema_version() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Before migration, version defaults to 0
    assert_eq!(client.get_schema_version(), 0);

    let empty_users = soroban_sdk::Vec::new(&env);
    client.migrate(&empty_users);
    client.finalize_migration(&0u64);

    assert_eq!(client.get_schema_version(), migration::CURRENT_VERSION);
}

#[test]
fn test_get_schema_version_returns_zero_and_updates() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(client.get_schema_version(), 0);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let empty_users = soroban_sdk::Vec::new(&env);
    client.migrate(&empty_users);
    client.finalize_migration(&0u64);
    assert_eq!(client.get_schema_version(), migration::CURRENT_VERSION);
}

// ─────────────────────────────────────────────────────────────
// Issue #6: Storage Migration v3 Tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_migration_v2_to_v3_populates_referrer() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let referrer = Address::generate(&env);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &1000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );

    let mut legacy = client.get_subscription(&user).unwrap();
    legacy.referrer = None;
    env.as_contract(&contract_id, || {
        let persistent = env.storage().persistent();
        persistent.remove(&DataKey::SubscriptionById(user.clone(), 0));
        persistent.set(&DataKey::Subscription(user.clone()), &legacy);
        env.storage().instance().set(&DataKey::SchemaVersion, &2u32);
    });

    assert_eq!(client.get_schema_version(), 2);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    client.migrate(&users);

    // The batch fills in the referrer but does not complete the upgrade on its own.
    assert_eq!(client.get_schema_version(), 2);
    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.referrer, Some(referrer));

    client.migrate(&users); // re-sent batch: skipped, nothing double-counted
    assert_eq!(client.get_schema_version(), 2);

    client.finalize_migration(&1u64);
    assert_eq!(client.get_schema_version(), migration::CURRENT_VERSION);
}
