# Subscriber Lifecycle Guide

A narrative walkthrough of everything that can happen to a PayFlow subscription, from the first `subscribe()` call to a final `cancel()`. This guide is written for developers integrating PayFlow who want the story in plain language, with concrete timestamps and stroop amounts. For the formal state-transition rules this guide is based on, see [`docs/spec/lifecycle_spec.md`](./spec/lifecycle_spec.md) — that document is the technical reference; this one is the tour.

---

## Table of Contents

- [State Machine at a Glance](#state-machine-at-a-glance)
- [Nonexistent](#1-nonexistent)
- [Active (Standard)](#2-active-standard)
- [Active (Trial)](#3-active-trial)
- [Active (Chargeable)](#4-active-chargeable)
- [Active (Grace Expired)](#5-active-grace-expired)
- [Paused](#6-paused)
- [Cancelled](#7-cancelled)
- [Trial Period, In Depth](#trial-period-in-depth)
- [Grace Period, In Depth](#grace-period-in-depth)
- [Pause and Resume, In Depth](#pause-and-resume-in-depth)
- [Cancellation and Prorated Refund](#cancellation-and-prorated-refund)
- [Walkthrough: A Subscriber's Full Life](#walkthrough-a-subscribers-full-life)

---

## State Machine at a Glance

```text
                                ┌─────────────┐
                                │ Nonexistent │
                                └──────┬──────┘
                                       │
                     subscribe() / subscribe_with_metadata()
                                       │
                      ┌────────────────┴────────────────┐
                      │ trial_period = None               │ trial_period = Some(t)
                      ▼                                    ▼
              ┌───────────────┐                   ┌─────────────────┐
              │    Active     │                    │  Active (Trial)  │
              │  (Standard)   │                    └────────┬─────────┘
              └───────┬───────┘                             │ now >= last_charged (trial ends)
                      │                                     ▼
                      │                            ┌───────────────┐
                      │                            │    Active     │
                      │                            │  (Standard)   │
                      │                            └───────┬───────┘
                      │                                    │
                      └───────────────┬────────────────────┘
                                       │ now >= last_charged + interval
                                       ▼
                             ┌───────────────────┐
                             │      Active        │
                             │   (Chargeable)      │
                             └──────────┬──────────┘
                                        │
                    ┌───────────────────┼────────────────────┐
                    │ charge()          │ grace_period > 0 && │
                    │                   │ now > next+grace    │
                    ▼                   ▼                     │
            ┌───────────────┐  ┌───────────────────┐          │
            │    Active     │  │      Active         │          │
            │  (Standard)   │  │  (Grace Expired)     │          │
            └───────┬───────┘  └──────────┬───────────┘          │
                    │                     │ subscribe() only      │
                    │                     │ (re-chargeable path    │
                    │                     │  requires resubscribe) │
                    └──────────┬──────────┘                       │
                               │                                  │
                  pause() / pause_until()      cancel()  ◄─────────┘
                               │                    │
                               ▼                    ▼
                       ┌───────────┐        ┌───────────┐
                       │  Paused   │        │ Cancelled │
                       └─────┬─────┘        └─────┬─────┘
                              │                    │
              resume() or auto-resume               │
               (pause_until expiry + a charge())     │
                              │                       │
                              └──────────┬────────────┘
                                         │ subscribe() / subscribe_with_metadata()
                                         ▼
                                 ┌───────────────┐
                                 │    Active     │
                                 │  (Standard)   │
                                 └───────────────┘
```

Every state below is defined purely by the two flags on the `Subscription` record (`active`, `paused`) plus the current ledger timestamp compared against `last_charged`, `interval`, and the global `grace_period`. There is no separate "status" enum stored anywhere — a subscription's state is always _derived_, never stored directly, which is why every state description below starts from the stored fields.

```rust
pub struct Subscription {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub last_charged: u64,
    pub active: bool,
    pub paused: bool,
    pub token: Address,
    pub referrer: Option<Address>,
    pub label: Symbol,
    pub trial_duration: u64,
}
```

---

## 1. Nonexistent

**What it means:** No `Subscription(user)` record exists in persistent storage. This is the starting state for every address, and the state a cancelled subscriber's _identity_ never fully leaves — see [Cancelled](#7-cancelled) for why "nonexistent" and "cancelled" are actually different states in this contract.

**How to enter it:** This is the default — nothing to do. A subscriber only reaches this state before their first `subscribe()` call.

**How to exit it:** `subscribe()` or `subscribe_with_metadata()`.

**Operations blocked:** everything — `charge()`, `pay_per_use()`, `pause()`, `resume()`, `cancel()` all panic with `ContractError::NoSubscriptionFound`.

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- \
  subscribe --user <USER_ADDRESS> --merchant <MERCHANT_ADDRESS> \
  --amount 50000000 --interval 2592000 --token <TOKEN_ADDRESS> \
  --trial_period null --referrer null
```

---

## 2. Active (Standard)

**What it means:** `active: true`, `paused: false`, and `last_charged` is at or before "now" — the subscription is live but the current billing period hasn't elapsed yet.

**How to enter it:**

- `subscribe()` with `trial_period: None` — `last_charged` is set to `now`, so the subscription starts here immediately.
- A trial ending (`now >= last_charged`, see [Trial Period](#trial-period-in-depth)).
- A successful `charge()` from [Active (Chargeable)](#4-active-chargeable) — `execute_charge` resets `last_charged = now`, landing back here.
- `resume()` (or auto-resume via a `charge()` call — see [Pause and Resume](#pause-and-resume-in-depth)) when `now < last_charged + interval`.

**How to exit it:** time passing (`now >= last_charged + interval` → [Active (Chargeable)](#4-active-chargeable)), `pause()`/`pause_until()`, or `cancel()`.

**Operations allowed:** `pay_per_use()` ✅, `pause()` ✅, `cancel()` ✅. `charge()` ❌ — panics with `ContractError::IntervalNotElapsed` because `compute_next_charge_at` returns `last_charged + interval`, which is still in the future.

---

## 3. Active (Trial)

**What it means:** `active: true`, `paused: false`, but `last_charged` was deliberately set to a **future** timestamp at subscribe time. See [Trial Period, In Depth](#trial-period-in-depth) for the exact encoding.

**How to enter it:** `subscribe()` / `subscribe_with_metadata()` with `trial_period: Some(seconds)` where `seconds > 0`.

**How to exit it:** time passing until `now >= last_charged` (trial ends → [Active (Standard)](#2-active-standard)), or directly to `Active (Chargeable)` if enough time passes that `now >= last_charged + interval` in one jump, or `pause()`/`cancel()` at any point during the trial.

**Operations allowed:** `pay_per_use()` ✅ (this is the entire point of the trial — the user can use the service immediately). `charge()` ❌ — `IntervalNotElapsed`, because `last_charged` (the trial end) is still ahead of `now`. `pause()` ✅, `cancel()` ✅.

---

## 4. Active (Chargeable)

**What it means:** `active: true`, `paused: false`, and `now >= last_charged + interval`. The billing period has closed and a `charge()` will succeed (assuming the grace period, if any, hasn't also elapsed).

**How to enter it:** time passing from either [Active (Standard)](#2-active-standard) or a post-trial [Active (Standard)](#2-active-standard)/[Active (Trial)](#3-active-trial).

**How to exit it:** a successful `charge()` (→ back to [Active (Standard)](#2-active-standard), with `last_charged` reset to `now`), the grace period elapsing (→ [Active (Grace Expired)](#5-active-grace-expired), only if `grace_period > 0`), `pause()`/`pause_until()`, or `cancel()`.

**Operations allowed:** `pay_per_use()` ✅, `charge()` ✅, `pause()` ✅, `cancel()` ✅.

```bash
# Any keeper key can call this — charge() takes no auth from the subscriber.
soroban contract invoke --id <CONTRACT_ID> --source <KEEPER_KEY> --network testnet -- \
  charge --user <USER_ADDRESS>
```

---

## 5. Active (Grace Expired)

**What it means:** `active: true`, `paused: false`, `grace_period > 0`, and `now > last_charged + interval + grace_period`. The window during which a late charge would still be accepted has closed.

**How to enter it:** time passing without a `charge()` call while chargeable, past the grace window. Only reachable when the contract-wide grace period is nonzero — with `grace_period == 0` (the default), a subscription simply stays [Active (Chargeable)](#4-active-chargeable) forever until charged, and this state is never reached.

**How to exit it:** the contract has no dedicated "revive" call for this state. `subscribe()` (a full resubscribe, which overwrites `last_charged` back to `now`) is the only documented path back to [Active (Standard)](#2-active-standard). `cancel()` is also always available.

**Operations allowed:** `pay_per_use()` ✅ (grace period only gates `charge()`, not one-off payments), `charge()` ❌ — panics with `ContractError::GracePeriodElapsed`, `pause()` ✅, `cancel()` ✅.

> **Integrator note:** if you rely on a keeper to call `charge()` on schedule, a keeper outage longer than `interval + grace_period` silently strands subscribers here. Since there's no automatic recovery, either keep the grace period generous relative to your keeper's expected downtime, or build a monitoring alert on subscriptions whose `last_charged + interval + grace_period` has passed without a `charged` event.

---

## 6. Paused

**What it means:** `active: true`, `paused: true`. The subscription still exists and is still "active" in the boolean-field sense, but every payment operation is blocked and `last_charged` is frozen — billing time does not advance while paused.

See [Pause and Resume, In Depth](#pause-and-resume-in-depth) for the indefinite-vs-bounded distinction.

**Operations allowed:** `resume()` ✅ (only when using indefinite pause), `cancel()` ✅. `pay_per_use()` ❌, `charge()` ❌, `pause()`/`pause_until()` ❌ (already paused).

---

## 7. Cancelled

**What it means:** `active: false`. The subscription record still exists in storage — `cancel()` never deletes it — but every field except `active` retains its last value, frozen in place. This is deliberately different from [Nonexistent](#1-nonexistent): a cancelled subscriber's charge history, metadata label, and referral record are all still readable.

**How to enter it:** `cancel()` or `cancel_and_refund_prorated()` from any active state (standard, trial, chargeable, grace-expired, or paused).

**How to exit it:** only `subscribe()` / `subscribe_with_metadata()` — a full new subscription that overwrites the cancelled record.

**Operations allowed:** nothing on the cancelled subscription itself — `pay_per_use()` ❌, `charge()` ❌, `pause()`/`resume()` ❌, `cancel()` ❌ (already cancelled, `NoSubscriptionFound` does _not_ apply here — a second `cancel()` call re-reads the same inactive record. Check the current contract behavior in [`lib.rs::cancel_inner`](../contract/src/lib.rs) before relying on idempotency, since the lifecycle spec's transition table treats double-cancel as blocked rather than erroring). `subscribe()` ✅ to start over.

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- \
  cancel --user <USER_ADDRESS>
```

---

## Trial Period, In Depth

A trial is not a separate boolean flag — it's encoded entirely in `last_charged`:

```rust
let now = env.ledger().timestamp();
let trial_duration = trial_period.unwrap_or(0);
let last_charged = now + trial_duration;   // subscribe_inner
```

If `trial_period` is `Some(seconds)`, `last_charged` is pushed `seconds` into the future instead of being set to `now`. Every other subscribe-time field is identical to a non-trial subscription. `trial_duration` is also stored separately on the `Subscription` record for reference, but the actual gating logic (in `compute_next_charge_at` and `pay_per_use`) only ever reads `last_charged` — `trial_duration` itself is not re-consulted after subscribe.

`get_trial_end(user)` tells you whether a trial is currently active and when it ends:

```rust
pub fn get_trial_end(env: Env, user: Address) -> Option<u64> {
    let sub = storage::get_subscription(&env, &user)?;
    let now = env.ledger().timestamp();
    if sub.last_charged > now { Some(sub.last_charged) } else { None }
}
```

It returns `Some(last_charged)` exactly while `last_charged` is still in the future — i.e., exactly during [Active (Trial)](#3-active-trial). Once the trial ends (`last_charged <= now`), it returns `None`, even though the subscription is now simply [Active (Standard)](#2-active-standard) rather than trial-specific. There is no separate "was this ever a trial" flag once the trial period has elapsed.

**Worked example.** Alice subscribes at `t = 1,000,000` with a 7-day trial (`trial_period = 604800`) to a merchant charging 10 USDC every 30 days (`interval = 2592000`):

| Time                                      | `last_charged` | State                                                | `get_trial_end()` |
| ----------------------------------------- | -------------- | ---------------------------------------------------- | ----------------- |
| `t = 1,000,000` (subscribe)               | `1,604,800`    | Active (Trial)                                       | `Some(1,604,800)` |
| `t = 1,300,000` (mid-trial)               | `1,604,800`    | Active (Trial) — `pay_per_use()` still works         | `Some(1,604,800)` |
| `t = 1,700,000` (trial over)              | `1,604,800`    | Active (Standard) — not yet chargeable               | `None`            |
| `t = 4,196,800` (`1,604,800 + 2,592,000`) | `1,604,800`    | Active (Chargeable) — first `charge()` succeeds here | `None`            |

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- \
  subscribe --user <USER_ADDRESS> --merchant <MERCHANT_ADDRESS> \
  --amount 100000000 --interval 2592000 --token <TOKEN_ADDRESS> \
  --trial_period 604800 --referrer null

soroban contract invoke --id <CONTRACT_ID> --network testnet -- \
  get_trial_end --user <USER_ADDRESS>
```

---

## Grace Period, In Depth

The grace period is a single contract-wide setting (`DataKey::GracePeriod`, default `0`), not a per-subscription value, changed via the [two-step propose/commit flow](./architecture/two-step-auth.md) (`propose_grace_period` → `commit_grace_period`).

With `grace_period == 0` (the default), there is effectively no grace window: `charge()` succeeds any time `now >= last_charged + interval`, forever, until someone calls it — a late keeper never causes a hard failure, only a late charge.

With `grace_period > 0`, the valid charge window becomes:

```text
[last_charged + interval, last_charged + interval + grace_period]
```

- Before the window opens: `charge()` panics with `ContractError::IntervalNotElapsed`.
- Inside the window: `charge()` succeeds normally.
- After the window closes: `charge()` panics with `ContractError::GracePeriodElapsed`, and the subscription is now [Active (Grace Expired)](#5-active-grace-expired).

Grace period changes are **not retroactive** — each `charge()` call evaluates the grace period against whatever value is configured _at charge time_, not at subscribe time, so raising or lowering it affects every existing subscriber's next charge immediately.

**Worked example.** `grace_period = 86400` (1 day). Bob's subscription has `last_charged = 2,000,000`, `interval = 604800` (7 days), so the charge window is `[2,604,800, 2,691,200]`.

| `now`                            | Inside window?          | `charge()` result                                   |
| -------------------------------- | ----------------------- | --------------------------------------------------- |
| `2,600,000`                      | No — before `2,604,800` | `IntervalNotElapsed`                                |
| `2,650,000`                      | Yes                     | Succeeds; `last_charged` resets to `2,650,000`      |
| `2,700,000` (no charge happened) | No — after `2,691,200`  | `GracePeriodElapsed`; now in Active (Grace Expired) |

---

## Pause and Resume, In Depth

There are two ways to pause, and they share the same `paused: true` flag but differ in how they end.

### Indefinite pause — `pause()`

```rust
sub.paused = true;
storage::set_pause_expiry(&env, &user, u64::MAX);
```

Sets `DataKey::PauseExpiry(user)` to `u64::MAX` — effectively "never auto-expires." The only way out is an explicit `resume()` call from the subscriber.

### Bounded pause — `pause_until(user, expiry)`

```rust
if expiry <= now { panic!(InvalidPauseExpiry) }
sub.paused = true;
storage::set_pause_expiry(&env, &user, expiry);
```

Sets a real future timestamp. `expiry` must be strictly after `now`, or the call panics with `ContractError::InvalidPauseExpiry`.

### Auto-resume

Bounded pauses don't resume themselves on a timer — nothing runs in the background on a Soroban contract. Instead, the **next `charge()` call** checks whether the pause has expired and, if so, auto-resumes before proceeding:

```rust
// charge_exec::try_auto_resume, called from charge()
if sub.paused {
    if let Some(expiry_ts) = storage::get_pause_expiry(env, user) {
        if now >= expiry_ts {
            sub.paused = false;
            if now > sub.last_charged { sub.last_charged = now; }
            storage::clear_pause_expiry(env, user);
            events::publish_subscription_auto_resumed(env, user);
            return true; // caller proceeds to charge immediately
        }
    }
}
```

This means a bounded pause is really "skip billing until at least `expiry`, resuming lazily whenever someone next tries to charge this subscriber" rather than a scheduled event. If nobody calls `charge()` after `expiry` passes, the subscription stays `paused: true` in storage even though its pause has conceptually elapsed — `get_subscription()` will keep reporting `paused: true` until either a `charge()` attempt or an explicit `resume()` call clears it. Also note: auto-resume additionally fast-forwards `last_charged` to `now` if the pause ran past the original billing time, so the subscriber isn't immediately charged again for time that passed while paused — the next full `interval` starts counting from the resume point, not from the original schedule.

An indefinite pause (`u64::MAX` expiry) never satisfies `now >= expiry_ts`, so it never auto-resumes — `resume()` is mandatory.

**Operations while paused:** `pay_per_use()` ❌, `charge()` ❌ (blocked by the `paused` check before auto-resume logic even runs, unless the bounded expiry has passed, in which case charge auto-resumes and then proceeds), `pause()`/`pause_until()` ❌ (already paused), `resume()` ✅ (indefinite pause; also works to manually resume a bounded pause early), `cancel()` ✅ (cancelling while paused is always allowed).

```bash
# Indefinite pause
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- \
  pause --user <USER_ADDRESS>

# Bounded pause until a specific ledger timestamp
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- \
  pause_until --user <USER_ADDRESS> --expiry 1700000000

# Manual resume (works for either kind of pause)
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- \
  resume --user <USER_ADDRESS>
```

---

## Cancellation and Prorated Refund

### Plain cancellation — `cancel()`

```rust
sub.active = false;
// merchant, amount, interval, last_charged, token, referrer, label all unchanged
subscription_count::decrement(env);
merchant_stats::decrement_subscriber_count(env, &sub.merchant);
referral::remove_referral(env, user);
```

No refund is issued — the subscriber keeps whatever they already paid for the current period, and the merchant keeps whatever was already charged. `active_count` and the merchant's subscriber count both decrement. The referral record is removed as part of cancellation (note this differs from the lifecycle spec's storage table, which lists `Referral(user)` as surviving cancellation — the current `cancel_inner` implementation calls `referral::remove_referral`, so treat the running code as authoritative here).

### Cancel with prorated refund — `cancel_and_refund_prorated(user, merchant)`

This variant requires **both** the subscriber's and the merchant's authorization (`user.require_auth()` _and_ `merchant.require_auth()` — a merchant can't be forced into refunding, and a subscriber can't self-refund from the merchant's pocket unilaterally):

```rust
let elapsed = now.saturating_sub(sub.last_charged);
let remaining = sub.interval.saturating_sub(elapsed);
let refund = (sub.amount * i128::from(remaining)) / i128::from(sub.interval);

if refund > 0 {
    token::Client::new(&env, &sub.token).transfer(&merchant, &user, &refund);
}
cancel_inner(&env, &user);
```

The refund is a straight linear proration of the _current_ billing period: the fraction of the interval not yet consumed, times the subscription amount. It transfers directly from the merchant's own token balance back to the user — this is a merchant-funded refund, not something PayFlow itself escrows, so the merchant address must hold (and have approved, if their token requires it for `transfer`) enough balance to cover it, or the transfer panics and the whole cancellation reverts.

**Worked example.** Carol's subscription: `amount = 30 XLM`, `interval = 30 days (2,592,000s)`, last charged at `t = 5,000,000`. She cancels with proration at `t = 5,864,000` (10 days, or 864,000 seconds, into the period):

```text
elapsed   = 5,864,000 - 5,000,000 = 864,000
remaining = 2,592,000 - 864,000   = 1,728,000
refund    = 30 * 1,728,000 / 2,592,000 = 20 XLM
```

Carol gets 20 XLM back (two-thirds of the period she didn't use); the merchant keeps the 10 XLM for the 10 days already delivered.

```bash
soroban contract invoke --id <CONTRACT_ID> --source <USER_KEY> --network testnet -- \
  cancel_and_refund_prorated --user <USER_ADDRESS> --merchant <MERCHANT_ADDRESS>
```

Both the user's and the merchant's signing keys must be present in the transaction for this call to succeed on-chain, since both addresses call `require_auth()`.

---

## Walkthrough: A Subscriber's Full Life

A single numbered example tying every section above together. Dana subscribes to a 10 USDC/30-day plan with a 3-day trial, `grace_period = 86400` (1 day) contract-wide.

1. **`t = 0` — `subscribe(dana, merchant, 10_0000000, 2592000, USDC, Some(259200), None)`.**
   `last_charged = 259200` (3 days out). State: **Active (Trial)**. `get_trial_end(dana)` → `Some(259200)`.

2. **`t = 100,000` — `pay_per_use(dana, 2_0000000)`.**
   Succeeds — pay-per-use works during trial. `last_charged` is untouched by this call.

3. **`t = 259,200` — trial ends.**
   No explicit call needed. State becomes **Active (Standard)**. `get_trial_end(dana)` → `None`.

4. **`t = 2,851,200` (`259,200 + 2,592,000`) — first bill is due.**
   State: **Active (Chargeable)**. A keeper calls `charge(dana)`. Succeeds, `last_charged = 2,851,200`. State: **Active (Standard)** again.

5. **`t = 3,000,000` — Dana calls `pause_until(dana, 3,500,000)`.**
   State: **Paused** (bounded). `PauseExpiry(dana) = 3,500,000`.

6. **`t = 5,443,200` (`2,851,200 + 2,592,000`) — the next bill would have been due, but Dana is paused, so nothing happens.** No keeper call succeeds while `paused: true` regardless of billing math.

7. **`t = 6,000,000` — a keeper calls `charge(dana)`.**
   `try_auto_resume` sees `now (6,000,000) >= expiry (3,500,000)`, auto-resumes: `paused = false`, and since `now > last_charged`, `last_charged` fast-forwards to `6,000,000`. The function returns `true` and the charge proceeds immediately in the same call. State: **Active (Standard)**, `last_charged = 6,000,000`. (Dana was not charged for the entire paused stretch — the reset billing anchor means her next bill is `6,000,000 + 2,592,000`, not a backlog of missed periods.)

8. **`t = 8,700,000` — Dana decides to cancel.**
   If she called `cancel_and_refund_prorated` here: `elapsed = 8,700,000 - last_charged (6,000,000) = 2,700,000`, which already exceeds `interval (2,592,000)`, so `remaining = interval.saturating_sub(elapsed)` saturates to `0` and `refund = 0` — the current period is fully consumed, nothing to prorate. Since there's nothing to refund, Dana just calls plain `cancel(dana)`. State: **Cancelled**. `active_count` and the merchant's subscriber count both decrement; `Referral(dana)`, if any, is removed.

9. **`t = 9,000,000` — Dana decides to come back.**
   She calls `subscribe()` again. This is a completely new record — old `amount`/`interval`/`trial_duration` are not carried over, and she can pick a different `token` if she wants (see [MULTI-TOKEN.md § Switching Tokens](./MULTI-TOKEN.md#switching-tokens)). State: **Active (Trial)** or **Active (Standard)**, depending on whether she supplies a new `trial_period`.

---

For the exact storage keys, TTLs, and validation-constraint tables behind every rule above, see [`docs/spec/lifecycle_spec.md`](./spec/lifecycle_spec.md).
