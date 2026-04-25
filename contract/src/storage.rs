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
