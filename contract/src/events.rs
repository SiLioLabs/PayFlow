use soroban_sdk::{Address, BytesN, Env, Symbol};

use crate::Subscription;

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscribedEventData {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub ledger_sequence: u32,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChargeEventData {
    pub merchant: Address,
    pub gross: i128,
    pub fee: i128,
    pub net: i128,
    pub charged_at: u64,
    pub ledger_sequence: u32,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayPerUseEventData {
    pub merchant: Address,
    pub amount: i128,
    pub ledger_sequence: u32,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CancelledEventData {
    pub ledger_sequence: u32,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CancelledWithRefundEventData {
    pub refund_amount: i128,
    pub ledger_sequence: u32,
}

pub fn publish_subscribed(env: &Env, user: &Address, sub: &Subscription) {
    env.events().publish(
        (Symbol::new(env, "subscribed"), user.clone()),
        SubscribedEventData {
            merchant: sub.merchant.clone(),
            amount: sub.amount,
            interval: sub.interval,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_charged(
    env: &Env,
    user: &Address,
    sub: &Subscription,
    fee_amount: i128,
    charged_at: u64,
) {
    let net = sub.amount - fee_amount;
    env.events().publish(
        (Symbol::new(env, "charged"), user.clone()),
        ChargeEventData {
            merchant: sub.merchant.clone(),
            gross: sub.amount,
            fee: fee_amount,
            net,
            charged_at,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_pay_per_use(env: &Env, user: &Address, merchant: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "pay_per_use"), user.clone()),
        PayPerUseEventData {
            merchant: merchant.clone(),
            amount,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_cancelled(env: &Env, user: &Address) {
    env.events().publish(
        (Symbol::new(env, "cancelled"), user.clone()),
        CancelledEventData {
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_cancelled_with_refund(env: &Env, user: &Address, refund_amount: i128) {
    env.events().publish(
        (Symbol::new(env, "cancelled_with_refund"), user.clone()),
        CancelledWithRefundEventData {
            refund_amount,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_min_interval_updated(env: &Env, seconds: u64) {
    env.events()
        .publish((Symbol::new(env, "min_interval"),), seconds);
}

pub fn publish_merchant_history_cleared(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merch_hist_cleared"),), merchant.clone());
}

pub fn publish_paused(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "paused"), user.clone()), ());
}

pub fn publish_resumed(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "resumed"), user.clone()), ());
}

pub fn publish_subscription_paused(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "subscription_paused"), user.clone()), ());
}

pub fn publish_subscription_transferred(env: &Env, old_user: &Address, new_user: &Address) {
    env.events().publish(
        (Symbol::new(env, "sub_transferred"), old_user.clone()),
        new_user.clone(),
    );
}

pub fn publish_upgraded(env: &Env, _new_wasm_hash: &BytesN<32>) {
    env.events().publish((Symbol::new(env, "upgrade"),), ());
}

pub fn publish_upgrade_proposed(env: &Env, new_wasm_hash: &BytesN<32>) {
    env.events()
        .publish((Symbol::new(env, "upg_proposed"),), new_wasm_hash.clone());
}

pub fn publish_contract_paused(env: &Env) {
    env.events()
        .publish((Symbol::new(env, "contract_paused"),), ());
}

pub fn publish_contract_unpaused(env: &Env) {
    env.events()
        .publish((Symbol::new(env, "contract_unpaused"),), ());
}

pub fn publish_daily_limit_set(env: &Env, user: &Address, limit: i128) {
    env.events()
        .publish((Symbol::new(env, "daily_limit_set"), user.clone()), limit);
}

pub fn publish_daily_limit_removed(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "daily_limit_removed"), user.clone()), ());
}

pub fn publish_fee_cleared(env: &Env) {
    env.events()
        .publish((Symbol::new(env, "fee_cleared"),), ());
}
pub fn publish_subscription_amount_updated(
    env: &Env,
    user: &Address,
    old_amount: i128,
    new_amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "sub_amount_updated"), user.clone()),
        (old_amount, new_amount),
    );
}

pub fn publish_subscription_interval_updated(
    env: &Env,
    user: &Address,
    old_interval: u64,
    new_interval: u64,
) {
    env.events().publish(
        (Symbol::new(env, "sub_interval_updated"), user.clone()),
        (old_interval, new_interval),
    );
}

pub fn publish_merchant_withdrawal(env: &Env, merchant: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "merchant_withdrawal"), merchant.clone()),
        amount,
    );
}

pub fn publish_referred(env: &Env, user: &Address, referrer: &Address) {
    env.events().publish(
        (Symbol::new(env, "referred"), user.clone()),
        referrer.clone(),
    );
}

pub fn publish_admin_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (Symbol::new(env, "admin_transferred"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

pub fn publish_fee_proposed(env: &Env, collector: &Address, bps: u32) {
    env.events().publish(
        (Symbol::new(env, "fee_proposed"),),
        (collector.clone(), bps),
    );
}

pub fn publish_fee_committed(env: &Env, collector: &Address, bps: u32) {
    env.events().publish(
        (Symbol::new(env, "fee_committed"),),
        (collector.clone(), bps),
    );
}

pub fn publish_merchant_added(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merchant_added"), merchant.clone()), ());
}

pub fn publish_merchant_removed(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merchant_removed"), merchant.clone()), ());
}

pub fn publish_merchant_frozen(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merchant_frozen"), merchant.clone()), ());
}

pub fn publish_merchant_unfrozen(env: &Env, merchant: &Address) {
    env.events().publish(
        (Symbol::new(env, "merchant_unfrozen"), merchant.clone()),
        (),
    );
}

pub fn publish_grace_period_proposed(env: &Env, seconds: u64) {
    env.events()
        .publish((Symbol::new(env, "grace_period_proposed"),), seconds);
}

pub fn publish_grace_period_committed(env: &Env, seconds: u64) {
    env.events()
        .publish((Symbol::new(env, "grace_period_committed"),), seconds);
}

pub fn publish_subscription_auto_resumed(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "subscription_auto_resumed"), user.clone()), ());
}

pub fn publish_migration_completed(env: &Env, version: u32, user_count: u32) {
    env.events().publish(
        (Symbol::new(env, "migration_completed"),),
        (version, user_count),
    );
}
