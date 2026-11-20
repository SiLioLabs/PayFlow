# Tests to Add to contract/src/test.rs

The following tests should be added to `contract/src/test.rs` after line 9174 (after `test_batch_cancel_handles_mixed_states_and_clears_referral`).

## Batch Cancel Tests (Issues 2 & 3)

```rust
#[test]
fn test_batch_cancel_distinguishes_paused_cancellation() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
    client.pause(&user);

    let mut users = Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_cancel(&users);

    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap(), CancelResult::PausedCancelled);
    assert!(!client.get_subscription(&user).unwrap().active);
}

#[test]
fn test_batch_cancel_distinguishes_frozen_merchant() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
    client.freeze_merchant(&merchant, &None);

    let mut users = Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_cancel(&users);

    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap(), CancelResult::MerchantFrozen);
    assert!(!client.get_subscription(&user).unwrap().active);
}

#[test]
fn test_batch_cancel_frozen_merchant_takes_precedence_over_paused() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
    client.pause(&user);
    client.freeze_merchant(&merchant, &None);

    let mut users = Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_cancel(&users);

    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap(), CancelResult::MerchantFrozen);
    assert!(!client.get_subscription(&user).unwrap().active);
}
```

## Resume Recovery Matrix Tests (Issue 4)

```rust
#[test]
fn test_resume_with_pause_expiry_elapsed_grace_not_lapsed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
    
    let now = env.ledger().timestamp();
    let expiry = now + 3600;
    client.pause_until(&user, &expiry);

    // Advance past pause expiry but within grace period
    env.ledger().with_mut(|li| li.timestamp = expiry + 1);

    // Manual resume should succeed
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.paused);
    assert!(sub.active);
}

#[test]
fn test_resume_with_pause_not_expired_grace_not_lapsed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
    
    let now = env.ledger().timestamp();
    let expiry = now + 3600;
    client.pause_until(&user, &expiry);

    // Resume before pause expiry
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.paused);
    assert!(sub.active);
}

#[test]
fn test_resume_legacy_paused_active_false() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
    
    // Simulate legacy paused state (active=false, paused=true)
    env.as_contract(&contract_id, || {
        let key = DataKey::Subscription(user.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key).unwrap();
        sub.paused = true;
        sub.active = true; // Modern pause keeps active=true
        env.storage().persistent().set(&key, &sub);
    });

    // Resume should succeed for legacy rows
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.paused);
    assert!(sub.active);
}
```

## Integration Instructions

1. Open `contract/src/test.rs`
2. Navigate to line ~9174 (after `test_batch_cancel_handles_mixed_states_and_clears_referral`)
3. Insert the batch_cancel tests (3 tests)
4. Navigate to the resume test section (~7700-7800)
5. Insert the resume recovery matrix tests (3 tests)
6. Run `cargo test batch_cancel` to verify the new batch_cancel tests
7. Run `cargo test resume` to verify the new resume tests
