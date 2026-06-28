use soroban_sdk::{BytesN, Env};

use crate::{admin, errors::ContractError, events, DataKey};

pub fn propose_upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
    admin::require_admin(env);
    env.storage().temporary().set(&DataKey::PendingUpgrade, &new_wasm_hash);
    env.storage().temporary().extend_ttl(&DataKey::PendingUpgrade, 17280, 17280);
    events::publish_upgrade_proposed(env, &new_wasm_hash);
}

pub fn commit_upgrade(env: &Env) {
    admin::require_admin(env);
    let pending_hash: BytesN<32> = env
        .storage()
        .temporary()
        .get(&DataKey::PendingUpgrade)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoPendingProposal));

    env.storage().temporary().remove(&DataKey::PendingUpgrade);
use crate::events;

    #[cfg(not(test))]
    env.deployer()
        .update_current_contract_wasm(pending_hash.clone());

    events::publish_upgraded(env, &pending_hash);
}

#[cfg(test)]
pub fn upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
    // Keep direct upgrade available for the test environment
    events::publish_upgraded(env, &new_wasm_hash);
}
