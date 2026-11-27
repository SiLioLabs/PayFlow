//! Read-only view functions for the FlowPay contract (issue #1398).
//!
//! Pure getter logic that was previously inlined in the `#[contractimpl]` block
//! of `lib.rs` lives here as free functions. The public entrypoints in `lib.rs`
//! remain thin wrappers that delegate here, keeping the ABI unchanged.
//!
//! All functions in this module are side-effect-free; they do not write to
//! storage, emit events, or require auth.

use soroban_sdk::{Address, Env, Vec};

use crate::batch;
use crate::caps;
use crate::charge_exec;
use crate::fee;
use crate::grace;
use crate::merchant_stats;
use crate::migration;
use crate::min_interval;
use crate::spending_limit;
use crate::storage;
use crate::subscriber_scan;
use crate::subscription_count;
use crate::trial;
use crate::validation;
use crate::whitelist;
use crate::{
    effective_global_volume_cap, get_max_pause_seconds, is_contract_paused, ContractConfig,
    DailyLimitStatus, DataKey, GlobalVolumeWindow, HealthReport, ProtocolStats, SubscriptionHealth,
    SUBSCRIBER_PAGE_SIZE,
};

/// Returns the full configuration snapshot for the contract.
pub fn get_contract_config(env: &Env) -> ContractConfig {
    ContractConfig {
        fee_bps: fee::get_fee_bps(env),
        fee_collector: fee::get_fee_collector(env),
        grace_period: grace::get_grace_period(env),
        min_interval: min_interval::get_min_interval(env),
        max_batch_size: batch::get_max_batch_size(env),
        global_volume_cap: effective_global_volume_cap(env),
        whitelist_enabled: whitelist::is_whitelist_enabled(env),
        paused: is_contract_paused(env),
        schema_version: env
            .storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(1),
        max_pause_seconds: get_max_pause_seconds(env),
    }
}

/// Returns a composite health report for a user's subscription.
pub fn get_subscription_health(env: &Env, user: &Address) -> SubscriptionHealth {
    let sub = match storage::get_subscription(env, user) {
        Some(s) => s,
        None => {
            return SubscriptionHealth {
                active: false,
                charge_due: false,
                within_grace: false,
                has_sufficient_allowance: false,
                is_paused: false,
                trial_active: false,
                daily_limit_set: false,
                remaining_cycles: None,
            }
        }
    };

    let active = sub.active;
    let is_paused = sub.paused;
    let charge_due = is_charge_due(env, user);

    let next_charge = charge_exec::compute_next_charge_at(&sub);
    let now = env.ledger().timestamp();
    let grace = grace::get_grace_period(env);

    let within_grace = if let Some(next) = next_charge {
        // Mirror is_charge_due semantics exactly:
        // - when grace == 0 the charge is simply due (no grace window), so
        //   within_grace is true whenever a charge is due.
        // - when grace > 0 the subscriber is within the grace window when
        //   now is between next and next + grace_period (inclusive).
        now >= next && (grace == 0 || now <= next.saturating_add(grace))
    } else {
        false
    };

    let has_sufficient_allowance =
        validation::has_sufficient_allowance(env, user, &sub.token, sub.amount);

    let trial_active = trial::get_trial_end(env.clone(), user.clone()).is_some();
    let daily_limit_set = spending_limit::get_daily_limit(env, user).is_some();

    // Remaining cycles for fixed-term subscriptions (issue #1400).
    let remaining_cycles = storage::get_subscription_terms(env, user).and_then(|terms| {
        terms
            .max_cycles
            .map(|max| max.saturating_sub(terms.charges_made))
    });

    SubscriptionHealth {
        active,
        charge_due,
        within_grace,
        has_sufficient_allowance,
        is_paused,
        trial_active,
        daily_limit_set,
        remaining_cycles,
    }
}

