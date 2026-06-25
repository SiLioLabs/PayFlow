use soroban_sdk::{Address, Env};

use crate::{DataKey, Subscription};

pub fn set_subscription(env: &Env, user: &Address, sub: &Subscription) {
    env.storage()
        .persistent()
        .set(&DataKey::Subscription(user.clone()), sub);
}

pub fn get_subscription(env: &Env, user: &Address) -> Option<Subscription> {
    env.storage()
        .persistent()
        .get(&DataKey::Subscription(user.clone()))
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Token)
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set")
}

pub fn get_admin_optional(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn is_contract_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ContractPaused)
        .unwrap_or(false)
}

pub fn set_contract_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::ContractPaused, &paused);
}
