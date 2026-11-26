use soroban_sdk::{contractevent, Address, Env, Vec};

use crate::{
    check_and_update_global_volume, errors::ContractError, fee, maintain_instance_ttl,
    prepare_subscription, DataKey, Subscription, SUBSCRIPTION_TTL_LEDGERS,
};

#[contractevent(topics = ["sub_id_created"])]
pub struct AdditionalSubscriptionCreated {
    #[topic]
    pub user: Address,
    #[topic]
    pub id: u64,
    pub merchant: Address,
    pub token: Address,
}

#[contractevent(topics = ["sub_id_cancelled"])]
pub struct AdditionalSubscriptionCancelled {
    #[topic]
    pub user: Address,
    #[topic]
    pub id: u64,
}

#[contractevent(topics = ["sub_id_paid"])]
pub struct AdditionalSubscriptionPaid {
    #[topic]
    pub user: Address,
    #[topic]
    pub id: u64,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub fee: i128,
    pub pay_per_use: bool,
}

pub(super) fn key(env: &Env, user: &Address, id: u64) -> DataKey {
    if id == 0 {
        crate::storage::subscription_key(env, user)
    } else {
        DataKey::SubscriptionById(user.clone(), id)
    }
}

fn extend(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(
        key,
        SUBSCRIPTION_TTL_LEDGERS / 2,
        SUBSCRIPTION_TTL_LEDGERS,
    );
}

pub(super) fn create(
    env: &Env,
    user: Address,
    merchant: Address,
    amount: i128,
    interval: u64,
    token: Address,
    trial_period: Option<u64>,
) -> u64 {
    let sub = prepare_subscription(
        env,
        &user,
        merchant,
        amount,
        interval,
        token,
        trial_period,
        None,
    );
    let persistent = env.storage().persistent();
    let counter = DataKey::NextSubscriptionId(user.clone());
    let id = persistent.get(&counter).unwrap_or(1u64);
    let next = id
        .checked_add(1)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));
    let slot = key(env, &user, id);
    if id == 0 || persistent.has(&slot) {
        env.panic_with_error(ContractError::SubscriptionIdAlreadyExists);
    }

    persistent.set(&slot, &sub);
    persistent.set(&counter, &next);
    bump(env, &user, id);
    AdditionalSubscriptionCreated {
        user,
        id,
        merchant: sub.merchant,
        token: sub.token,
    }
    .publish(env);
    id
}

pub(super) fn ids(env: &Env, user: &Address, from: u64, limit: u32) -> Vec<u64> {
    let persistent = env.storage().persistent();
    let mut page = Vec::new(env);
    let limit = limit.min(crate::caps::SUBSCRIBER_PAGE_SIZE);
    if limit == 0 {
        return page;
    }
    if from == 0 && persistent.has(&key(env, user, 0)) {
        page.push_back(0);
    }
    let start = from.max(1);
    let next: u64 = persistent
        .get(&DataKey::NextSubscriptionId(user.clone()))
        .unwrap_or(1);
    let end = next.min(start.saturating_add(u64::from(limit - page.len())));
    for id in start..end {
        page.push_back(id);
    }
    page
}

pub(super) fn bump(env: &Env, user: &Address, id: u64) {
    let slot = key(env, user, id);
    if env.storage().persistent().has(&slot) {
        // Refresh the allocator before the record so it stays live at least as long.
        env.storage().persistent().extend_ttl(
            &DataKey::NextSubscriptionId(user.clone()),
            SUBSCRIPTION_TTL_LEDGERS,
            SUBSCRIPTION_TTL_LEDGERS,
        );
        extend(env, &slot);
        maintain_instance_ttl(env, SUBSCRIPTION_TTL_LEDGERS);
    }
}

pub(super) fn cancel(env: &Env, user: &Address, id: u64) {
    user.require_auth();
    let slot = key(env, user, id);
    let persistent = env.storage().persistent();
    let mut sub: Subscription = persistent
        .get(&slot)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));
    if sub.active {
        sub.active = false;
        persistent.set(&slot, &sub);
        bump(env, user, id);
        AdditionalSubscriptionCancelled {
            user: user.clone(),
            id,
        }
        .publish(env);
    }
}

pub(super) fn settled_revenue(env: &Env, merchant: &Address, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::SettledRevenueByToken(
            merchant.clone(),
            token.clone(),
        ))
        .unwrap_or(0)
}

pub(super) fn record_revenue(env: &Env, merchant: &Address, token: &Address, amount: i128) {
    let revenue = settled_revenue(env, merchant, token)
        .checked_add(amount)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));
    let key = DataKey::SettledRevenueByToken(merchant.clone(), token.clone());
    env.storage().persistent().set(&key, &revenue);
    extend(env, &key);
}

pub(super) fn settle(env: &Env, user: &Address, id: u64, sub: &mut Subscription, now: u64) {
    let (fee, net, _, _) = fee::transfer_subscription_charge(env, user, sub, None, false);
    check_and_update_global_volume(env, sub.amount);
    record_revenue(env, &sub.merchant, &sub.token, net);
    sub.last_charged = now;
    env.storage().persistent().set(&key(env, user, id), sub);
    bump(env, user, id);
    publish_payment(env, user, id, sub, sub.amount, fee, false);
}

pub(super) fn publish_payment(
    env: &Env,
    user: &Address,
    id: u64,
    sub: &Subscription,
    amount: i128,
    fee: i128,
    pay_per_use: bool,
) {
    AdditionalSubscriptionPaid {
        user: user.clone(),
        id,
        merchant: sub.merchant.clone(),
        token: sub.token.clone(),
        amount,
        fee,
        pay_per_use,
    }
    .publish(env);
}
