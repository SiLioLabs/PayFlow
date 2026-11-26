#[test]
fn test_additional_subscriptions_charge_and_cancel_independently() {
    let (env, contract_id, primary_token, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let second_token = setup_second_token(&env, &contract_id, &user);
    let second_merchant = Address::generate(&env);
    let amount = 1_000_000;
    let interval = 86_400;
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &primary_token,
        &None,
        &None,
    );
    let first =
        client.subscribe_additional(&user, &merchant, &amount, &interval, &primary_token, &None);
    let second = client.subscribe_additional(
        &user,
        &second_merchant,
        &amount,
        &interval,
        &second_token,
        &None,
    );
    assert_eq!((first, second), (1, 2));
    assert_eq!(
        client.get_subscription_ids(&user, &0, &2),
        Vec::from_array(&env, [0, 1])
    );
    assert_eq!(
        client.get_subscription_ids(&user, &2, &50),
        Vec::from_array(&env, [2])
    );
    assert_eq!(
        client.get_subscription_by_id(&user, &0),
        client.get_subscription(&user)
    );
    assert_eq!(
        client.get_subscription_by_id(&user, &second).unwrap().token,
        second_token
    );

    let next = client.next_charge_at_by_id(&user, &second).unwrap();
    env.ledger().set_timestamp(next);
    client.charge_subscription(&user, &second);
    assert_eq!(
        client.next_charge_at_by_id(&user, &second),
        Some(next + interval)
    );
    assert_eq!(client.next_charge_at_by_id(&user, &first), Some(next));
    client.pay_per_use_subscription(&user, &second, &amount);
    assert_eq!(
        TokenClient::new(&env, &second_token).balance(&second_merchant),
        2 * amount
    );
    assert_eq!(
        client.get_settled_token_revenue(&second_merchant, &second_token),
        2 * amount
    );
    assert_eq!(client.get_merchant_revenue(&second_merchant), 0);

    client.cancel_subscription(&user, &first);
    assert_eq!(client.next_charge_at_by_id(&user, &first), None);
    assert!(
        client
            .get_subscription_by_id(&user, &second)
            .unwrap()
            .active
    );
    assert!(client.get_subscription(&user).unwrap().active);
    assert!(client.try_charge_subscription(&user, &first).is_err());

    env.ledger().set_timestamp(next + interval);
    client.charge_subscription(&user, &second);
    assert_eq!(
        TokenClient::new(&env, &second_token).balance(&second_merchant),
        3 * amount
    );
}

#[test]
fn test_additional_subscription_ids_are_scoped_and_require_owner_auth() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let other = setup_funded_user(&env, &contract_id, &token_addr);
    let id = client.subscribe_additional(&user, &merchant, &1_000_000, &86_400, &token_addr, &None);
    assert_eq!(client.get_subscription_by_id(&other, &id), None);
    assert!(matches!(
        client.try_cancel_subscription(&other, &id),
        Err(Ok(error)) if error == ContractError::NoSubscriptionFound.into()
    ));
    assert!(matches!(
        client.try_charge_subscription(&user, &u64::MAX),
        Err(Ok(error)) if error == ContractError::NoSubscriptionFound.into()
    ));

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::NextSubscriptionId(user.clone()), &id);
    });
    assert!(matches!(
        client.try_subscribe_additional(&user, &merchant, &1_000_000, &86_400, &token_addr, &None),
        Err(Ok(error)) if error == ContractError::SubscriptionIdAlreadyExists.into()
    ));

    env.mock_auths(&[]);
    assert!(client.try_cancel_subscription(&user, &id).is_err());
    assert!(client
        .try_pay_per_use_subscription(&user, &id, &1_000_000)
        .is_err());
    assert!(client.get_subscription_by_id(&user, &id).unwrap().active);
}

#[test]
fn test_migration_moves_v3_subscription_to_primary_id_once() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.set_whitelist_enabled(&false);
    client.subscribe(
        &user,
        &merchant,
        &1_000_000,
        &86_400,
        &token_addr,
        &None,
        &None,
    );
    let original = client.get_subscription(&user).unwrap();
    env.as_contract(&contract_id, || {
        let persistent = env.storage().persistent();
        persistent.remove(&DataKey::SubscriptionById(user.clone(), 0));
        persistent.set(&DataKey::Subscription(user.clone()), &original);
        persistent.set(&DataKey::MigratedAccount(user.clone()), &true);
        env.storage().instance().set(&DataKey::SchemaVersion, &3u32);
    });
    assert_eq!(
        client.get_subscription_by_id(&user, &0),
        Some(original.clone())
    );
    let users = Vec::from_array(&env, [user.clone(), user.clone()]);
    let primary = DataKey::SubscriptionById(user.clone(), 0);
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(&primary, &original);
    });
    assert!(matches!(
        client.try_migrate(&users),
        Err(Ok(error)) if error == ContractError::SubscriptionIdAlreadyExists.into()
    ));
    assert_eq!(client.get_migration_progress().migrated_accounts, 0);
    assert_eq!(client.get_subscription(&user), Some(original.clone()));
    env.as_contract(&contract_id, || env.storage().persistent().remove(&primary));

    client.migrate(&users);
    client.migrate(&users);
    assert_eq!(client.get_migration_progress().migrated_accounts, 1);
    assert_eq!(client.get_subscription(&user), Some(original));
    env.as_contract(&contract_id, || {
        assert!(!env
            .storage()
            .persistent()
            .has(&DataKey::Subscription(user.clone())));
        assert!(env
            .storage()
            .persistent()
            .has(&DataKey::SubscriptionById(user.clone(), 0)));
    });
    client.finalize_migration(&1);
    assert_eq!(client.get_schema_version(), 4);
    assert_eq!(
        client.subscribe_additional(&user, &merchant, &1_000_000, &86_400, &token_addr, &None),
        1,
    );
}
