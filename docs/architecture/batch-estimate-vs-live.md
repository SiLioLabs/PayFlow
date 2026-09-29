# `batch_charge` estimate vs live execution

This document describes every intentional difference between the three charge
surfaces keepers and integrators interact with: live `batch_charge`, dry-run
`get_batch_charge_estimate`, and single-user `simulate_charge`.

Source of truth: `contract/src/batch.rs` (`batch_charge`), `contract/src/lib.rs`
(`get_batch_charge_estimate`), `contract/src/charge_exec.rs`
(`simulate_charge`, `dry_run_skip_precheck`).

---

## Quick-reference comparison table

| Behaviour                            | `batch_charge`              | `get_batch_charge_estimate`        | `simulate_charge`            |
| :----------------------------------- | :-------------------------- | :--------------------------------- | :--------------------------- |
| Transfers tokens                     | **Yes**                     | No                                 | No                           |
| Writes subscription on charge        | **Yes**                     | No                                 | No                           |
| Auto-resume on `PauseExpiry <= now`  | **Real** (writes, emits)    | **Real** (writes, emits)           | Virtual (no writes)          |
| Emits `subscription_auto_resumed`    | **Yes**                     | **Yes**                            | No                           |
| Checks protocol pause (`ContractPaused`) | **Yes** — panics whole batch | **No** — skips check          | **Yes** — returns `ContractPaused` |
| Returns `ContractPaused` per-user    | No (whole-batch panic)      | No (silently proceeds)             | **Yes**                      |
| Checks allowance                     | Yes                         | Yes                                | Yes                          |
| Result enum                          | `ChargeResult`              | `ChargeResult`                     | `ChargeSimResult`            |
| Batch size cap                       | `get_max_batch_size()` (default 50) | **Hardcoded 200**          | N/A (single user)            |
| Emits `batch_charge_skips` event     | **Yes** (when interesting failures) | No                        | No                           |
| Increments revenue / charge history  | **Yes**                     | No                                 | No                           |
| Bumps TTL on charge                  | **Yes** (`extend_subscription_ttl`) | No                        | No                           |
| Updates `last_charged`               | **Yes**                     | No                                 | No                           |

---

## Detailed differences

### 1. Token transfers

`batch_charge` calls `fee::transfer_subscription_charge` for each charged
subscriber, which issues up to two SAC `transfer_from` calls (fee leg →
collector, net leg → merchant). `get_batch_charge_estimate` and
`simulate_charge` never call any transfer function — they return `Charged` /
`WouldSucceed` to mean "would transfer if this were live", not that a transfer
occurred.

### 2. Auto-resume is real in `get_batch_charge_estimate`

Both `batch_charge` and `get_batch_charge_estimate` call the real
`charge_exec::try_auto_resume`. When a subscriber's `PauseExpiry <= now`,
`try_auto_resume`:
1. Writes the updated `Subscription` (sets `paused=false`, `active=true`).
2. Removes `PauseExpiry` from persistent storage.
3. Emits `subscription_auto_resumed`.

This means **`get_batch_charge_estimate` is not a pure read** for subscribers
in bounded-pause state. Running it on a list that includes paused subscribers
with elapsed expiry will mutate contract state and emit events, exactly as
`batch_charge` would.

`simulate_charge` uses the shared `dry_run_skip_precheck` helper which
performs a **virtual** auto-resume: it updates the local Rust copy of the
subscription struct but writes nothing to storage and emits no event.

### 3. Protocol pause handling

`batch_charge` calls `ensure_contract_not_paused` before the user loop. If
the contract is paused, the entire `batch_charge` invocation panics with
`ContractPaused` (18) — no user receives a result.

`get_batch_charge_estimate` does **not** check protocol pause. If the contract
is paused, the estimate proceeds as if it were not, returning `Charged` for
eligible subscribers. This means an estimate can return optimistic results
that live `batch_charge` would never produce while the contract is paused.

`simulate_charge` checks protocol pause and returns
`ChargeSimResult::ContractPaused` per-user when the flag is set.

**Implication for keepers:** always call `is_contract_paused()` (or check the
health endpoint) before trusting an estimate when the contract may be in
maintenance mode. Do not assume an optimistic estimate means live charges will
succeed.

### 4. Batch size cap

`batch_charge` enforces `get_max_batch_size()` (default 50, configurable by
admin via `set_max_batch_size`). If `users.len() > max`, it panics
`BatchTooLarge` (20).

`get_batch_charge_estimate` uses a **hardcoded** cap of 200, regardless of the
configured `MaxBatchSize`. A keeper that calls the estimate with 200 users and
then calls live `batch_charge` with the same list will succeed at the estimate
but fail the live call if `max_batch_size < 200`.

