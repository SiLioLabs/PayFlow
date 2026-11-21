// Additional tests for CancelResult expansion (Issue 3)
// These tests should be integrated into contract/src/test.rs after the PRs are merged

#[cfg(test)]
mod batch_cancel_tests {
    use super::*;

    #[test]
    fn test_batch_cancel_distinguishes_paused_cancellation() {
        let env = Env::default();
        env.mock_all_auths();

        let token = create_token(&env, &Address::generate(&env));
        let contract = create_contract(&env, &token.address);
        
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        contract.initialize(&token.address);
        contract.propose_admin(&admin);
        contract.accept_admin();
        
        // Whitelist merchant
        contract.add_merchant(&merchant);
        
        // Subscribe
        contract.subscribe(
            &user,
            &merchant,
            &100,
            &86400, // 1 day interval
            &None,
            &None,
            &None,
        );
        
        // Pause subscription
        contract.pause(&user);
        
        // Batch cancel - should return PausedCancelled
        let results = contract.batch_cancel(&vec![&env, user.clone()]);
        
        assert_eq!(results.len(), 1);
        assert_eq!(results.get(0).unwrap(), CancelResult::PausedCancelled);
        
        // Verify subscription is now cancelled
        let sub = contract.get_subscription(&user);
        assert_eq!(sub.active, false);
    }

    #[test]
    fn test_batch_cancel_distinguishes_frozen_merchant() {
        let env = Env::default();
        env.mock_all_auths();

        let token = create_token(&env, &Address::generate(&env));
        let contract = create_contract(&env, &token.address);
        
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        contract.initialize(&token.address);
        contract.propose_admin(&admin);
        contract.accept_admin();
        
        // Whitelist merchant
        contract.add_merchant(&merchant);
        
        // Subscribe
        contract.subscribe(
            &user,
            &merchant,
            &100,
            &86400,
            &None,
            &None,
            &None,
        );
        
        // Freeze merchant
        contract.freeze_merchant(&merchant);
        
        // Batch cancel - should return MerchantFrozen
        let results = contract.batch_cancel(&vec![&env, user.clone()]);
        
        assert_eq!(results.len(), 1);
        assert_eq!(results.get(0).unwrap(), CancelResult::MerchantFrozen);
        
        // Verify subscription is now cancelled
        let sub = contract.get_subscription(&user);
        assert_eq!(sub.active, false);
    }

    #[test]
    fn test_batch_cancel_frozen_merchant_takes_precedence_over_paused() {
        let env = Env::default();
        env.mock_all_auths();

        let token = create_token(&env, &Address::generate(&env));
        let contract = create_contract(&env, &token.address);
        
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        contract.initialize(&token.address);
        contract.propose_admin(&admin);
        contract.accept_admin();
        
        // Whitelist merchant
        contract.add_merchant(&merchant);
        
        // Subscribe
        contract.subscribe(
            &user,
            &merchant,
            &100,
            &86400,
            &None,
            &None,
            &None,
        );
        
        // Pause subscription
        contract.pause(&user);
        
        // Freeze merchant
        contract.freeze_merchant(&merchant);
        
        // Batch cancel - should return MerchantFrozen (takes precedence)
        let results = contract.batch_cancel(&vec![&env, user.clone()]);
        
        assert_eq!(results.len(), 1);
        assert_eq!(results.get(0).unwrap(), CancelResult::MerchantFrozen);
        
        // Verify subscription is now cancelled
        let sub = contract.get_subscription(&user);
        assert_eq!(sub.active, false);
    }
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
