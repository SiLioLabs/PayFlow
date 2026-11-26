#[test]
fn test_top_merchants_by_subs() {
    let (env, contract_id, token_addr, _user, _m) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);

    client.add_merchant(&m1);
    client.add_merchant(&m2);
    client.add_merchant(&m3);

    // Create subscriptions for m1 (1 sub), m2 (3 subs), m3 (2 subs)
    let u1 = setup_funded_user(&env, &contract_id, &token_addr);
    let u2 = setup_funded_user(&env, &contract_id, &token_addr);
    let u3 = setup_funded_user(&env, &contract_id, &token_addr);
    let u4 = setup_funded_user(&env, &contract_id, &token_addr);
    let u5 = setup_funded_user(&env, &contract_id, &token_addr);
    let u6 = setup_funded_user(&env, &contract_id, &token_addr);

    client.subscribe(&u1, &m1, &1_0000000, &86400, &token_addr, &None, &None);

    client.subscribe(&u2, &m2, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u3, &m2, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u4, &m2, &1_0000000, &86400, &token_addr, &None, &None);

    client.subscribe(&u5, &m3, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u6, &m3, &1_0000000, &86400, &token_addr, &None, &None);

    // Top 3 merchants: m2 (3 subs), m3 (2 subs), m1 (1 sub)
    let top = client.get_top_merchants_by_subs(&3u32);
    assert_eq!(top.len(), 3);
    assert_eq!(top.get(0).unwrap(), (m2.clone(), 3u32));
    assert_eq!(top.get(1).unwrap(), (m3.clone(), 2u32));
    assert_eq!(top.get(2).unwrap(), (m1.clone(), 1u32));

    // Unknown / unindexed merchant returns 0 for subscriber count query
    let unindexed = Address::generate(&env);
    assert_eq!(client.get_merchant_sub_count(&unindexed), 0);
}

#[test]
fn test_top_merchants_tie_breaking_and_limit() {
    let (env, contract_id, token_addr, _user, _m) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);

    // Add m1 first, then m2
    client.add_merchant(&m1);
    client.add_merchant(&m2);

    let u1 = setup_funded_user(&env, &contract_id, &token_addr);
    let u2 = setup_funded_user(&env, &contract_id, &token_addr);

    // Both m1 and m2 get 1 sub (tie)
    client.subscribe(&u1, &m1, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u2, &m2, &1_0000000, &86400, &token_addr, &None, &None);

    // Tie-breaking preserves index order: m1 first, m2 second
    let top = client.get_top_merchants_by_subs(&2u32);
    assert_eq!(top.len(), 2);
    assert_eq!(top.get(0).unwrap(), (m1.clone(), 1u32));
    assert_eq!(top.get(1).unwrap(), (m2.clone(), 1u32));

    // Limit 1 returns top 1
    let top1 = client.get_top_merchants_by_subs(&1u32);
    assert_eq!(top1.len(), 1);
    assert_eq!(top1.get(0).unwrap(), (m1.clone(), 1u32));
}

#[test]
fn test_top_merchants_ignores_same_merchant_resubscribe_inflation() {
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
    let u3 = setup_funded_user(&env, &contract_id, &token_addr);

    // m1 gets one genuine subscriber who then churns on the same merchant.
    client.subscribe(&u1, &m1, &1_0000000, &86400, &token_addr, &None, &None);
    for _ in 0..4 {
        client.subscribe(&u1, &m1, &3_0000000, &43200, &token_addr, &None, &None);
    }

    // m2 gets two genuine subscribers.
    client.subscribe(&u2, &m2, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u3, &m2, &1_0000000, &86400, &token_addr, &None, &None);

    assert_eq!(client.get_merchant_sub_count(&m1), 1);
    assert_eq!(client.get_merchant_sub_count(&m2), 2);

    let top = client.get_top_merchants_by_subs(&2u32);
    assert_eq!(top.len(), 2);
    assert_eq!(top.get(0).unwrap(), (m2.clone(), 2u32));
    assert_eq!(top.get(1).unwrap(), (m1.clone(), 1u32));
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_top_merchants_limit_exceeded_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.get_top_merchants_by_subs(&21u32);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Subscriber index tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_subscriber_index_three_unique_users() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = setup_funded_user(&env, &contract_id, &token_addr);
    let user_c = setup_funded_user(&env, &contract_id, &token_addr);

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
    client.subscribe(
        &user_c,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_subscriber_count(), 3);

    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 3);
    assert_eq!(page.get(0).unwrap(), user_a);
    assert_eq!(page.get(1).unwrap(), user_b);
    assert_eq!(page.get(2).unwrap(), user_c);
}

