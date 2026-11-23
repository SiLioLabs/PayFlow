# Storage and TTL Management Architecture

This document is the **canonical, exhaustive** reference for FlowPay storage: every `DataKey` variant, the value it holds, which Soroban storage tier it uses, how TTL is managed, and which contract functions read or write it. [ARCHITECTURE.md](../ARCHITECTURE.md#storage-strategy) carries only a high-level summary and links here for the full per-key breakdown — when the two disagree, this document wins.

Stellar's Soroban platform archives unused state to limit ledger growth. Contributors who add keys or touch lifecycle code must choose the correct tier and TTL policy so data neither vanishes unexpectedly nor permanently bloats the ledger.

Source of truth: `DataKey` in [`contract/src/lib.rs`](../../contract/src/lib.rs). Cross-check public entry points in [API.md](../API.md).

Rent estimation: [`get_storage_footprint(user)`](../API.md#get_storage_footprint) enumerates every per-subscriber key below (subscription, referral, metadata, charge history, subscriber-index slot, pause expiry, last charge, last skip, and the temporary daily-limit keys) with presence flags. `storage::PER_USER_STORAGE_KEY_COUNT` and `test_storage_footprint_covers_every_per_user_key` fail the suite when a new per-user key is added without extending the footprint.

---

## 1. Soroban storage tiers

FlowPay uses all three Soroban tiers.

| Storage tier   | Lifecycle                     | When expired                                           | Use in FlowPay                                                         |
| :------------- | :---------------------------- | :----------------------------------------------------- | :--------------------------------------------------------------------- |
| **Instance**   | Tied to the contract instance | Contract becomes unusable until instance TTL is bumped | Protocol-wide config, admin, counters, pause flags                     |
| **Persistent** | Per-key                       | Archived (evicted); can be restored for a fee          | Long-lived per-user / per-merchant state that must not be lost forever |
| **Temporary**  | Per-key                       | **Permanently deleted**; not restorable                | Daily spending caps and short-lived two-step proposals                 |

### When to use each tier

- **Instance** — one shared value for the whole deployment (token default, admin, fee bps, global pause). All instance keys share one TTL budget; FlowPay bumps it via `bump_instance_ttl` / related helpers on mutating paths.
- **Persistent** — anything that must survive idle periods and remain recoverable after archival (subscriptions, revenue, whitelist flags, charge history). Prefer explicit `extend_ttl` on write or on critical reads.
- **Temporary** — values that are safe to forget: daily spend windows that reset naturally, and pending propose/commit payloads that expire if never committed. Never store irreplaceable audit data here.

---

## 2. TTL constants

| Constant / literal          | Value (ledgers) | Approx. time (5s ledgers) | Used for                                                                                             |
| :-------------------------- | --------------: | :------------------------ | :--------------------------------------------------------------------------------------------------- |
| `SUBSCRIPTION_TTL_LEDGERS`  |     `6_307_200` | ~1 year                   | Subscriptions, metadata, charge history, fee recipient, subscriber index slots; instance bump target |
| Merchant-stats literal      |     `1_555_200` | ~90 days                  | Merchant revenue, day buckets, revenue history, merchant sub counts                                  |
| `LEDGERS_PER_DAY` / `17280` |        `17_280` | ~24 hours                 | Daily limit keys; `PendingFee` / `PendingGracePeriod` / `PendingUpgrade`                             |

Subscription persistent keys typically use threshold `SUBSCRIPTION_TTL_LEDGERS / 2` and extend-to `SUBSCRIPTION_TTL_LEDGERS` (see `storage::extend_subscription_ttl`). Some keys bump with full/full. Temporary keys usually extend with threshold = extend-to = `17_280`.

---

## 3. Complete DataKey reference

Every variant declared in the `DataKey` enum in `contract/src/lib.rs` is listed below — this is the exhaustive per-key reference; [ARCHITECTURE.md](../ARCHITECTURE.md#storage-strategy) only summarizes it. “None” under TTL policy means no explicit `extend_ttl` call was found for that key — it relies on network defaults and risks archival if never bumped. When adding a variant, append a row here (count check: `cd contract && grep -c "^    [A-Z][A-Za-z]*(" src/lib.rs` reports the parameterized variants; unit variants have no parentheses).

| DataKey                            | Value type                                                        | Storage tier | TTL policy                                                                 | Written by                                                                                                                                                                                                                | Read by                                                                                                                              |
| :--------------------------------- | :---------------------------------------------------------------- | :----------- | :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------- |
| `Subscription(Address)`            | `Subscription`                                                    | persistent   | `extend_ttl` ~½→1 year via `extend_subscription_ttl` / `bump_subscription` | `subscribe`, `subscribe_with_metadata`, `charge` / `batch_charge`, `cancel*`, `pause*`, `resume`, `batch_pause_subscriptions`, `set_subscription_amount`, `set_subscription_interval`, `transfer_subscription`, `migrate` | `get_subscription`, charge / PPU / cancel / pause / resume / next-charge helpers, `migrate`, and other flows that load the sub first |
| `Token`                            | `Address`                                                         | instance     | Shares instance TTL (`bump_instance_ttl`)                                  | `initialize`                                                                                                                                                                                                              | `get_token`, `contract_health_check`                                                                                 |
| `Admin`                            | `Address`                                                         | instance     | Shares instance TTL                                                        | `initialize` → `admin::initialize_admin`, `accept_admin`, `set_initial_admin`                                                                                                                                             | `get_admin`, `admin::require_admin` callers, `accept_admin`, `contract_health_check`                                                 |
| `GracePeriod`                      | `u64`                                                             | instance     | Instance bump on read/commit                                               | `commit_grace_period`                                                                                                                                                                                                     | `get_grace_period`, `charge`, `batch_charge`, `is_charge_due`, `get_protocol_stats`                                                  |
| `MerchantWhitelist(Address)`       | `bool` (presence = whitelisted)                                   | persistent   | `extend_ttl(1_555_200, 1_555_200)` on add                                  | `add_merchant`, `whitelist_batch_add`; removed by `remove_merchant` / `whitelist_batch_remove`                                                                                                                            | `is_merchant_whitelisted`, `subscribe*`, `pay_per_use_to`                                                                            |
| `WhitelistEnabled`                 | `bool`                                                            | instance     | Shares instance TTL                                                        | `set_whitelist_enabled`                                                                                                                                                                                                   | `is_whitelist_enabled`, `subscribe*`, `pay_per_use_to`, `get_protocol_stats`                                                         |
| `WhitelistIndex(u32)`              | `Address`                                                         | persistent   | `extend_ttl(1_555_200, 1_555_200)` on write / swap-remove                  | `add_merchant`, `whitelist_batch_add`; last slot swap-removed by `remove_merchant` / `whitelist_batch_remove`                                                                                                             | `get_whitelist_page`, `remove_merchant` (slot lookup + legacy scan)                                                                  |
| `WhitelistIndexSize`               | `u32`                                                             | persistent   | `extend_ttl(1_555_200, 1_555_200)` on inc/dec                              | `add_merchant` / `whitelist_batch_add` (+1); `remove_merchant` / `whitelist_batch_remove` (−1)                                                                                                                           | `get_whitelist_size` (public), `get_whitelist_page`, `add_merchant`, `remove_merchant`                                               |
| `WhitelistIndexSlot(Address)`      | `u32`                                                             | persistent   | `extend_ttl(1_555_200, 1_555_200)` on write / moved-slot rewrite           | `add_merchant`; moved entry rewritten by `remove_merchant`; removed by `remove_merchant`                                                                                                                                  | `remove_merchant` (O(1) slot lookup; legacy entries fall back to scan)                                                               |
| `MerchantFrozen(Address)`          | `bool` (presence = frozen)                                        | persistent   | `extend_ttl(1_555_200, 1_555_200)` on freeze                               | `freeze_merchant`; removed by `unfreeze_merchant`                                                                                                                                                                         | `is_merchant_frozen`, `subscribe*`                                                                                                   |
| `MerchantFreezeReason(Address)`    | `String` (max 128 bytes)                                          | persistent   | `extend_ttl(1_555_200, 1_555_200)` on freeze                               | `freeze_merchant` (when `Some(reason)`); removed by `unfreeze_merchant`                                                                                                                                                  | `get_merchant_freeze_reason` → `whitelist::get_freeze_reason`                                                                        |
| `FeeCollector`                     | `Address`                                                         | instance     | Shares instance TTL                                                        | `commit_fee`; removed by `clear_fee`                                                                                                                                                                                      | `get_fee`, `get_fee_collector`, `get_protocol_stats`, fee transfers in charge / PPU                                                  |
| `FeeBps`                           | `u32`                                                             | instance     | Shares instance TTL                                                        | `commit_fee`; removed by `clear_fee`                                                                                                                                                                                      | `get_fee`, `get_protocol_stats`, fee transfers                                                                                       |
| `MinFeeBps`                        | `u32`                                                             | instance     | Shares instance TTL                                                        | `set_fee_bounds`                                                                                                                                                                                                          | `get_fee_bounds` (default `0`); `commit_fee` (bounds re-check at commit)                                                             |
| `MaxFeeBps`                        | `u32`                                                             | instance     | Shares instance TTL                                                        | `set_fee_bounds`                                                                                                                                                                                                          | `get_fee_bounds` (default `10_000`); `commit_fee` (bounds re-check at commit)                                                        |
| `TotalProtocolFees`                | `i128`                                                           | instance     | Shares instance TTL                                                        | fee transfer in charge / batch_charge / pay_per_use* → `accumulate_protocol_fees`                                                                                                                                        | `get_total_protocol_fees` (public); same accumulate path                                                                             |
| `ActiveCount`                      | `u64`                                                             | instance     | Shares instance TTL                                                        | `subscribe*` (inc), `cancel*` (dec)                                                                                                                                                                                       | `get_active_count`, `get_protocol_stats`, `contract_health_check`                                                                    |
| `MerchantRevenue(Address)`         | `i128`                                                            | persistent   | `extend_ttl(1_555_200, 1_555_200)` on write                                | charge / PPU → `increment_revenue*`; `reset_merchant_revenue`                                                                                                                                                             | `get_merchant_revenue`                                                                                                               |
| `MerchantRevenueDay(Address, u64)` | `i128`                                                            | persistent   | `extend_ttl(1_555_200, 1_555_200)` on write / `bump_merchant_revenue_day`  | `increment_revenue_with_daily`; removed by `prune_merchant_revenue_days`                                                                                                                                                  | `get_merchant_revenue_day`, `bump_merchant_revenue_day`                                                                              |
| `MerchantRevenueDayIndex(Address)` | `Vec<u64>` (Unix day numbers; max 90 retained)                   | persistent   | `extend_ttl(1_555_200, 1_555_200)` on write                                | `increment_revenue_with_daily` (new day); `prune_merchant_revenue_days` (compaction); `reset_merchant_revenue` (emptied)                                                                                                  | `get_merchant_revenue_day_page`, `prune_merchant_revenue_days`, `reset_merchant_revenue`                                             |
| `DailyLimit(Address)`              | `i128`                                                            | temporary    | `extend_ttl(17_280, 17_280)` on set                                        | `set_daily_limit`; removed by `remove_daily_limit`                                                                                                                                                                        | `get_daily_limit`, `pay_per_use*` → `enforce_limit`                                                                                  |
| `DailySpent(Address)`              | `i128`                                                            | temporary    | `extend_ttl(17_280, 17_280)` on `record_spend`                             | `pay_per_use*` → `record_spend`; removed by `remove_daily_limit`                                                                                                                                                          | `get_daily_spent`, `enforce_limit` / `record_spend`                                                                                  |
| `DayStart(Address)`                | `()` unit marker                                                  | temporary    | `extend_ttl(17_280, 17_280)` on first spend of day                         | `record_spend` (if absent); removed by `remove_daily_limit`                                                                                                                                                               | `get_daily_spent`, `record_spend` (`temporary().has`)                                                                                |
| `Referral(Address)`                | `Address`                                                         | persistent   | `extend_ttl` ~½→1 year on store / read / transfer                          | `subscribe*` → `store_referral`; removed on `cancel*`; moved on `transfer_subscription`                                                                                                                                   | `get_referrer` (re-bumps TTL on read)                                                                                                |
| `SchemaVersion`                    | `u32`                                                             | instance     | Shares instance TTL                                                        | `migrate` (sets current schema version)                                                                                                                                                                                   | `get_schema_version`, `migrate`, `get_protocol_stats`, `contract_health_check` (defaults to `1` if unset)                            |
| `SubscriptionMeta(Address)`        | `String` (max 64 bytes)                                           | persistent   | `extend_ttl` ~1 year on set                                                | `set_metadata`, `subscribe_with_metadata`; removed by `clear_metadata`                                                                                                                                                    | `get_metadata`, `get_subscription_label`                                                                                             |
| `ChargeHistory(Address)`           | `Vec<u64>` (rolling, max 12)                                      | persistent   | `extend_ttl` ~½→1 year on record                                           | charge → `record_charge`; removed by `clear_charge_history` / `prune_charge_history`                                                                                                                                      | `get_charge_history`, `get_charge_history_page`                                                                                      |
| `GlobalVolumeWindow`               | `GlobalVolumeWindow { current_window_start, accumulated_volume }` | instance     | Shares instance TTL                                                        | charge / PPU → `check_and_update_global_volume`                                                                                                                                                                           | `get_global_volume_window`, `contract_health_check`, same check-and-update path                                                      |
| `GlobalVolumeCapOverride`          | `i128`                                                           | instance     | Shares instance TTL                                                        | `set_global_volume_cap`                                                                                                                                                                                                   | `effective_global_volume_cap` → `get_global_volume_cap`, `check_and_update_global_volume` (charge / PPU), `contract_health_check`     |
| `MaxBatchSize`                     | `u32`                                                             | instance     | Shares instance TTL                                                        | `set_max_batch_size`                                                                                                                                                                                                      | `get_max_batch_size`, `batch_charge` (default `50` if unset)                                                                         |
| `MaxWhitelistBatchSize`            | `u32`                                                             | instance     | Shares instance TTL                                                        | `set_max_whitelist_batch_size`                                                                                                                                                                                            | `get_max_whitelist_batch_size`, `whitelist_batch_add` / `whitelist_batch_remove` / `get_merchant_statuses` (default `50` if unset)   |
| `ContractPaused`                   | `bool`                                                            | instance     | Shares instance TTL                                                        | `pause_contract`, `unpause_contract`                                                                                                                                                                                      | `is_contract_paused`, `get_protocol_stats`, `subscribe*`, `ensure_contract_not_paused`, `contract_health_check`                      |
| `MinInterval`                      | `u64`                                                             | instance     | Shares instance TTL                                                        | `set_min_interval`                                                                                                                                                                                                        | `get_min_interval`, `subscribe*` (default `3600` if unset)                                                                           |
| `MerchantRevenueHistory(Address)`  | `Vec<i128>`                                                       | persistent   | `extend_ttl(1_555_200, 1_555_200)` on append                               | `increment_revenue_with_daily`; removed by `clear_merchant_revenue_history`                                                                                                                                               | `get_merchant_revenue_history`                                                                                                       |
| `SubscriberIndex(u64)`             | `Address`                                                         | persistent   | `extend_ttl` ~1 year on append                                             | `subscribe*` → `append_subscriber_index`                                                                                                                                                                                  | `get_subscriber_at`, `get_subscriber_page`                                                                                           |
| `SubscriberIndexSize`              | `u64`                                                             | persistent   | `extend_ttl(SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS)` on append (`append_subscriber_index`, issue #1010) and by the admin-only `extend_subscriber_index_ttl` entrypoint, which also re-bumps every `SubscriberIndex` slot in the same call | `append_subscriber_index`; `clear_subscriber_index_entry` (also opportunistically re-bumps size TTL)                                                                                                                     | `get_subscriber_count`, `get_subscriber_page`, `append_subscriber_index`, `extend_subscriber_index_ttl`                               |
| `SubscriberIndexSlot(Address)`     | `u64`                                                             | persistent   | `extend_ttl(SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS)` on append | `append_subscriber_index`, `transfer_subscriber_index`; removed by `remove_subscriber_index`, `clear_subscriber_index_entry`                                                                                             | `remove_subscriber_index`, `transfer_subscriber_index`, `clear_subscriber_index_entry`                                               |
| `SubscriberIndexRemoved(u64)`      | `bool` (presence = tombstoned)                                   | persistent   | None                                                                       | `remove_subscriber_index`, `clear_subscriber_index_entry`                                                                                                                                                                 | `is_subscriber_index_removed` → `get_subscriber_at`, `get_subscriber_page`, `get_next_charge_batch`, `get_active_subscriber_page`, `clear_subscriber_index_entry` |
| `MerchantSubCount(Address)`        | `u64`                                                             | persistent   | `extend_ttl(1_555_200, 1_555_200)` on inc/dec                              | `subscribe*` / `cancel*` → merchant sub count helpers                                                                                                                                                                     | `get_merchant_subscriber_count`, `get_merchant_sub_count`                                                                            |
| `MerchantIndex(u32)`               | `Address`                                                         | persistent   | `extend_ttl(1_555_200, 1_555_200)` on write / moved-slot rewrite           | `index_merchant`; last slot swap-removed by `unindex_merchant`                                                                                                                                                            | `get_merchant_page`, `get_top_merchants_by_subs`, `unindex_merchant`                                                                 |
| `MerchantIndexSize`                | `u32`                                                             | persistent   | `extend_ttl(1_555_200, 1_555_200)` on inc/dec                              | `index_merchant` (+1); `unindex_merchant` (−1)                                                                                                                                                                            | `get_merchant_index_size` → `get_merchant_page`, `get_top_merchants_by_subs`, `index_merchant`, `unindex_merchant`                   |
| `MerchantKnown(Address)`           | `bool` (presence = indexed)                                      | persistent   | `extend_ttl(1_555_200, 1_555_200)` on write                                | `index_merchant`; removed by `unindex_merchant`                                                                                                                                                                           | `index_merchant` (dedup check)                                                                                                       |
| `PendingMerchantRevCount`          | `u32`                                                             | instance     | Shares instance TTL                                                        | `increment_revenue` (first revenue crosses 0); decremented by `reset_merchant_revenue` (incl. the reset inside `withdraw_merchant_revenue`)                                                                               | `get_pending_merchant_rev_count` → `contract_health_check`                                                                           |
| `BillingState(Address)`            | `BillingState { last_charge: Option<LastChargeRecord { merchant, token, amount, fee, net, charged_at }>, last_skip_at: Option<u64> }` | persistent   | `extend_ttl` ~½→1 year on write                                            | `charge` / `batch_charge` → `set_last_charge`; `skip_next_charge` → `set_last_skip_at`; `refund_last_charge` clears `last_charge`                                                                                          | `refund_last_charge`, `skip_next_charge` (cooldown guard), `get_storage_footprint` (reports `last_charge` / `last_skip` logical entries) |
| `PendingAdmin`                     | `Address`                                                         | instance     | Shares instance TTL                                                        | `transfer_admin`; removed by `accept_admin`                                                                                                                                                                               | `accept_admin`                                                                                                                       |
| `PendingFee`                       | `(Address, u32)`                                                  | temporary    | `extend_ttl(17_280, 17_280)` on propose                                    | `propose_fee`; removed by `commit_fee`                                                                                                                                                                                    | `commit_fee`                                                                                                                         |
| `MerchantFeeRecipient(Address)`    | `Address`                                                         | persistent   | `extend_ttl` ~1 year on set                                                | `set_merchant_fee_recipient`                                                                                                                                                                                              | `get_merchant_fee_recipient`; fee transfer during charge                                                                             |
| `PendingGracePeriod`               | `u64`                                                             | temporary    | `extend_ttl(17_280, 17_280)` on propose                                    | `propose_grace_period`; removed by `commit_grace_period`                                                                                                                                                                  | `commit_grace_period`                                                                                                                |
| `PendingUpgrade`                   | `BytesN<32>`                                                      | temporary    | `extend_ttl(17_280, 17_280)` on propose                                    | `propose_upgrade`; removed by `commit_upgrade`                                                                                                                                                                            | `commit_upgrade`                                                                                                                     |
| `PauseExpiry(Address)`             | `u64`                                                             | persistent   | Co-bumped ~½→1 year alongside `Subscription` key via `storage::extend_subscription_ttl` (called on `charge`, `batch_charge`, `resume`, and the public `extend_subscription_ttl` entrypoint). Write paths (`pause`, `pause_until`) do NOT call `extend_ttl` — the key is kept alive by the first subsequent charge or explicit TTL extension. If `PauseExpiry` archives while the subscription survives, bounded-pause auto-resume silently breaks. See `storage::extend_subscription_ttl` source comment and [Pause Lifecycle](PAUSE-LIFECYCLE.md). | `pause` (`u64::MAX`), `pause_until`; removed by `resume` / auto-resume in charge                                                                                                                                          | `charge` / `batch_charge` → `try_auto_resume` (no public getter). See [Pause Lifecycle](PAUSE-LIFECYCLE.md) for full expiry semantics. |

```mermaid
graph TD
    DataKey[DataKey enum] --> Instance[Instance]
    DataKey --> Persistent[Persistent]
    DataKey --> Temporary[Temporary]

    subgraph Instance
        Token
        Admin
        GracePeriod
        WhitelistEnabled
        FeeCollector
        FeeBps
        MinFeeBps
        MaxFeeBps
        TotalProtocolFees
        ActiveCount
        SchemaVersion
        GlobalVolumeWindow
        GlobalVolumeCapOverride
        MaxBatchSize
        MaxWhitelistBatchSize
        ContractPaused
        MinInterval
        PendingAdmin
        PendingMerchantRevCount
    end

    subgraph Persistent
        Subscription
        MerchantWhitelist
        WhitelistIndex
        WhitelistIndexSize
        WhitelistIndexSlot
        MerchantFrozen
        MerchantFreezeReason
        MerchantRevenue
        MerchantRevenueDay
        MerchantRevenueDayIndex
        MerchantRevenueHistory
        MerchantSubCount
        MerchantIndex
        MerchantIndexSize
        MerchantKnown
        Referral
        SubscriptionMeta
        ChargeHistory
        SubscriberIndex
        SubscriberIndexSize
        SubscriberIndexSlot
        SubscriberIndexRemoved
        MerchantFeeRecipient
        PauseExpiry
    end

    subgraph Temporary
        DailyLimit
        DailySpent
        DayStart
        PendingFee
        PendingGracePeriod
        PendingUpgrade
    end
```

---

## 4. TTL management strategy

1. **Instance** — `bump_instance_ttl` runs on mutating entrypoints (`initialize`, `charge`, `pay_per_use`, `cancel`, `pause*` / `resume`, fee/grace propose/commit, whitelist updates, `batch_charge`, subscribe path). Grace get/commit and `extend_subscription_ttl` also refresh instance TTL. (Unlike an earlier short summary that suggested only automatic bumps, the contract **does** call `instance().extend_ttl(...)` explicitly.)
2. **Subscription family** — ~1 year via `SUBSCRIPTION_TTL_LEDGERS` on subscribe, charge, and the public `extend_subscription_ttl` entrypoint for keepers/idle subs.
3. **Merchant revenue family** — ~90 days (`1_555_200`) on write; day buckets can be refreshed with `bump_merchant_revenue_day`.
4. **Temporary day / pending proposals** — ~1 day (`17_280`).
5. **No explicit TTL on write** — `SubscriberIndexRemoved` tombstones have no `extend_ttl` call on their write paths (`remove_subscriber_index`, `clear_subscriber_index_entry`) and rely on network defaults. `PauseExpiry` is bumped, but not on its own write path:
   - `PauseExpiry` is co-bumped by `extend_subscription_ttl` (charge, batch_charge, resume, the public entrypoint) — never by `pause` / `pause_until` themselves.
   - `SubscriberIndexSize` is bumped on every `append_subscriber_index` write (issue #1010) and again by the admin-only `extend_subscriber_index_ttl` entrypoint.

> [!NOTE]
> Keepers and integrators should monitor TTL of active subscriptions and call `extend_subscription_ttl` if a subscription is paused or idle for a long time, so the key does not archive.

---

## 5. Why temporary storage for DailyLimit

Daily spending limits are a **short-lived** guard on `pay_per_use`, not a permanent account setting.

- Caps live in temporary storage with a ~24-hour TTL (`LEDGERS_PER_DAY` = `17_280`).
- `DayStart` (unit) anchors the calendar window. When it expires, spend is treated as zero for a new day even if a stale `DailySpent` value were somehow present.
- Idle users do not leave permanent ledger entries for limits they no longer use.
- Expired temporary data is **gone forever** (cannot be restored like archived persistent data). That is intentional: daily-limit keys are operational controls, not a long-term archive — see [DAILY-LIMITS.md](../DAILY-LIMITS.md).

`set_daily_limit` writes and bumps TTL; `remove_daily_limit` clears `DailyLimit`, `DailySpent`, and `DayStart` together.

---

## 6. Implementation sketches

### Persistent subscription extension

```rust
fn extend_subscription_ttl(env: &Env, user: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::Subscription(user.clone()),
        SUBSCRIPTION_TTL_LEDGERS / 2,
        SUBSCRIPTION_TTL_LEDGERS,
    );
}
```

Called during subscribe, successful charge paths, and the public `extend_subscription_ttl` entrypoint.

### Temporary daily limit

```rust
const LEDGERS_PER_DAY: u32 = 17_280;

pub fn set_daily_limit(env: &Env, user: &Address, limit: i128) {
    let key = DataKey::DailyLimit(user.clone());
    env.storage().temporary().set(&key, &limit);
    env.storage()
        .temporary()
        .extend_ttl(&key, LEDGERS_PER_DAY, LEDGERS_PER_DAY);
}
```

---

## 7. Cross-references

| Area                       | Docs / APIs                                            |
| :------------------------- | :----------------------------------------------------- |
| Public function contracts  | [API.md](../API.md)                                    |
| Two-step `Pending*` flows  | [TWO-STEP-AUTH.md](./TWO-STEP-AUTH.md)                 |
| High-level storage table   | [ARCHITECTURE.md](../ARCHITECTURE.md#storage-strategy) |
| Daily limits product guide | [DAILY-LIMITS.md](../DAILY-LIMITS.md)                  |
| Pause lifecycle + PauseExpiry semantics | [PAUSE-LIFECYCLE.md](./PAUSE-LIFECYCLE.md) |

When adding a new `DataKey` variant: pick the tier deliberately, document TTL here, wire writers/readers, and update [API.md](../API.md) if a public getter/setter is exposed.

---

## 8. Archival risk and operator checklist

The following persistent keys are written without an immediate `extend_ttl` call on their **own** write path. They are kept alive by other code paths, but operators of idle deployments must ensure those paths fire regularly:

| Key                    | Kept alive by                                                     | Operator action if idle                                       |
| :--------------------- | :---------------------------------------------------------------- | :------------------------------------------------------------ |
| `PauseExpiry`          | `extend_subscription_ttl` (charge, batch_charge, resume, extend)  | Call `extend_subscription_ttl(user)` for each paused user     |
| `SubscriberIndexRemoved` | No bump on tombstone write — relies on network defaults         | Accept tombstone archival, or re-tombstone via `clear_subscriber_index_entry` if the slot must stay marked |

Keys previously listed here (`MerchantWhitelist`, `MerchantFrozen`, `Referral`, `SubscriberIndexSize`) now receive explicit `extend_ttl` calls on their write paths — see the table in §3.

> If `PauseExpiry` archives while the corresponding `Subscription` key survives, the subscription will not auto-resume on schedule — the keeper will see it as `Paused` indefinitely. See [PAUSE-LIFECYCLE.md](./PAUSE-LIFECYCLE.md#archival-risk) for details.
