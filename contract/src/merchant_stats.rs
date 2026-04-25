use soroban_sdk::{Address, Env};

use crate::DataKey;

/// Returns the total revenue accumulated for a merchant.
pub fn get_merchant_revenue(env: &Env, merchant: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantRevenue(merchant.clone()))
        .unwrap_or(0i128)
}

/// Adds `amount` to the merchant's running revenue total.
pub fn increment_revenue(env: &Env, merchant: &Address, amount: i128) {
    let current = get_merchant_revenue(env, merchant);
    env.storage()
        .persistent()
        .set(&DataKey::MerchantRevenue(merchant.clone()), &(current + amount));
}