#[test]
fn test_resubscribe_active_does_not_duplicate_index() {
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

    // Re-subscribe while still active â€” must not append a second entry
    client.subscribe(
        &user,
        &merchant,
        &2_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_subscriber_count(), 1);

    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 1);
}

#[test]
fn test_subscriber_page_offset_beyond_count_returns_empty() {
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

    let page = client.get_subscriber_page(&1u64, &10u32);
    assert_eq!(page.len(), 0);

    let page_zero_limit = client.get_subscriber_page(&0u64, &0u32);
    assert_eq!(page_zero_limit.len(), 0);
}

#[test]
#[cfg(feature = "bench")]
fn test_subscriber_page_limit_capped_at_50() {
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
    let sac = StellarAssetClient::new(&env, &token_addr);
    let token = TokenClient::new(&env, &token_addr);

    for _ in 0..52 {
        let sub_user = Address::generate(&env);
        sac.mint(&sub_user, &10_000_0000000);
        token.approve(&sub_user, &contract_id, &10_000_0000000, &200);

        client.subscribe(
            &sub_user,
            &merchant,
            &1_0000000,
            &86400,
            &token_addr,
            &None,
            &None,
        );
    }

    assert_eq!(client.get_subscriber_count(), 53);

    let page = client.get_subscriber_page(&0u64, &100u32);
    assert_eq!(page.len(), 50);
}

// ─────────────────────────────────────────────────────────────
// Issue #11: extend_subscriber_index_ttl tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_extend_subscriber_index_ttl_empty_index_noop() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    assert_eq!(client.get_subscriber_count(), 0);
    client.extend_subscriber_index_ttl();
    assert_eq!(client.get_subscriber_count(), 0);
}

#[test]
fn test_extend_subscriber_index_ttl_emits_event_with_count() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let user_b = setup_funded_user(&env, &contract_id, &token_addr);

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
        &user_b,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_subscriber_count(), 2);

    client.extend_subscriber_index_ttl();

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let count: u64 = data.try_into_val(&env).unwrap();

    assert_eq!(
        topic_symbol,
        Symbol::new(&env, "subscriber_index_ttl_extended")
    );
    assert_eq!(count, 2);
}

#[test]
fn test_extend_subscriber_index_ttl_extends_large_index() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    for _ in 0..5 {
        let u = setup_funded_user(&env, &contract_id, &token_addr);
        client.subscribe(&u, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
        users.push_back(u);
    }

    assert_eq!(client.get_subscriber_count(), 5);

    client.extend_subscriber_index_ttl();

    let events = contract_events(&env);
    let (_, _, data) = events.get(events.len() - 1).unwrap();
    let count: u64 = data.try_into_val(&env).unwrap();
    assert_eq!(count, 5);

    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::SubscriberIndexSize);
        assert!(ttl >= SUBSCRIPTION_TTL_LEDGERS);

        let ttl_0 = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::SubscriberIndex(0));
        assert!(ttl_0 >= SUBSCRIPTION_TTL_LEDGERS);
    });
}

#[test]
fn test_append_subscriber_index_ttl_extends_size_key() {
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
    assert_index_keys_share_ttl_window(&env, &contract_id);
}

/// The admin repair helper stays functionally compatible: it must still
/// tombstone stale slots, and (per the issue's secondary ask) its touch also
/// bumps the size key onto the shared TTL window.
#[test]
fn test_clear_subscriber_index_entry_bumps_size_key_ttl() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

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

    deactivate_subscription_leaving_index(&env, &contract_id, &user);

    client.clear_subscriber_index_entry(&0);

    env.as_contract(&contract_id, || {
        assert!(subscription_count::is_subscriber_index_removed(&env, 0));
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::SubscriberIndexSize);
        assert!(
            ttl >= SUBSCRIPTION_TTL_LEDGERS,
            "admin repair must keep SubscriberIndexSize on the shared window; got {ttl}"
        );
    });
}

