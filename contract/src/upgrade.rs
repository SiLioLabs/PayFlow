use soroban_sdk::{Address, Env};

use crate::{DataKey, Subscription};

pub fn has_token(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Token)
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Token)
}

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
