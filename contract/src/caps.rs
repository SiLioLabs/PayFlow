//! Centralized batch and page cap constants with typed helpers.
//!
//! Every read/write path that bounds a batch or a page size must source its
//! limit from this module so the operator-facing guarantees stay consistent
//! and cannot drift between entrypoints (e.g. estimate vs. live charge).
//!
//! The operator-facing table built from these constants lives in
//! `docs/limits.md`. If you change a value here, update that table in the
//! same commit; `node scripts/emit-caps-table.mjs --check` fails the build's
//! doc check if the two disagree.
//!
//! These values are re-exported at the crate root (`crate::MAX_BATCH_SIZE`,
//! `crate::MAX_BATCH_SIZE_CEILING`, ...) so entrypoints can keep using the
//! short paths they have always used.

/// Default cap for the admin batch charge/cancel/pause entrypoints.
///
/// Re-exported as `crate::MAX_BATCH_SIZE`, which is what `batch.rs` and the
/// existing call sites refer to.
pub const DEFAULT_BATCH_SIZE: u32 = 50;

/// Hard ceiling shared by every admin-configurable batch limit. Configured
/// limits are never allowed above this value, so batches stay bounded even if
/// an admin key is compromised.
pub const MAX_BATCH_SIZE_CEILING: u32 = 200;

/// Cap for the admin cancel/pause batch entrypoints.
pub const MAX_BATCH_PAUSE_SUBSCRIPTIONS: u32 = 25;

/// Default cap for the admin whitelist batch entrypoints. Overridable at
/// runtime via `set_max_whitelist_batch_size`, bounded by
/// [`MAX_BATCH_SIZE_CEILING`].
pub const MAX_WHITELIST_BATCH_SIZE: u32 = 50;

/// Cap for the admin merchant-subscriber-count batch entrypoint
/// (`get_merchant_sub_counts`).
pub const MAX_MERCHANT_SUB_COUNT_BATCH: u32 = 50;

/// Page size cap for the subscriber-listing entrypoints
/// (`get_subscriber_page`, `get_active_subscriber_page`, `get_next_charge_batch`).
///
/// The two `*_page` readers clamp silently; `get_next_charge_batch` panics
/// `BatchTooLarge`. All three use the same number, so it lives here.
pub const SUBSCRIBER_PAGE_SIZE: u32 = 50;

/// Page size for per-day merchant revenue queries.
pub const REVENUE_DAY_PAGE_SIZE: u32 = 30;

/// Page size for the top-merchants ranking query.
pub const TOP_MERCHANTS_PAGE_SIZE: u32 = 20;

/// Clamp a configured batch limit to the shared hard ceiling.
///
/// Returns `DEFAULT_BATCH_SIZE` when no override is configured, otherwise the
/// configured value bounded by [`MAX_BATCH_SIZE_CEILING`].
pub fn effective_batch_size(configured: Option<u32>) -> u32 {
    match configured {
        Some(size) => {
            if size > MAX_BATCH_SIZE_CEILING {
                MAX_BATCH_SIZE_CEILING
            } else {
                size
            }
        }
        None => DEFAULT_BATCH_SIZE,
    }
}

/// Clamp a configured whitelist batch limit to the shared hard ceiling.
///
/// Returns [`MAX_WHITELIST_BATCH_SIZE`] when no override is configured.
pub fn effective_whitelist_batch_size(configured: Option<u32>) -> u32 {
    match configured {
        Some(size) => {
            if size > MAX_BATCH_SIZE_CEILING {
                MAX_BATCH_SIZE_CEILING
            } else {
                size
            }
        }
        None => MAX_WHITELIST_BATCH_SIZE,
    }
}

/// Clamp a requested page size to a page cap, falling back to the cap when the
/// caller does not specify one.
pub fn effective_page_size(requested: Option<u32>, cap: u32) -> u32 {
    match requested {
        Some(size) => {
            if size > cap {
                cap
            } else {
                size
            }
        }
        None => cap,
    }
}

/// Returns the effective max batch size from instance storage, defaulting to
/// `DEFAULT_BATCH_SIZE` when no override has been configured.
pub fn get_max_batch_size(env: &soroban_sdk::Env) -> u32 {
    env.storage()
        .instance()
        .get(&crate::DataKey::MaxBatchSize)
        .unwrap_or(DEFAULT_BATCH_SIZE)
}