#[test]
fn test_clear_subscriber_index_entry_authorized_repair_tombstones_stale_slot() {
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
    assert_eq!(client.get_subscriber_at(&0u64), Some(user.clone()));

    deactivate_subscription_leaving_index(&env, &contract_id, &user);
    assert_eq!(
        client.get_subscriber_at(&0u64),
        Some(user.clone()),
        "stale slot must still be visible before repair"
    );

    client.clear_subscriber_index_entry(&0u64);

    assert_eq!(
        client.get_subscriber_at(&0u64),
        None,
        "repaired slot must be tombstoned"
    );
    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 0);
    assert_eq!(
        client.get_subscriber_count(),
        1,
        "repair must not shrink the append-only index"
    );
}

#[test]
#[should_panic]
fn test_clear_subscriber_index_entry_unauthorized_panics() {
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
    deactivate_subscription_leaving_index(&env, &contract_id, &user);

    env.set_auths(&[]);
    client.clear_subscriber_index_entry(&0u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_clear_subscriber_index_entry_refuses_active_subscriber() {
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

    client.clear_subscriber_index_entry(&0u64);
}

#[test]
fn test_clear_subscriber_index_entry_emits_audit_event() {
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
    deactivate_subscription_leaving_index(&env, &contract_id, &user);

    client.clear_subscriber_index_entry(&0u64);

    let events = contract_events(&env);
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let topic_user: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
    let index: u64 = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "subscriber_index_cleared"));
    assert_eq!(topic_user, user);
    assert_eq!(index, 0);
}

/// Pagination with no tombstones: get_active_subscriber_page returns all
/// active subscribers across consecutive pages.
#[test]
fn test_active_subscriber_page_no_tombstones_covers_all() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 5);

    let page1 = client.get_active_subscriber_page(&0u64, &3u32);
    assert_eq!(page1.len(), 3);
    let page2 = client.get_active_subscriber_page(&3u64, &3u32);
    assert_eq!(page2.len(), 2);
    let page3 = client.get_active_subscriber_page(&5u64, &3u32);
    assert_eq!(page3.len(), 0);

    let mut all = soroban_sdk::Vec::new(&env);
    for addr in page1.iter() {
        all.push_back(addr);
    }
    for addr in page2.iter() {
        all.push_back(addr);
    }
    assert_eq!(all.len(), 5);
}

/// Pagination with interleaved cancellations: keepers advancing offset
/// by limit each call eventually scan all active subscribers.
#[test]
fn test_active_subscriber_page_with_tombstones_covers_all() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 6);

    // Cancel users at even indices (slots 0, 2, 4)
    client.cancel(&users.get(0).unwrap());
    client.cancel(&users.get(2).unwrap());
    client.cancel(&users.get(4).unwrap());

    // Page through with limit=2
    let mut collected = soroban_sdk::Vec::new(&env);
    let mut offset: u64 = 0;
    let limit: u32 = 2;
    let max_iterations = 20; // safety bound for test
    let mut iter = 0;
    while iter < max_iterations {
        let page = client.get_active_subscriber_page(&offset, &limit);
        if page.is_empty() {
            break;
        }
        for addr in page.iter() {
            collected.push_back(addr);
        }
        offset += limit as u64;
        iter += 1;
    }

    // All 3 active users (slots 1, 3, 5) should be collected
    assert_eq!(collected.len(), 3);
}

/// Pagination: offset beyond index size returns empty immediately.
#[test]
fn test_active_subscriber_page_offset_beyond_count_returns_empty() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 3);

    let page = client.get_active_subscriber_page(&100u64, &10u32);
    assert!(page.is_empty());
}

/// Pagination: zero limit returns empty immediately.
#[test]
fn test_active_subscriber_page_zero_limit_returns_empty() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 3);

    let page = client.get_active_subscriber_page(&0u64, &0u32);
    assert!(page.is_empty());
}

/// Pagination: all subscribers cancelled yields empty pages.
#[test]
fn test_active_subscriber_page_all_cancelled_returns_empty() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 3);

    client.cancel(&users.get(0).unwrap());
    client.cancel(&users.get(1).unwrap());
    client.cancel(&users.get(2).unwrap());

    let page = client.get_active_subscriber_page(&0u64, &50u32);
    assert!(page.is_empty());
}

