# Pause Lifecycle

This document describes the two pause mechanisms in FlowPay — `pause` (indefinite) and `pause_until` (bounded) — how the `PauseExpiry` storage key mediates auto-resume, and what keepers, indexers, and frontend integrations need to know about each state.

Source of truth: `contract/src/lib.rs` (`pause`, `pause_until`, `resume`), `contract/src/storage.rs` (`extend_subscription_ttl`, `set_pause_expiry`, `get_pause_expiry`, `clear_pause_expiry`), `contract/src/charge_exec.rs` (`try_auto_resume`, `dry_run_skip_precheck`).

---

## Table of Contents

- [State model](#state-model)
- [pause — indefinite pause](#pause--indefinite-pause)
- [pause_until — bounded pause with auto-resume](#pause_until--bounded-pause-with-auto-resume)
- [resume — manual resume](#resume--manual-resume)
- [Auto-resume on charge / batch_charge](#auto-resume-on-charge--batch_charge)
- [Interaction with simulate_charge and get_batch_charge_estimate](#interaction-with-simulate_charge-and-get_batch_charge_estimate)
- [PauseExpiry storage and TTL](#pauseexpiry-storage-and-ttl)
- [Archival risk](#archival-risk)
- [State transition diagram](#state-transition-diagram)
- [Keeper and indexer guidance](#keeper-and-indexer-guidance)
- [Frontend guidance](#frontend-guidance)
- [Error reference](#error-reference)

---

## State model

A subscription can be in one of four observable states:

| `active` | `paused` | Meaning                                                                        |
| :------- | :------- | :----------------------------------------------------------------------------- |
| `true`   | `false`  | **Active** — eligible to charge when interval elapses.                         |
| `true`   | `true`   | **Indefinitely paused** — set by `pause`. Charge attempts skip with `Paused`.  |
| `false`  | `true`   | **Bounded pause** — set by `pause_until`. Auto-resumes when `PauseExpiry` ≤ now. |
| `false`  | `false`  | **Cancelled / inactive** — set by `cancel` or `batch_cancel`.                  |

The `active/paused` combination is the full state: there is no separate status field.

---

## `pause` — indefinite pause

```
pause(env: Env, user: Address)
```

| Auth  | Errors                                              |
| :---- | :-------------------------------------------------- |
| `user.require_auth()` | `NoSubscriptionFound` (4), `SubscriptionInactive` (5) |

**What it writes:**

```
sub.paused = true        (active remains true)
PauseExpiry(user) = u64::MAX
```

Setting `PauseExpiry` to `u64::MAX` ensures the auto-resume path (`try_auto_resume`) never fires — `u64::MAX` is always greater than any real ledger timestamp.

**Event emitted:** `paused` (`("paused", user)` topic pair).

**To exit:** the user must explicitly call `resume()`.

---

## `pause_until` — bounded pause with auto-resume

```
pause_until(env: Env, user: Address, expiry: u64)
```

| Parameter | Description                                                      |
| :-------- | :--------------------------------------------------------------- |
| `expiry`  | Unix ledger timestamp. Must be **strictly greater than** `now`.  |

| Auth  | Errors                                                                         |
| :---- | :----------------------------------------------------------------------------- |
| `user.require_auth()` | `InvalidPauseExpiry` (27), `NoSubscriptionFound` (4), `SubscriptionNotActive` (16) |

**What it writes:**

```
sub.paused = true
sub.active = false       ← DIFFERS from indefinite pause
PauseExpiry(user) = expiry
```

The `active = false` flag is intentional: it marks the subscription as not charge-eligible by the standard `active` check, so only code that explicitly reads `PauseExpiry` (i.e. `try_auto_resume`) can re-activate it. This prevents any charge path that skips the auto-resume step from accidentally billing a bounded-pause subscriber.

**Event emitted:** `paused` (`("paused", user)` topic pair) — same topic as indefinite pause; the expiry timestamp is in the event payload. See [`EVENTS.md`](../EVENTS.md) for the full payload shape.

**To exit:** either the user calls `resume()` manually, or auto-resume fires on the next `charge` / `batch_charge` call after `ledger.timestamp >= expiry`.

> **Note:** there is no public `get_pause_expiry` contract method. Expiry is stored internally via `storage::set_pause_expiry` / `storage::get_pause_expiry`. Keepers and indexers must infer paused state from the `paused` and `active` subscription fields and from contract events.

---

## `resume` — manual resume

```
resume(env: Env, user: Address)
```

| Auth  | Errors                                                                                    |
| :---- | :---------------------------------------------------------------------------------------- |
| `user.require_auth()` | `NoSubscriptionFound` (4), `SubscriptionInactive` (5), `ResumeGraceLapsed` (43) |

Works for **both** indefinite and bounded-pause subscriptions:
- Indefinite pause: `active` was already `true`, `paused` becomes `false`.
- Bounded pause (`pause_until`): `active` was `false`, both `active` and `paused` are reset to their live state.

`resume` also clears `PauseExpiry` from storage and emits the `resumed` event.

**Grace window guard:** if the subscription's billing interval plus grace period has fully elapsed while paused, `resume` is rejected with `ResumeGraceLapsed` (43). The subscription is no longer chargeable. The user must cancel and re-subscribe. This prevents false recoverability signals.

---

## Auto-resume on `charge` / `batch_charge`

Auto-resume is the mechanism by which a `pause_until` subscription silently transitions back to active when the keeper next attempts a charge. It is implemented in `charge_exec::try_auto_resume`.

**How it works:**

```rust
// charge_exec.rs
pub fn try_auto_resume(env: &Env, user: &Address, sub: &mut Subscription, now: u64) -> bool {
    if sub.paused {
        let expiry = storage::get_pause_expiry(env, user);
        if let Some(expiry_ts) = expiry {
            if now >= expiry_ts {
                sub.paused = false;
                sub.active = true;
                // Writes subscription, clears PauseExpiry, emits subscription_auto_resumed
                ...
                return true;
            }
        }
    }
    false
}
```

**Trigger condition:** `sub.paused == true` AND `PauseExpiry(user) <= now`.

**Side effects on auto-resume:**
1. `Subscription` is written back with `paused = false`, `active = true`.
2. `PauseExpiry` key is removed from persistent storage.
3. `subscription_auto_resumed` event is emitted.
4. Charge proceeds immediately in the same invocation (interval/grace checks follow).

**`batch_charge` behavior:** auto-resume and immediate charge happen atomically within a single user's slot in the batch. Other users in the same batch are unaffected. The `ChargeResult` for that user is `Charged` (not `Paused`), and the `subscription_auto_resumed` event precedes the `charged` event in the same transaction.

**Indefinite pause (`PauseExpiry = u64::MAX`):** `now >= u64::MAX` is never true, so auto-resume never fires. The user must call `resume()` explicitly.

---

## Interaction with `simulate_charge` and `get_batch_charge_estimate`

Both dry-run surfaces use the shared `dry_run_skip_precheck` helper in `charge_exec.rs`, which performs a **virtual** auto-resume: if the subscription is paused with `PauseExpiry <= now`, the local copy of the subscription is updated to the post-auto-resume state, but **no storage writes occur**.

| Surface                   | Auto-resume | Storage writes | Protocol-pause check |
| :------------------------ | :---------- | :------------- | :------------------- |
| `charge`                  | Real        | Yes            | Yes (panics)         |
| `batch_charge`            | Real        | Yes            | Yes (panics)         |
| `simulate_charge`         | Virtual     | No             | Yes                  |
| `get_batch_charge_estimate` | **Real**  | **Yes**        | No                   |

> **`get_batch_charge_estimate` is not a pure read.** When auto-resume fires inside the estimate, it writes the subscription and emits `subscription_auto_resumed`. See [`docs/architecture/batch-estimate-vs-live.md`](./batch-estimate-vs-live.md) for the full comparison table.

---

## `PauseExpiry` storage and TTL

`PauseExpiry(Address)` is a **persistent** storage key holding a `u64` Unix timestamp.

| Operation           | Written by                    | Value                   |
| :------------------ | :---------------------------- | :---------------------- |
| `pause`             | `storage::set_pause_expiry`   | `u64::MAX`              |
| `pause_until`       | `storage::set_pause_expiry`   | caller-supplied expiry  |
| `resume`            | `storage::clear_pause_expiry` | (removed)               |
| auto-resume         | `storage::clear_pause_expiry` | (removed)               |

**TTL:** `PauseExpiry` is NOT bumped by `pause` or `pause_until` themselves. It is co-bumped alongside the `Subscription` key by `storage::extend_subscription_ttl`, which is called from:
- `charge` / `batch_charge` (on a successful charge)
- `resume`
- the public `extend_subscription_ttl` entrypoint

For a subscription that is paused indefinitely and never charged or resumed, `PauseExpiry` will eventually archive unless `extend_subscription_ttl` is called. See [Archival risk](#archival-risk).

---

## Archival risk

If `PauseExpiry` archives (is evicted from the ledger) while the `Subscription` key survives:

- `try_auto_resume` calls `storage::get_pause_expiry` and receives `None`.
- The condition `if let Some(expiry_ts) = expiry` is never true.
- The subscription is stuck in `paused = true` state indefinitely — even after the intended expiry has passed.
- Keepers see `ChargeResult::Paused` forever.

**Prevention:**

1. For subscriptions paused via `pause_until`, ensure `extend_subscription_ttl(user)` is called at least once before `SUBSCRIPTION_TTL_LEDGERS / 2` ledgers have elapsed since the pause.
2. Keepers should call `batch_extend_subscription_ttl` on paused subscribers periodically.
3. The `storage_and_ttl.md` [archival risk table](./storage_and_ttl.md#8-archival-risk-and-operator-checklist) lists all affected keys.

If a `PauseExpiry` key is already archived and the subscriber's expiry has passed, the admin can unblock them by calling `resume(user)` on their behalf (no longer blocked since the expiry is gone and the grace check uses `last_charged`), or by having the user re-subscribe after cancelling.

---

## State transition diagram

```
                    subscribe()
                        │
                        ▼
                   ┌─────────┐
                   │ Active  │◄──────────────────────────────────┐
                   │ a=T p=F │                                   │
                   └────┬────┘                                   │
                        │                                        │
           ┌────────────┴───────────────┐                        │
           │ pause()                    │ pause_until(expiry)     │
           ▼                            ▼                        │
    ┌─────────────┐            ┌─────────────────┐               │
    │ Indefinite  │            │  Bounded Pause  │               │
    │   Pause     │            │  a=F  p=T       │               │
    │ a=T  p=T    │            │  Expiry=expiry  │───auto-resume─┘
    │ Expiry=MAX  │            └────────┬────────┘  (charge/batch_charge
    └──────┬──────┘                     │            when now >= expiry)
           │ resume()                   │ resume()
           │                            │ (before expiry)
           └─────────────┬──────────────┘
                         ▼
                    ┌─────────┐
                    │ Active  │  (same as top)
                    │ a=T p=F │
                    └────┬────┘
                         │ cancel() / batch_cancel()
                         ▼
                    ┌──────────┐
                    │ Inactive │
                    │ a=F p=F  │
                    └──────────┘
```

> From any paused state: if `resume()` is called after the grace window has closed, it fails with `ResumeGraceLapsed` (43) and the subscription moves to effectively-lapsed. The user must `cancel()` and re-subscribe.

---

## Keeper and indexer guidance

**Detecting pause state from events:**

| Event topic             | Meaning                                      |
| :---------------------- | :------------------------------------------- |
| `paused`                | Subscription was paused (indefinite or bounded; check payload for expiry) |
| `resumed`               | User manually called `resume()`              |
| `subscription_auto_resumed` | `pause_until` expiry passed; auto-resumed by `charge` or `batch_charge` |

**Keeper batch_charge behavior:**

- `ChargeResult::Paused` — subscription is currently paused and auto-resume did not fire (either indefinite, or expiry not yet reached).
- `ChargeResult::Charged` — subscription may have been auto-resumed in this same invocation (check for `subscription_auto_resumed` event in the same tx).

**Recommended keeper practice:**

1. Maintain a separate "paused" queue in the indexer using the `paused` / `resumed` / `subscription_auto_resumed` events.
2. Still include bounded-pause subscribers in `batch_charge` after their `PauseExpiry` timestamp — the contract handles auto-resume atomically.
3. For indefinitely-paused subscribers: exclude from charge queues; include in `batch_extend_subscription_ttl` runs so `PauseExpiry` does not archive.
4. Alert on `ChargeResult::Paused` that persists beyond the expected `PauseExpiry` (may indicate archived key).

---

## Frontend guidance

- **Indefinite pause:** show a "Resume" button. The subscription is billed again after the user resumes and the next interval elapses.
- **Bounded pause (`pause_until`):** show the resume date derived from the `paused` event payload. No user action is required; auto-resume fires on the next keeper cycle after the expiry.
- **No `get_pause_expiry` API:** the expiry is not readable from the contract. Index it from the `paused` event payload in the off-chain indexer.
- **`ResumeGraceLapsed` (43):** inform the user that the subscription has lapsed and they must re-subscribe rather than resume.

---

## Error reference

| Code | Name                   | When                                                              |
| :--- | :--------------------- | :---------------------------------------------------------------- |
| 4    | `NoSubscriptionFound`  | `pause`, `pause_until`, `resume` called for a non-existent sub   |
| 5    | `SubscriptionInactive` | `pause` called when `sub.active == false`                        |
| 16   | `SubscriptionNotActive`| `pause_until` called when `sub.active == false`                  |
| 17   | `SubscriptionPaused`   | `charge` / `pay_per_use` called while sub is paused              |
| 27   | `InvalidPauseExpiry`   | `pause_until` expiry is not strictly in the future               |
| 43   | `ResumeGraceLapsed`    | `resume` called after the grace window closed                    |

Full recovery steps: [`docs/ERROR-CODES.md`](../ERROR-CODES.md).

---

## Related

- [API.md — pause](../API.md#pause)
- [API.md — pause_until](../API.md#pause_until)
- [API.md — resume](../API.md#resume)
- [storage_and_ttl.md — PauseExpiry row](./storage_and_ttl.md)
- [batch-estimate-vs-live.md](./batch-estimate-vs-live.md) — auto-resume side-effects in estimate vs live paths
- [EVENTS.md](../EVENTS.md) — `paused`, `resumed`, `subscription_auto_resumed` event shapes
- [SUBSCRIBER-LIFECYCLE.md](../SUBSCRIBER-LIFECYCLE.md)
- [`contract/src/charge_exec.rs`](../../contract/src/charge_exec.rs) — `try_auto_resume`, `dry_run_skip_precheck`
- [`contract/src/storage.rs`](../../contract/src/storage.rs) — `extend_subscription_ttl`, `set_pause_expiry`
