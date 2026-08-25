use crate::events;
use crate::storage::{get_admin, set_admin};
use crate::DataKey;
use soroban_sdk::{Address, Env};

pub fn require_admin(env: &Env) {
    let admin = get_admin(env);
    admin.require_auth();
}

pub fn initialize_admin(env: &Env, admin: &Address) {
    admin.require_auth();
    set_admin(env, admin);
}

/// Step 1: current admin proposes a new admin.
/// The proposed address must call accept_admin() to complete the transfer.
pub fn transfer_admin(env: &Env, new_admin: &Address) {
    let current_admin = get_admin(env);
    current_admin.require_auth();
    env.storage()
        .instance()
        .set(&DataKey::PendingAdmin, new_admin);
}

/// Returns the currently proposed admin awaiting `accept_admin()`, if any.
pub fn get_pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAdmin)
}

/// Step 2: proposed new admin accepts and becomes the active admin.
pub fn accept_admin(env: &Env) {
    let pending: Address = env
        .storage()
        .instance()
        .get(&DataKey::PendingAdmin)
        .expect("no pending admin");
    pending.require_auth();

    let old_admin = get_admin(env);
    set_admin(env, &pending);
    env.storage().instance().remove(&DataKey::PendingAdmin);
    events::publish_admin_transferred(env, &old_admin, &pending);
}