/// Pagination: scan is bounded — even with a sparse index, the loop
/// terminates after examining at most `min(limit, 50)` slots.
#[test]
fn test_active_subscriber_page_bounded_scan_with_sparse_index() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Create 10 subscribers
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 10);

    // Cancel all but the last one
    for i in 0..9 {
        client.cancel(&users.get(i).unwrap());
    }

    // Scan with limit=5 from offset=0: examines slots 0-4, all cancelled
    let page = client.get_active_subscriber_page(&0u64, &5u32);
    assert!(page.is_empty());

    // Scan with limit=5 from offset=5: examines slots 5-9, only slot 9 active
    let page2 = client.get_active_subscriber_page(&5u64, &5u32);
    assert_eq!(page2.len(), 1);
    assert_eq!(page2.get(0).unwrap(), users.get(9).unwrap());
}

/// Pagination: interleaved active and cancelled — full scan collects all
/// active subscribers without infinite loop.
#[test]
fn test_active_subscriber_page_alternating_active_cancelled() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Create 6 subscribers: slots 0-5
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 6);

    // Cancel slots 1, 3 (alternating)
    client.cancel(&users.get(1).unwrap());
    client.cancel(&users.get(3).unwrap());

    // Full scan with large limit
    let page = client.get_active_subscriber_page(&0u64, &50u32);
    assert_eq!(page.len(), 4); // slots 0, 2, 4, 5 are active
}

/// Pagination: resubscribe after cancel adds new slot, doesn't break scan.
/// The tombstone check prevents the old slot from appearing as a duplicate.
#[test]
fn test_active_subscriber_page_resubscribe_after_cancel() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user = setup_funded_user(&env, &client.address, &token_addr);
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

    // Cancel: slot 0 becomes tombstoned
    client.cancel(&user);

    // Resubscribe: new slot 1 is appended
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

    // Full scan should find the user in slot 1
    let page = client.get_active_subscriber_page(&0u64, &50u32);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap(), user);
}

/// Pagination: keeper-style iteration with offset advancing by limit
/// eventually terminates and collects all active users exactly once.
#[test]
fn test_active_subscriber_page_keeper_iteration_terminates() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Create 8 subscribers
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 8);

    // Cancel slots 1, 4, 6
    client.cancel(&users.get(1).unwrap());
    client.cancel(&users.get(4).unwrap());
    client.cancel(&users.get(6).unwrap());

    // Keeper iterates with limit=3, offset advancing by limit each time
    let mut collected = soroban_sdk::Vec::new(&env);
    let mut offset: u64 = 0;
    let limit: u32 = 3;
    let mut safety = 0;
    loop {
        let page = client.get_active_subscriber_page(&offset, &limit);
        if page.is_empty() || safety > 20 {
            break;
        }
        for addr in page.iter() {
            collected.push_back(addr);
        }
        offset += limit as u64;
        safety += 1;
    }

    // 5 active users: slots 0, 2, 3, 5, 7
    assert_eq!(collected.len(), 5);
}

/// Pagination: limit capped at 50 even if larger value passed.
#[test]
fn test_active_subscriber_page_limit_capped_at_50() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Create 5 subscribers
    let users = subscribe_users(&env, &client, &token_addr, &merchant, 5);

    // Request limit=100 — should be capped at 50, but only 5 exist
    let page = client.get_active_subscriber_page(&0u64, &100u32);
    assert_eq!(page.len(), 5);
}

/// Pagination: all slots cancelled except the very last — scan finds it.
#[test]
fn test_active_subscriber_page_only_last_active() {
    let (env, contract_id, token_addr, _, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let users = subscribe_users(&env, &client, &token_addr, &merchant, 10);

    // Cancel first 9
    for i in 0..9 {
        client.cancel(&users.get(i).unwrap());
    }

    // Full scan
    let page = client.get_active_subscriber_page(&0u64, &50u32);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap(), users.get(9).unwrap());
}

