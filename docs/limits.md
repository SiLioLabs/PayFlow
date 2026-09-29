# Batch and Pagination Caps

One operator reference for every batch-size and page-size limit the FlowPay
contract enforces. Values are read from the constants in
[`contract/src/caps.rs`](../contract/src/caps.rs); if a number here disagrees
with that file, the file is right and this page is a bug.

**Related docs:**
[`API.md`](API.md) (per-endpoint signatures and errors) |
[`ERROR-CODES.md`](ERROR-CODES.md) (`BatchTooLarge` = 20, `InvalidBatchSize` = 29) |
[`DEPLOYMENT.md`](DEPLOYMENT.md) (post-deploy gates) |
[`DAILY-LIMITS.md`](DAILY-LIMITS.md) (per-user `pay_per_use` daily cap - a different topic) |
[`charge-results.md`](charge-results.md) (what a capped batch returns)

---

## Table of Contents

- [The constants](#the-constants)
- [Configurable limits](#configurable-limits)
- [Batch operations](#batch-operations)
- [Pagination](#pagination)
- [Uncapped read paths](#uncapped-read-paths)
- [Enforcement: panic vs silent clamp](#enforcement-panic-vs-silent-clamp)
- [Why the ceilings exist](#why-the-ceilings-exist)
- [Off-chain mirrors](#off-chain-mirrors)
- [Verifying this page](#verifying-this-page)
- [Related](#related)

---

## The constants

These are the only numbers in the contract that bound a batch or a page. Every
capped entrypoint below reads one of them, so this is the complete set.

| Constant                          | Value | Bounds                                        | Configurable at runtime |
| --------------------------------- | ----: | --------------------------------------------- | ---------------------- |
| `DEFAULT_BATCH_SIZE`              | 50    | `batch_charge`, `batch_extend_subscription_ttl` | Yes, via `set_max_batch_size` |
| `MAX_BATCH_SIZE_CEILING`          | 200   | Hard ceiling on the above, and on the whitelist batch | No - it is the ceiling |
| `MAX_BATCH_PAUSE_SUBSCRIPTIONS`   | 25    | `batch_cancel`, `batch_pause_subscriptions`   | No                     |
| `MAX_WHITELIST_BATCH_SIZE`        | 50    | `whitelist_batch_add` / `_remove`, `get_merchant_statuses` | Yes, via `set_max_whitelist_batch_size` |
| `MAX_MERCHANT_SUB_COUNT_BATCH`    | 50    | `get_merchant_sub_counts`                    | No                     |
| `SUBSCRIBER_PAGE_SIZE`            | 50    | `get_subscriber_page`, `get_active_subscriber_page`, `get_next_charge_batch` | No |
| `REVENUE_DAY_PAGE_SIZE`           | 30    | `get_merchant_revenue_day_page`              | No                     |
| `TOP_MERCHANTS_PAGE_SIZE`         | 20    | `get_top_merchants_by_subs`                  | No                     |

Two consequences worth internalising:

- **`DEFAULT_BATCH_SIZE` and `MAX_WHITELIST_BATCH_SIZE` are separate knobs.**
  They happen to both be 50. Raising one does nothing for the other.
- **`MAX_BATCH_SIZE_CEILING` is shared.** A configured batch limit can never
  exceed 200, for either knob. This is deliberate: it means a compromised admin
  key still cannot force an unbounded transaction.

## Configurable limits

Two of the constants above are defaults, not fixed values. An admin can change
the *effective* limit, but only within the ceiling.

| Knob                          | Storage key              | Getter                       | Setter                            | Default | Range        | Rejects `0`? |
| ----------------------------- | ------------------------ | ---------------------------- | --------------------------------- | ------- | ------------ | ------------ |
| Charge / extend batch size    | `DataKey::MaxBatchSize`  | `get_max_batch_size`         | `set_max_batch_size`              | 50      | 0 - 200      | **No** - see below |
| Whitelist batch size          | `DataKey::MaxWhitelistBatchSize` | `get_max_whitelist_batch_size` | `set_max_whitelist_batch_size` | 50      | 1 - 200      | Yes          |

Both setters are admin-only and panic with `InvalidBatchSize` (error 29) when
asked for more than 200.

**`set_max_batch_size(0)` is accepted and is a footgun.** Unlike the whitelist
setter, the charge-side setter does not reject zero, even though its own
codebase describes zero as the value that "would brick the admin batch
entrypoints". Once set to 0, every `batch_charge` call with a non-empty `users`
vector panics `BatchTooLarge`, and there is no way to recover except calling
`set_max_batch_size` again from a batch of size 0. Treat 1 as the practical
floor. This asymmetry is a known defect, not a documented feature.

## Batch operations

Every row here panics `BatchTooLarge` (error 20) when the input is over the cap.
"Same knob" means the limit is read from `get_max_batch_size`, so changing it
changes all the rows that share it.

| Entrypoint                     | Admin? | Effective cap                                   | Reads cap from                       |
| ------------------------------ | ------ | ----------------------------------------------- | ------------------------------------ |
| `batch_charge`                 | No     | `get_max_batch_size()` (default 50, max 200)    | `DataKey::MaxBatchSize`              |
| `batch_extend_subscription_ttl`| No     | `get_max_batch_size()` (default 50, max 200)    | `DataKey::MaxBatchSize`              |
| `batch_cancel`                 | Yes    | 25, fixed                                        | `MAX_BATCH_PAUSE_SUBSCRIPTIONS`      |
| `batch_pause_subscriptions`    | Yes    | 25, fixed                                        | `MAX_BATCH_PAUSE_SUBSCRIPTIONS`      |
| `get_batch_charge_estimate`    | No     | 200, fixed                                       | `MAX_BATCH_SIZE_CEILING`             |
| `whitelist_batch_add`          | Yes    | `get_max_whitelist_batch_size()` (default 50, max 200) | `DataKey::MaxWhitelistBatchSize` |
| `whitelist_batch_remove`       | Yes    | `get_max_whitelist_batch_size()` (default 50, max 200) | `DataKey::MaxWhitelistBatchSize` |
| `get_merchant_statuses`        | No     | `get_max_whitelist_batch_size()` (default 50, max 200) | `DataKey::MaxWhitelistBatchSize` |
| `get_merchant_sub_counts`      | No     | 50, fixed                                        | `MAX_MERCHANT_SUB_COUNT_BATCH`       |

Two rows surprise people:

- **`get_batch_charge_estimate` accepts 200 while `batch_charge` accepts 50 by
  default.** The estimate is capped at the hard ceiling and ignores the
  configured limit entirely. That is intentional: a dry run should not fail for
  a reason the real call would accept, or vice versa. It does mean you can get
  a clean estimate for a 200-address batch and then have the live charge reject
  it at 50.
- **Cancel and pause share the 25 cap, and both are admin-only.** Neither is
  configurable, and there is no `set_max_pause_batch_size`. `batch_charge` and
  `batch_extend_subscription_ttl` need no admin authorization, so a keeper can
  call them with the subscriber key alone; the pause/cancel pair is the
  opposite trade.

## Pagination

Read entrypoints. Every one of these takes an explicit `limit` (or `days`); none
of them has a default, so a caller must always pass one.

| Entrypoint                      | Argument  | Cap   | Over the cap            | Returns            |
| ------------------------------- | --------- | ----- | ----------------------- | ------------------ |
| `get_subscriber_page`           | `limit`   | 50    | Silently clamps to 50   | Up to 50 addresses |
| `get_active_subscriber_page`    | `limit`   | 50    | Silently clamps to 50   | Up to 50 addresses |
| `get_next_charge_batch`         | `limit`   | 50    | Panics `BatchTooLarge`  | Up to 50 addresses |
| `get_top_merchants_by_subs`     | `limit`   | 20    | Panics `BatchTooLarge`  | Up to 20 rows      |
| `get_merchant_revenue_day_page` | `limit`   | 30    | Panics `BatchTooLarge`  | Up to 30 `(day, amount)` pairs |
| `get_merchant_revenue_history`  | `days`    | none  | -                      | Whole history      |
| `get_whitelist_page`            | `limit`   | none  | -                      | Any number of rows |

Notes:

- `limit = 0` returns empty for every one of these; it is never an error.
- `get_top_merchants_by_subs` returns an empty list for `limit = 0` *before*
  touching the index, so it is cheap.
- `get_top_merchants_by_subs` iterates the whole merchant index regardless of
  `limit`. The cap bounds the output, not the work.
- `get_merchant_revenue_day_page` walks `offset` forward from the start of the
  merchant's day history, so deep pages are progressively more expensive.
- `get_whitelist_page` is unbounded, which is fine for a list that is normally
  tens of entries but is worth knowing before you paginate a large whitelist.

There is one more read cap that is not a page cap and is not in `caps.rs`:

| Entrypoint                 | Argument | Cap  | Over the cap          | Notes                                   |
| -------------------------- | -------- | ---- | --------------------- | --------------------------------------- |
| `get_charge_history_page`  | `limit`  | 12   | Silently clamps to 12 | `MAX_HISTORY` in `subscription_history.rs`. This is a retention length, not a batch size: history is trimmed to 12 entries, so there is never more to return. |

## Uncapped read paths

Worth calling out because an operator scanning this page for "is anything
uncapped?" should find the answer here rather than by reading the code:

| Entrypoint                    | Uncapped because                          | Practical risk                                        |
| ----------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| `get_merchant_revenue_history`| `days` is never validated                  | Reads the whole stored history; bounded by retention, not by the argument |
| `get_whitelist_page`          | Only `(offset + limit).min(size)` applies  | Large whitelists can be returned in one call           |

Neither is an unbounded *write*, and neither lets a caller exceed the network's
per-transaction limits, so neither is an availability hazard in the way a
missing batch cap would be. They are listed so the gap is documented rather
than discovered.

## Enforcement: panic vs silent clamp

The distinction matters when writing a client. Three of the entrypoints clamp
silently, meaning a request for 500 addresses *succeeds* and returns 50:

| Behaviour        | Entrypoints                                                      |
| ---------------- | ---------------------------------------------------------------- |
| **Panic** `BatchTooLarge` (20) | `batch_charge`, `batch_extend_subscription_ttl`, `batch_cancel`, `batch_pause_subscriptions`, `get_batch_charge_estimate`, `whitelist_batch_add`, `whitelist_batch_remove`, `get_merchant_statuses`, `get_merchant_sub_counts`, `get_next_charge_batch`, `get_top_merchants_by_subs`, `get_merchant_revenue_day_page` |
| **Silently clamps** | `get_subscriber_page`, `get_active_subscriber_page`, `get_charge_history_page` |
| **No limit**     | `get_whitelist_page`, `get_merchant_revenue_history`               |

Practical rule: a clamping call never errors, so a client that walks a large
result set by incrementing `offset` can loop forever if it assumes it got
everything it asked for. Check the returned length against your requested
`limit` and stop when it is short.

## Why the ceilings exist

- **`MAX_BATCH_SIZE_CEILING` (200)** bounds transaction size. Every address in
  a batch becomes a `transfer_from` plus storage writes; an unbounded batch is
  a way to make the contract unspendable to call. Capping configuration, not
  just the default, means a compromised admin key still cannot remove the bound.
- **`MAX_BATCH_PAUSE_SUBSCRIPTIONS` (25)** is much lower than the charge cap on
  purpose. Pause and cancel are rarer and higher-consequence than charging, and
  a pause batch that exceeds 25 is almost always a script bug rather than a
  real workload.
- **`SUBSCRIBER_PAGE_SIZE` (50)** matches the default charge batch, so a keeper
  can read a page and charge it in one transaction without re-chunking.
- **`REVENUE_DAY_PAGE_SIZE` (30)** and **`TOP_MERCHANTS_PAGE_SIZE` (20)** are
  dashboard-shaped, not workload-shaped. A month of days is 30 rows; a leaderboard
  of 20 is what fits on a screen.

## Off-chain mirrors

These are the places that will submit over a cap if the constants move. They are
**not** read from the chain automatically, so a constant change can leave them
stale.

| Consumer                          | Mirrors                                   | Source of the number          |
| --------------------------------- | ----------------------------------------- | ----------------------------- |
| `scripts/keeper.ts`               | 50 default, 200 ceiling                   | `BATCH_SIZE` env, then clamps down to the live `get_max_batch_size()` |
| `scripts/batch-optimizer.ts`      | 50 default, page size clamped to 50       | `MAX_BATCH_SIZE` / `PAGE_SIZE` env |
| `scripts/top-merchants.ts`        | 20                                        | `MAX_BATCH_SIZE = 20` (the top-merchants cap, despite the name colliding with the charge default) |
| `scripts/config.ts`               | 200 upper bound on `BATCH_SIZE`           | zod schema, `.max(200)`       |
| `scripts/subscriber-health-dashboard.ts` | page size clamped to 50, ledger batch clamped to 200 | `PAGE_SIZE` / `LEDGER_ENTRY_BATCH` |
| `frontend` `BatchPausePanel`      | chunks at 25                              | `MAX_PAUSE_BATCH = 25`        |
| `frontend` `BatchWhitelistPanel`  | chunks at 50                              | `MAX_WHITELIST_BATCH = 50`    |

The frontend panels hardcode their chunk sizes rather than reading the chain, so
if an admin *lowers* the whitelist cap below 50 the UI will keep submitting
50-address chunks and get `BatchTooLarge` back. The keeper does not have this
problem: it simulates `get_max_batch_size()` at startup and narrows to whatever
the chain currently reports.

## Verifying this page

```bash
# The constants this page is built from
sed -n '/pub const/p' contract/src/caps.rs

# Every place they are enforced
rg -n "caps::|MAX_BATCH_SIZE_CEILING|MAX_BATCH_PAUSE_SUBSCRIPTIONS|MAX_WHITELIST_BATCH_SIZE|SUBSCRIBER_PAGE_SIZE|REVENUE_DAY_PAGE_SIZE|TOP_MERCHANTS_PAGE_SIZE|MAX_MERCHANT_SUB_COUNT_BATCH" contract/src

# Off-chain mirrors
rg -n "MAX_PAUSE_BATCH|MAX_WHITELIST_BATCH|MAX_BATCH_SIZE|PAGE_SIZE|BATCH_SIZE_CEILING" scripts frontend/src

# Drift check: fails if any number here disagrees with caps.rs
node scripts/emit-caps-table.mjs --check
```

`scripts/emit-caps-table.mjs` parses `caps.rs` and diffs the result against this
page, so a constant change without a doc change is a one-line command away from
being caught.

## Related

- [`API.md`](API.md) - per-endpoint signature and error list
- [`ERROR-CODES.md`](ERROR-CODES.md) - `BatchTooLarge` (20), `InvalidBatchSize` (29)
- [`DAILY-LIMITS.md`](DAILY-LIMITS.md) - the per-user `pay_per_use` daily cap
- [`ARCHITECTURE.md`](ARCHITECTURE.md#storage-strategy) - storage tiers, and where the two batch-size keys live
- [`architecture/storage_and_ttl.md`](architecture/storage_and_ttl.md#3-complete-datakey-reference) - per-key TTL behaviour of the capped keys
- [`scripts/README.md`](../scripts/README.md) - keeper and off-chain tooling
