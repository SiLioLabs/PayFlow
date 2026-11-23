# PayFlow Contract Limits

> **Auto-generated table** -- do not edit by hand.
> Run `node scripts/emit-caps-table.mjs --check` to verify this file is in sync
> with `contract/src/` and `scripts/lib/contract-limits.ts`.

This table is the operator-facing reference for every hard cap enforced by the
deployed contract.  The authoritative values live in:

- **Contract (Rust):** `contract/src/batch.rs`, `contract/src/lib.rs`,
  `contract/src/migration.rs`, `contract/src/spending_limit.rs`,
  `contract/src/upgrade.rs`
- **Scripts (TypeScript):** `scripts/lib/contract-limits.ts`

## Batch sizes

| Constant | Value | Description |
|---|---|---|
| `MAX_BATCH_SIZE` | 50 | Default maximum users per `batch_charge` call |
| `MAX_BATCH_SIZE_CEILING` | 200 | Hard ceiling on `set_max_batch_size` |
| `MAX_BATCH_PAUSE` | 25 | Maximum subscriptions per batch pause call |
| `MAX_WHITELIST_BATCH` | 50 | Maximum addresses per whitelist batch operation |

## Schema version

| Constant | Value | Description |
|---|---|---|
| `CURRENT_SCHEMA_VERSION` | 2 | Current on-chain storage schema version |

## Ledger-time constants

| Constant | Value | Description |
|---|---|---|
| `LEDGERS_PER_DAY` | 17280 | Approximate ledgers per day (~5 s/ledger) |
| `UPGRADE_TTL_LEDGERS` | 17280 | TTL for pending WASM upgrade proposals |
| `SUBSCRIPTION_TTL_LEDGERS` | 6307200 | Subscription entry TTL (~1 year) |

## Amount limits (token base units)

| Constant | Value | Description |
|---|---|---|
| `MAX_AMOUNT` | 100000000000 | Maximum single pay-per-use amount |
| `MAX_SUBSCRIPTION_AMOUNT` | 100000000000000 | Maximum subscription charge amount |
| `GLOBAL_MAX_VOLUME_PER_HOUR` | 50000000000000 | Global max volume per hour (all merchants) |

## Token decimals

| Constant | Value | Description |
|---|---|---|
| `XLM_DECIMALS` | 7 | XLM decimal places (1 XLM = 10^7 stroops) |
| `STROOPS_PER_XLM` | 10000000 | Stroops per XLM |

> ⚠️ **Multi-token note:** `XLM_DECIMALS` and `STROOPS_PER_XLM` apply only to
> XLM and XLM-derived SAC tokens. Non-XLM SEP-41 tokens may use different decimal
> counts — always query the token's `decimals()` entry-point rather than
> hard-coding these values for arbitrary tokens.

## Other constants

| Constant | Value | Description |
|---|---|---|
| `HOUR_IN_SECONDS` | 3600 | Seconds per hour |

## Duplicate address behaviour in batch calls

| Entry point | Duplicate behaviour |
|---|---|
| `batch_charge` | The first occurrence of an address is processed normally and its result (`Charged`, `Skipped`, `Inactive`, …) is recorded at that position. Every subsequent occurrence of the same address records `Skipped` **without** touching contract state — the user is never charged more than once per call. The returned `Vec` always has the same length as the input `Vec`. |
| `batch_pause_subscriptions` | The first occurrence of an address is paused (if active and not already paused). Subsequent occurrences are silently skipped — no additional state changes and no additional `subscription_paused` events are emitted. |
| `whitelist_batch_add` | Idempotent by design: adding the same merchant address twice is equivalent to adding it once. Both calls write the same `true` value to the same storage key. |
| `whitelist_batch_remove` | Idempotent by design: removing the same merchant address twice is equivalent to removing it once. Both calls attempt to remove the same storage key; the second is a no-op. |

> **Implementation note:** `batch_charge` and `batch_pause_subscriptions` perform
> a linear deduplication scan inside the loop (O(n²) in the number of unique addresses,
> bounded by the respective batch-size caps of 200 and 25).  No external data structure
> is used — soroban-sdk's `Vec::iter().any()` is sufficient at these sizes.