/// After prune, day-index no longer contains the pruned day.
#[test]
fn test_prune_compacts_day_index() {
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

    // Charge on day 1
    env.ledger().with_mut(|l| l.timestamp += interval + 1);
    client.charge(&user);
    let day1 = env.ledger().timestamp() / 86400;

    // Advance to day 2 and re-subscribe so we can charge again
    env.ledger().with_mut(|l| l.timestamp += 86400);
    let user2 = setup_funded_user(&env, &contract_id, &token_addr);
    client.subscribe(
        &user2,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| l.timestamp += interval + 1);
    client.charge(&user2);

    // Page should show 2 entries (day 1 and day 2)
    let page_before = client.get_merchant_revenue_day_page(&merchant, &0u32, &30u32);
    assert!(!page_before.is_empty());

    // Prune day1 bucket
    let days_to_prune = soroban_sdk::vec![&env, day1];
    client.prune_merchant_revenue_days(&merchant, &days_to_prune);

    // Day1 bucket value is gone
    assert_eq!(client.get_merchant_revenue_day(&merchant, &day1), 0);

    // Page no longer includes day1
    let page_after = client.get_merchant_revenue_day_page(&merchant, &0u32, &30u32);
    for i in 0..page_after.len() {
        let (day, _) = page_after.get(i).unwrap();
        assert_ne!(day, day1, "pruned day must not appear in page");
    }
}

/// Repeated prune cycles keep the index bounded to MAX_RETAINED_REVENUE_DAYS.
#[test]
fn test_repeated_prune_cycles_keep_index_bounded() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let interval: u64 = 3600; // 1-hour interval so we can do many without max-sub-interval
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Do 5 charge-prune cycles; each cycle leaves one new day entry and prunes
    // the oldest, verifying the index shrinks / stays bounded.
    for cycle in 0..5u64 {
        env.ledger().with_mut(|l| l.timestamp += interval + 1);
        client.charge(&user);

        let current_day = env.ledger().timestamp() / 86400;
        // For cycles > 0, prune the day we just added to keep things moving
        if cycle > 0 {
            let days_to_prune = soroban_sdk::vec![&env, current_day];
            client.prune_merchant_revenue_days(&merchant, &days_to_prune);
        }
    }

    // Page must return a bounded (non-unbounded) count
    let page = client.get_merchant_revenue_day_page(&merchant, &0u32, &30u32);
    assert!(
        page.len() <= crate::merchant_stats::MAX_RETAINED_REVENUE_DAYS,
        "index must be bounded after repeated prune cycles"
    );
}

/// After reset, day-index is cleared so stale slots are never returned.
#[test]
fn test_reset_clears_day_index() {
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

    // At least one day entry should exist
    let page_before = client.get_merchant_revenue_day_page(&merchant, &0u32, &30u32);
    assert!(
        !page_before.is_empty(),
        "should have at least one day entry before reset"
    );

    // Reset clears the day-index
    client.reset_merchant_revenue(&merchant);

    let page_after = client.get_merchant_revenue_day_page(&merchant, &0u32, &30u32);
    assert_eq!(page_after.len(), 0, "day-index must be empty after reset");
}

// ─────────────────────────────────────────────────────────────
// Issue #1222: scan_subscriber_slots helper — targeted tests
// ─────────────────────────────────────────────────────────────

/// Sparse index: some slots are tombstoned (cancelled users whose index entries
/// were cleared). `get_subscriber_page` must skip tombstoned slots and return
/// only the live addresses, maintaining the correct count.
///
/// Note: cancellation automatically tombstones the subscriber index slot via
/// `remove_subscriber_index` in `cancel_inner`, so the page is already sparse
/// immediately after cancel — no need to call `clear_subscriber_index_entry`.
#[test]
fn test_scan_sparse_index_skips_tombstones() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = setup_funded_user(&env, &contract_id, &token_addr);
    let user_c = setup_funded_user(&env, &contract_id, &token_addr);

    // Subscribe all three users — they occupy slots 0, 1, 2.
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
    client.subscribe(
        &user_c,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_subscriber_count(), 3);

    // Cancel user_b — this tombstones slot 1 automatically via remove_subscriber_index.
    client.cancel(&user_b);

    // The raw page scans slots 0..3; slot 1 is tombstoned and must be skipped.
    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 2, "tombstoned slot must be skipped");
    assert!(page.contains(&user_a));
    assert!(!page.contains(&user_b));
    assert!(page.contains(&user_c));
}
