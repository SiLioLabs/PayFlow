use soroban_sdk::{BytesN, Env};

use crate::{admin, errors::ContractError, events, DataKey};

pub const PENDING_UPGRADE_TTL_LEDGERS: u32 = 17280;

pub fn propose_upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
    admin::require_admin(env);
    env.storage()
        .temporary()
        .set(&DataKey::PendingUpgrade, &new_wasm_hash);
    env.storage()
        .temporary()
        .extend_ttl(
            &DataKey::PendingUpgrade,
            PENDING_UPGRADE_TTL_LEDGERS,
            PENDING_UPGRADE_TTL_LEDGERS,
        );
    events::publish_upgrade_proposed(env, &new_wasm_hash);
}

pub fn cancel_pending_upgrade(env: &Env) {
    admin::require_admin(env);
    env.storage().temporary().remove(&DataKey::PendingUpgrade);
    events::publish_upgrade_cancelled(env);
}

pub fn commit_upgrade(env: &Env) {
    admin::require_admin(env);
    let pending_hash: BytesN<32> = env
        .storage()
        .temporary()
        .get(&DataKey::PendingUpgrade)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoPendingProposal));

    env.storage().temporary().remove(&DataKey::PendingUpgrade);

    #[cfg(not(test))]
    env.deployer()
        .update_current_contract_wasm(pending_hash.clone());

    events::publish_upgraded(env, &pending_hash);
}

/// Returns the WASM hash queued for the next upgrade, or `None` if no upgrade
/// is pending.
///
/// No auth required — this is a view-only read of temporary storage.
pub fn get_pending_upgrade(env: &Env) -> Option<BytesN<32>> {
    env.storage().temporary().get(&DataKey::PendingUpgrade)
}

#[cfg(test)]
pub fn upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
    // Keep direct upgrade available for the test environment
    events::publish_upgraded(env, &new_wasm_hash);
}
