use crate::errors::ContractError;
use crate::events;
use crate::storage::{get_admin, set_admin};
use crate::DataKey;
use soroban_sdk::{Address, Env};

pub fn require_admin(env: &Env) {
    let admin = get_admin(env);
    admin.require_auth();
}

/// Authorize the emergency operator when one is configured, otherwise the admin.
///
/// Soroban exposes no implicit invoker, so the contract cannot tell which of
/// the two signed a call. While an operator is set it is the required signer;
/// the admin keeps ultimate control because only the admin can clear or
/// replace the operator via `set_operator`.
pub fn require_operator_or_admin(env: &Env) {
    let operator: Option<Address> = env.storage().instance().get(&DataKey::Operator);
    match operator {
        Some(operator) => operator.require_auth(),
        None => get_admin(env).require_auth(),
    }
}

/// Authorize `admin` and persist it as the sole contract admin.
///
/// Called from `initialize` *before* the default token is stored so deploy
/// scripts cannot observe a token-configured / admin-missing split state.
/// Auth is required; this does not add a second admin.
pub fn initialize_admin(env: &Env, admin: &Address) {
    admin.require_auth();
    set_admin(env, admin);
}

/// Step 1: current admin proposes a new admin.
/// The proposed address must call accept_admin() to complete the transfer.
pub fn transfer_admin(env: &Env, new_admin: &Address) -> Result<(), ContractError> {
    let current_admin = get_admin(env);
    current_admin.require_auth();
    if new_admin == &current_admin || new_admin == &env.current_contract_address() {
        return Err(ContractError::InvalidAdminAddress);
    }
    env.storage()
        .instance()
        .set(&DataKey::PendingAdmin, new_admin);
    events::publish_admin_transfer_proposed(env, new_admin);
    Ok(())
}

/// Returns the currently proposed admin awaiting `accept_admin()`, if any.
pub fn get_pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAdmin)
}

/// Step 2: proposed new admin accepts and becomes the active admin.
///
/// Returns `ContractError::NoPendingAdmin` when no transfer is staged,
/// allowing callers to handle the case without an untrappable host panic.
pub fn accept_admin(env: &Env) -> Result<(), ContractError> {
    let pending: Address = env
        .storage()
        .instance()
        .get(&DataKey::PendingAdmin)
        .ok_or(ContractError::NoPendingAdmin)?;
    pending.require_auth();

    let old_admin = get_admin(env);
    set_admin(env, &pending);
    env.storage().instance().remove(&DataKey::PendingAdmin);
    events::publish_admin_transferred(env, &old_admin, &pending);
    Ok(())
}
