/// Bounded slot-scan helper for subscriber index readers.
///
/// All three public reader functions — `get_subscriber_page`,
/// `get_next_charge_batch`, and `get_active_subscriber_page` — share the same
/// low-level mechanics: compute the scan window from `offset` and `limit`,
/// look up the total index size, read each `SubscriberIndex` slot, and skip
/// tombstoned entries.  Before this module those three blocks were copy-pasted;
/// now they all call [`scan_subscriber_slots`] and apply their own filter on
/// the returned addresses.
///
/// # What the helper owns
/// - Total subscriber count lookup (`SubscriberIndexSize`).
/// - Per-slot `SubscriberIndex` reads.
/// - Tombstone skipping (`SubscriberIndexRemoved`).
/// - Window bounds: `[offset, min(offset + limit, size))`.
///
/// # What stays at each call site
/// - The effective-page-size / cap computation (callers differ: the two `*_page`
///   functions clamp silently, `get_next_charge_batch` panics on over-limit).
/// - Per-address subscription filtering (active-only, due-for-charge, etc.).
use soroban_sdk::{Address, Env, Vec};

use crate::{subscription_count, DataKey};

/// Scans subscriber index slots in the window `[offset, offset + limit)`,
/// bounded by the total index size, skipping tombstoned slots.
///
/// Returns the resolved `Address` for every live (non-tombstoned) slot in the
/// window.  Callers apply their own per-address filter on the returned list.
///
/// Returns an empty `Vec` when `offset >= total_size` or `limit == 0`.
pub(crate) fn scan_subscriber_slots(env: &Env, offset: u64, limit: u64) -> Vec<Address> {
    let size = subscription_count::get_subscriber_index_size(env);
    let mut result = Vec::new(env);

    if limit == 0 || offset >= size {
        return result;
    }

    let end = (offset + limit).min(size);
    let mut i = offset;
    while i < end {
        if !subscription_count::is_subscriber_index_removed(env, i) {
            if let Some(addr) = env
                .storage()
                .persistent()
                .get::<DataKey, Address>(&DataKey::SubscriberIndex(i))
            {
                result.push_back(addr);
            }
        }
        i += 1;
    }
    result
}