/// Returns a health report covering the contract's configuration and state.
pub fn contract_health_check(env: &Env) -> HealthReport {
    let contract_paused = storage::is_contract_paused(env);
    let token_configured = storage::get_token(env).is_some();
    let admin_configured = storage::get_admin_optional(env).is_some();
    let fee_collector_set = fee::get_fee_collector(env).is_some();

    #[cfg(any(test, feature = "testutils"))]
    let instance_ttl_ledgers = {
        use soroban_sdk::testutils::storage::Instance as _;
        env.storage().instance().get_ttl()
    };
    #[cfg(not(any(test, feature = "testutils")))]
    let instance_ttl_ledgers = 100_000; // placeholder: get_ttl is not available on-chain

    let active_subscription_count = subscription_count::get_active_count(env);
    let schema_version = migration::get_schema_version(env);

    let window: Option<GlobalVolumeWindow> =
        env.storage().instance().get(&DataKey::GlobalVolumeWindow);
    let accumulated_volume = window.map(|w| w.accumulated_volume).unwrap_or(0);
    let cap = effective_global_volume_cap(env);

    let pct = if cap > 0 {
        ((accumulated_volume * 100) / cap) as u32
    } else {
        0
    };
    let global_volume_utilization_pct = if pct > 100 { 100 } else { pct };

    let pending_merchant_rev_count = merchant_stats::get_pending_merchant_rev_count(env);

    // Healthy when not paused and fully configured. Instance TTL is reported
    // separately and is not part of this decision (on-chain it is a constant).
    let is_healthy = !contract_paused && token_configured && admin_configured;

    HealthReport {
        is_healthy,
        contract_paused,
        token_configured,
        admin_configured,
        instance_ttl_ledgers,
        active_subscription_count,
        schema_version,
        fee_collector_set,
        global_volume_utilization_pct,
        pending_merchant_rev_count,
    }
}

/// Returns protocol-wide statistics.
pub fn get_protocol_stats(env: &Env) -> ProtocolStats {
    ProtocolStats {
        active_count: subscription_count::get_active_count(env),
        fee_bps: fee::get_fee_bps(env),
        fee_collector: fee::get_fee_collector(env),
        grace_period: grace::get_grace_period(env),
        whitelist_enabled: whitelist::is_whitelist_enabled(env),
        schema_version: migration::get_schema_version(env),
        contract_paused: env
            .storage()
            .instance()
            .get(&DataKey::ContractPaused)
            .unwrap_or(false),
    }
}

/// Returns the user's daily pay-per-use limit, today's spend, and what remains.
pub fn get_daily_limit_status(env: &Env, user: &Address) -> DailyLimitStatus {
    spending_limit::get_daily_limit_status(env, user)
}

/// Returns `true` when a charge is due now and still inside the grace window.
pub fn is_charge_due(env: &Env, user: &Address) -> bool {
    let sub = match storage::get_subscription(env, user) {
        Some(s) => s,
        None => return false,
    };
    let next = match charge_exec::compute_next_charge_at(&sub) {
        Some(n) => n,
        None => return false,
    };
    let now = env.ledger().timestamp();
    if now < next {
        return false;
    }
    let grace = grace::get_grace_period(env);
    grace == 0 || now <= next.saturating_add(grace)
}

/// Returns a page of subscribers whose subscription is currently active.
pub fn get_active_subscriber_page(env: &Env, offset: u64, limit: u32) -> Vec<Address> {
    let cap: u32 = caps::effective_page_size(Some(limit), SUBSCRIBER_PAGE_SIZE);
    // Delegate bounds, index reads, and tombstone skipping to the shared helper,
    // then apply the active-only filter at this call site.
    let candidates = subscriber_scan::scan_subscriber_slots(env, offset, cap as u64);
    let mut result = Vec::new(env);
    for addr in candidates.iter() {
        if let Some(sub) = storage::get_subscription(env, &addr) {
            // sub.active used intentionally: legacy `paused && !active` rows
            // must remain excluded from this page per the design in storage.rs
            // (`get_active_subscriber_page` lists current active subscriptions,
            // not all non-cancelled rows). See `storage::is_cancelled` for the
            // full semantics and `scenario_legacy_paused_inactive_row_reader_semantics`
            // for the regression that locks this invariant.
            if sub.active {
                result.push_back(addr);
            }
        }
    }
    result
}

/// Returns a page of all non-tombstoned subscriber index entries.
pub fn get_subscriber_page(env: &Env, offset: u64, limit: u32) -> Vec<Address> {
    let cap: u32 = caps::effective_page_size(Some(limit), SUBSCRIBER_PAGE_SIZE);
    // Delegate bounds, index reads, and tombstone skipping to the shared helper.
    // No per-address filter: this reader returns all non-tombstoned addresses.
    subscriber_scan::scan_subscriber_slots(env, offset, cap as u64)
}