**Recommendation:** call `get_contract_config()` to read the live batch cap
and size both estimate and live calls to that value. Do not rely on the 200
estimate cap to indicate live feasibility.

### 5. `batch_charge_skips` event

`batch_charge` emits a `batch_charge_skips` summary event when at least one
"interesting" non-success result occurs (`NoSubscription`, `Inactive`,
`Paused`, `GracePeriodElapsed`, `AllowanceInsufficient`). This event is used
by alert scripts and indexers to detect degraded batches without parsing every
result.

`get_batch_charge_estimate` emits no `batch_charge_skips` event.

### 6. Result enum: `ChargeResult` vs `ChargeSimResult`

Both `batch_charge` and `get_batch_charge_estimate` return `Vec<ChargeResult>`.
`simulate_charge` returns `ChargeSimResult`, which has additional variants
(`ContractPaused`, `SubscriptionPaused`) and maps `NoSubscription` to
`Inactive` for API compatibility.

The mapping between the two:

| Live / estimate `ChargeResult` | `simulate_charge` `ChargeSimResult` | Notes                                             |
| :----------------------------- | :---------------------------------- | :------------------------------------------------ |
| `Charged`                      | `WouldSucceed`                      |                                                   |
| `Skipped`                      | `NotDue`                            |                                                   |
| `NoSubscription`               | `Inactive`                          | simulate collapses missing → Inactive             |
| `Inactive`                     | `Inactive`                          |                                                   |
| `Paused`                       | `SubscriptionPaused`                |                                                   |
| `GracePeriodElapsed`           | `GracePeriodElapsed`                |                                                   |
| `AllowanceInsufficient`        | `InsufficientAllowance`             |                                                   |
| *(no equivalent)*              | `ContractPaused`                    | Batch panics whole call; estimate silently skips  |

### 7. Side-effects on a successful charge

`batch_charge` performs all bookkeeping on a successful charge:
- Updates `sub.last_charged = now` and writes back the subscription.
- Calls `extend_subscription_ttl` to bump TTL ~1 year.
- Calls `merchant_stats::increment_revenue_with_daily` to credit the merchant.
- Calls `subscription_history::record_charge` to append to charge history.
- Emits the `charged` event.

`get_batch_charge_estimate` and `simulate_charge` perform **none** of these.
A `Charged` / `WouldSucceed` result means all preconditions passed; it does
not mean any of the above state was updated.

---

## Code comment in source

The shared dry-run precheck (`charge_exec::dry_run_skip_precheck`) includes a
comment block documenting all intentional differences. Contributors adding
new skip/pause reasons should update both that comment block and this document.

See `contract/src/charge_exec.rs` — the `DryRunSkipOutcome` enum and its
`into_sim_result` / `into_batch_result` conversion methods.

---

## Keeper recommendations

1. **Use `get_batch_charge_estimate` only for pre-flight checks,** not as a
   substitute for understanding what `batch_charge` will do when the contract
   is paused.
2. **Size estimate calls to the live batch cap** (`get_contract_config().max_batch_size`)
   to avoid false-positive estimates for lists larger than 50.
3. **Parse `batch_charge_skips` events** for operational alerting; do not rely
   on estimate return values for monitoring.
4. **Be aware that estimate auto-resumes subscribers.** If your observability
   pipeline tracks pause state from contract events, running an estimate on a
   paused list will emit `subscription_auto_resumed` events — even though no
   charge occurred.
5. **`simulate_charge` is the correct dry-run for single-user, protocol-pause-aware
   checks.** It is purely read-only (virtual auto-resume, no storage writes).

---

## Related

- [API.md — `batch_charge`](../API.md#batch_charge)
- [API.md — `get_batch_charge_estimate`](../API.md#get_batch_charge_estimate)
- [API.md — `simulate_charge`](../API.md#simulate_charge)
- [pause-lifecycle.md](./pause-lifecycle.md) — auto-resume mechanics and PauseExpiry
- [KEEPER.md](../KEEPER.md) — operational keeper guide
- [EVENTS.md](../EVENTS.md) — `batch_charge_skips`, `subscription_auto_resumed` shapes
- [`contract/src/batch.rs`](../../contract/src/batch.rs) — `batch_charge` implementation
- [`contract/src/charge_exec.rs`](../../contract/src/charge_exec.rs) — shared precheck, `simulate_charge`
- [`contract/src/lib.rs`](../../contract/src/lib.rs) — `get_batch_charge_estimate` implementation
