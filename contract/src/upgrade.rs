use soroban_sdk::{BytesN, Env};

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
