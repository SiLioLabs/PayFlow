# Subscriber & Merchant FAQ

Plain-language answers for subscribers (payers) and merchants (receivers). Operators should use [operations/TROUBLESHOOTING.md](operations/TROUBLESHOOTING.md) and the full [ERROR-CODES.md](ERROR-CODES.md) recovery playbook instead.

**Conventions:** amounts are in **stroops** (10,000,000 stroops = 1 XLM). Every answer links to the contract error code(s) it covers. The [error-code coverage table](#error-code-coverage) at the bottom reaches every code 1–47 so no `ContractError` is orphaned.

**UI wiring:** `frontend/src/utils/errors.ts` (`CONTRACT_ERRORS` + `friendlyError()`) is the message map the UI shows; each message there points back here. See [How error messages reach this FAQ](#how-error-messages-reach-this-faq).

---

## Subscriber questions

### Subscriber: How do I subscribe?

1. Approve the PayFlow contract to pull your token (`approve` on the SAC for at least one billing `amount` — approve several cycles to avoid monthly re-signs).
2. Call `subscribe(user, merchant, amount, interval, token, trial_period, referrer)`.
3. Confirm with `get_subscription(user)`.

Fails with `InsufficientAllowance` (8) if you skipped step 1, `MerchantNotWhitelisted` (10) / `MerchantFrozen` (22) for merchant issues, `InvalidTokenAddress` (12) for a wrong SAC, or `ContractPaused` (18) during maintenance.

Related codes: 8, 10, 12, 18, 22.

### Subscriber: Why did my subscribe fail?

Work through this checklist in order:

- **Amount/interval rejected** — codes 2 (`AmountMustBePositive`), 3 (`IntervalMustBePositive`), 19 (`IntervalTooShort`, below 60s or admin `min_interval`), 15 (`AmountExceedsMaximum`), 46 (`IntervalExceedsMaximum`, above ~400 years).
- **Allowance** — code 8 (`InsufficientAllowance`): approve more on the SAC first.
- **Merchant** — code 10 (`MerchantNotWhitelisted`, ask admin to `add_merchant`) or 22 (`MerchantFrozen`, pick another merchant or wait for `unfreeze_merchant`).
- **Referrer** — code 11 (`SelfReferral`): clear the referrer field or use a different address.
- **Token** — code 12 (`InvalidTokenAddress`): use the network SAC address, not a random account.
- **Protocol state** — code 7 (`NotInitialized`, deploy not finished), 18 (`ContractPaused`, maintenance), 42 (`SchemaMigrationRequired`, admin must page `migrate` first).

Related codes: 2, 3, 7, 8, 10, 11, 12, 15, 18, 19, 22, 42, 46.

### Subscriber: How much allowance should I approve?

Allowance is your SAC pre-authorization letting PayFlow pull each billing amount via `transfer_from`. Each `charge` consumes one `amount` from it. Approve a buffer (e.g. 6 cycles: `amount × 6`) so the second charge does not fail.

- Check: `allowance --owner <YOU> --spender <CONTRACT_ID>` on the token contract.
- Top up: `approve --from <YOU> --spender <CONTRACT_ID> --amount <N> --expiry 6307200` or the `IncreaseAllowanceModal` in the UI.
- Expiry matters: allowances expire — re-approve before the ledger expiry if you subscribe long-term.

Failures surface as code 8 (`InsufficientAllowance`) on single `charge`, or `AllowanceInsufficient` in `batch_charge` / simulation results.

Related codes: 8.

### Subscriber: Why did my charge fail?

- **Too early** — code 6 (`IntervalNotElapsed`): `now < last_charged + interval`. Wait until `next_charge_at(user)`; keepers treat this as `Skipped`, not an error.
- **Too late** — code 9 (`GracePeriodElapsed`): `now > last_charged + interval + grace_period`. You must re-subscribe.
- **Paused** — code 17 (`SubscriptionPaused`): you paused — `resume` first. Code 18 (`ContractPaused`): protocol-wide pause, wait for admin `unpause_contract`.
- **Inactive/missing** — code 5 (`SubscriptionInactive`, cancelled) or 4 (`NoSubscriptionFound`, never subscribed).
- **Funds** — code 8 (`InsufficientAllowance`) or a balance failure: top up allowance/balance.
- **Protocol caps** — code 28 (`GlobalVolumeExceeded`, retry next hour window).

Related codes: 4, 5, 6, 8, 9, 17, 18, 28.

### Subscriber: What is the grace period?

A contract-wide window after each due date during which a late `charge` still succeeds: `[last_charged + interval, last_charged + interval + grace_period]`. Default is `0` (charge any time after due). When `grace_period > 0` and the keeper misses the window, `charge` panics with code 9 (`GracePeriodElapsed`), `batch_charge` returns `GracePeriodElapsed`, and `resume` after the window panics with code 43 (`ResumeGraceLapsed`). Either way the fix is `cancel` + re-`subscribe`.

Related codes: 9, 43.

### Subscriber: How do trial periods work?

Pass `trial_period: Some(seconds)` to `subscribe`. The contract sets `last_charged = now + trial` so the first charge waits `trial + interval`. During trial `pay_per_use` works, `charge` returns `IntervalNotElapsed` (6) until the trial ends. Check with `get_trial_end(user)` (`Some(ts)` = in trial, `None` = trial over). No separate trial flag exists — it is encoded in `last_charged`.

Related codes: 6.

### Subscriber: How do I pause and resume?

- `pause()` — indefinite; `paused = true`, `PauseExpiry = u64::MAX`. Exit with `resume()`.
- `pause_until(user, expiry)` — bounded; `expiry` must be strictly in the future or code 27 (`InvalidPauseExpiry`). Auto-resumes on the next `charge`/`batch_charge` after `expiry` (emits `subscription_auto_resumed`).
- While paused, `charge`/`pay_per_use` panic with code 17 (`SubscriptionPaused`).
- `resume` after the grace window panics with code 43 (`ResumeGraceLapsed`) — then re-subscribe instead.
- `pause` on a missing/cancelled sub panics with 4 (`NoSubscriptionFound`) / 5 (`SubscriptionInactive`) / 16 (`SubscriptionNotActive`).

Related codes: 4, 5, 16, 17, 27, 43.

### Subscriber: How do I cancel?

`cancel(user)` (you sign) sets `active = false`, keeps history/metadata for audit, and emits `cancelled`. After that `charge`/`pay_per_use`/`pause`/`resume` all fail (codes 5, 16, 17); only a fresh `subscribe` reactivates. `cancel_and_refund_prorated(user, merchant)` needs **both** signatures and refunds the unused fraction; it fails with 38 (`RefundMerchantMismatch`) if the caller is not the sub's merchant, 39 (`RefundAmountMustBePositive`) when nothing is left to prorate, or 40 (`InsufficientMerchantBalance`) when the merchant cannot fund it.

Related codes: 4, 5, 16, 17, 38, 39, 40.

### Subscriber: Daily limits and pay per use

`pay_per_use(user, amount)` is an instant one-off against an active subscription (trial counts). It respects a per-user daily cap: exceeding it panics with code 25 (`DailyLimitExceeded`). Check `get_daily_limit_status(user)` for `remaining`. Raise/remove via `set_daily_limit` / `remove_daily_limit`. `amount <= 0` panics with code 2, over-cap amounts with 15. `pay_per_use_to(user, amount, recipient)` routes to a third party instead — bad recipients panic with 32 (`InvalidRecipient`) or 10 (`MerchantNotWhitelisted`).

Related codes: 2, 4, 5, 10, 15, 17, 18, 25, 32.

### Subscriber: Archived or entry expired errors

Stellar evicted the subscription entry from ledger state (TTL elapsed). This is storage expiry, not cancellation. Use the UI **Restore** action (or `extend_subscription_ttl` / `bump_subscription`) then retry. Keepers should call `batch_extend_subscription_ttl` for dormant users. The frontend maps `entryexpired` / `archived` / `-32700` to this message.

Related codes: none (host TTL, not a `ContractError`) — see `architecture/STORAGE-AND-TTL.md`.

### Subscriber: Service temporarily unavailable

That is the UI wording for protocol-level blocks: code 7 (`NotInitialized`, deploy unfinished), 18 (`ContractPaused`, admin circuit breaker — deprecated alias 30 means the same on old WASM), or 42 (`SchemaMigrationRequired`, admin must finish paged `migrate` to schema v3). Nothing you re-sign will succeed — wait for the operator and retry after `contract_health_check` is healthy.

Related codes: 7, 18, 30, 42.

### Subscriber: How do I transfer my subscription?

Yes via `transfer_subscription`. The destination must not already hold an active subscription or it panics with code 24 (`SubscriptionAlreadyActive`) — cancel/move that one first, then retry.

Related codes: 4, 24.

---

## Merchant questions

### Merchant: How do I start accepting revenue?

1. Give the admin your `G…` address; confirm `is_whitelist_enabled` / `is_merchant_whitelisted(you)`. If the whitelist is on and you are missing, subscribers get code 10.
2. Confirm `is_merchant_frozen(you) == false` (code 22 blocks new subs while frozen).
3. Share your address as `merchant` in their `subscribe` call.
4. Ensure a keeper calls `charge`/`batch_charge` after each interval — Soroban has no cron.

Related codes: 10, 22.

### Merchant: Why did my withdrawal fail?

- **Nothing to withdraw** — code 21 (`ZeroBalanceAvailable`): `get_merchant_revenue(you)` is zero. Wait for the next `charged` event.
- **Protocol paused** — code 18: `unpause_contract` (admin) first.
- **Not initialized** — code 7: deploy not finished.
- **Wrong caller** — `withdraw_merchant_revenue(merchant)` needs the merchant's signature (`require_auth`).

Related codes: 7, 18, 21.

### Merchant: Why is my revenue lower than expected?

1. **Protocol fee** — `net = gross - fee` (`fee = amount × bps / 10_000`). Inspect `charged` events for `gross`, `fee`, and `net`. Bad fee setups panic with 13 (`InvalidFeeBps`), 26 (`InvalidFeeCollector`), 34 (`InvalidFeeBounds`), or 35 (`FeeOutOfBoundsAtCommit`).
2. **You compared gross to `get_merchant_revenue`** — the counter tracks **net** only.
3. **Fee-recipient redirect** — funds land in `MerchantFeeRecipient` while counters still attribute to you.
4. **Multi-token mixing** — counters are token-agnostic integers; rebuild per-token totals from events.
5. **Paused/cancelled users** — they stop emitting `charged`; check `get_merchant_sub_count`.
6. **Volume cap** — code 28 (`GlobalVolumeExceeded`) skipped charges this window.
7. **Refund path** — `cancel_and_refund_prorated` debits you directly (codes 38–40).

Related codes: 13, 26, 28, 34, 35, 38, 39, 40.

### Merchant: Why are my subscribers not being charged?

Check in order: `get_subscription(user)` (`active`/`paused`/`merchant`), `is_charge_due(user)` (interval elapsed?), keeper running (`charge`/`batch_charge` — no scheduler on-chain), grace window (`get_grace_period` + code 9), allowance/balance (code 8), frozen/pause flags (`is_merchant_frozen`, `is_contract_paused`), trial still running (`get_trial_end`). Admin-side misconfiguration shows as 7, 18, 29 (`InvalidBatchSize`), 33 (`InvalidVolumeCap`), 36 (`ArithmeticOverflow`).

Related codes: 4, 5, 6, 7, 8, 9, 17, 18, 29, 33, 36.

### Merchant: How do refunds work?

Only via `cancel_and_refund_prorated(user, merchant)` with **both** signatures. The refund is a linear proration `(remaining / interval) × amount` paid from **your** balance — not escrowed. Failures: 38 (wrong merchant caller), 39 (proration rounds to zero — send a manual goodwill payment instead), 40 (your accrued `get_merchant_revenue` is too small — top up via charges or pay the difference directly).

Related codes: 38, 39, 40.

### Merchant: Labels, fees, and freezes

- **Labels**: `subscribe_with_metadata` / `set_metadata` label ≤ 64 bytes or code 14 (`MetadataLabelTooLong`).
- **Freeze reasons**: `freeze_merchant` reason ≤ 128 bytes or code 47 (`FreezeReasonTooLong`); idempotent if already frozen.
- **Fee collector**: must be a real treasury account, never the contract address, or code 26. Bounds need `min_bps ≤ max_bps ≤ 10000` or code 34; committing a pending fee outside bounds panics with 35. Setting fee `bps > 10000` panics with 13. Clearing the subscriber index of a live user panics with 41 (`CannotClearActiveSubscriber`) — cancel first.
- **Admin bootstrap**: `set_initial_admin` after admin exists panics with 44 (`AdminAlreadySet`); `accept_admin` with no staged transfer panics with 45 (`NoPendingAdmin`); two-step commits with no proposal panic with 23 (`NoPendingProposal`).
- **Batches**: too many users panics with 20 (`BatchTooLarge`, default max 50, ceiling 200); a zero/oversize configured cap panics with 29; `initialize` twice panics with 1 (`AlreadyInitialized`); an interval above ~400 years panics with 46.

Related codes: 1, 13, 14, 20, 23, 26, 29, 34, 35, 41, 44, 45, 46, 47.

### Merchant: Pause vs freeze vs contract pause

- **Subscriber pause** (`pause`/`pause_until`, code 17 on charge): user-level, per subscription. `resume` or auto-resume exits.
- **Merchant freeze** (`freeze_merchant`, code 22 on subscribe): admin-level, per merchant. `unfreeze_merchant` exits.
- **Contract pause** (`pause_contract`, code 18 on everything): admin circuit breaker, global. `unpause_contract` exits; keepers must stop.

Related codes: 17, 18, 22.

### Merchant: Destination already has an active subscription

`transfer_subscription` to an address that already holds one panics with code 24. Cancel or move the destination's existing sub first, or pick another recipient. Readers see the occupied slot via `get_subscription(target)` / `get_subscriber_at(i)`.

Related codes: 24.

### Merchant: Amount and interval validation errors

Client-side validation messages for codes 15 (`AmountExceedsMaximum`), 2 (`AmountMustBePositive`), 3 (`IntervalMustBePositive`), 19 (`IntervalTooShort`, below `max(60, min_interval)`), and 46 (`IntervalExceedsMaximum`, above `MAX_SUBSCRIPTION_INTERVAL`). Clamp inputs in the form and fetch `get_min_interval` at load.

Related codes: 2, 3, 15, 19, 46.

### Merchant: Keeper ChargeResult values

`batch_charge` never aborts on per-user skips — map each element: `Charged` (success), `Skipped` (6, too early — show "Next charge at …"), `NoSubscription` (4, prompt subscribe), `Inactive` (5, cancelled), `Paused` (17, show Resume), `GracePeriodElapsed` (9, re-subscribe), `AllowanceInsufficient` (8, prompt top-up). Transaction-level aborts are `BatchTooLarge` (20, split the batch) and `ContractPaused` (18/30, stop and page on-call). Full table: [KEEPER.md](KEEPER.md), [CHARGE-RESULTS](CHARGE-RESULTS.md).

Related codes: 4, 5, 6, 8, 9, 17, 18, 20, 30.

### Merchant: Arithmetic overflow vs volume cap

Probably not a typo. Code 36 (`ArithmeticOverflow`) means inputs or accumulated state hit a type limit (e.g. near-`u64::MAX` trial extension, huge amount) — shrink the input and do not blind-retry. Code 28 (`GlobalVolumeExceeded`) means the protocol's hourly cap tripped (policy, not math) — retry next window or ask admin about `set_global_volume_cap` (non-positive caps panic with 33). Distinguish them before escalating.

Related codes: 28, 33, 36.

### Merchant: No pending proposal errors

A two-step ceremony (`transfer_admin` → `accept_admin`, `propose_fee` → `commit_fee`, `propose_grace_period` → `commit_grace_period`, `propose_upgrade` → `commit_upgrade`) was committed/accepted without the propose step, or the proposal expired. Code 23 (`NoPendingProposal`, also 45 for the admin variant). Re-run the propose step inside one ops window. See [architecture/TWO-STEP-AUTH.md](architecture/TWO-STEP-AUTH.md).

Related codes: 23, 45.

---

## How error messages reach this FAQ

`frontend/src/utils/errors.ts` exports `CONTRACT_ERRORS` (one entry per numeric `error(contract, #N)`, checked against `contract/src/errors.rs` by `src/utils/errors.test.ts`) and `friendlyError(raw)`. Every UI error path calls `friendlyError()` — the returned copy is the wording in this FAQ, and each FAQ answer lists its codes so a user can search by number (e.g. "code 8") or by message (e.g. "Increase your token allowance").

---

## Error-code coverage

Every numeric `ContractError` 1–47 is reachable from at least one answer above (30/31 are deprecated/reserved aliases, 37 is an intentional gap).

| Code | Name | Covered in |
| --- | --- | --- |
| 1 | `AlreadyInitialized` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |
| 2 | `AmountMustBePositive` | [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use), [Amount and interval validation errors](#merchant-amount-and-interval-validation-errors) |
| 3 | `IntervalMustBePositive` | [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Amount and interval validation errors](#merchant-amount-and-interval-validation-errors) |
| 4 | `NoSubscriptionFound` | [Why did my charge fail?](#subscriber-why-did-my-charge-fail), [How do I pause and resume?](#subscriber-how-do-i-pause-and-resume), [How do I cancel?](#subscriber-how-do-i-cancel), [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use), [How do I transfer my subscription?](#subscriber-how-do-i-transfer-my-subscription), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 5 | `SubscriptionInactive` | [Why did my charge fail?](#subscriber-why-did-my-charge-fail), [How do I pause and resume?](#subscriber-how-do-i-pause-and-resume), [How do I cancel?](#subscriber-how-do-i-cancel), [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 6 | `IntervalNotElapsed` | [Why did my charge fail?](#subscriber-why-did-my-charge-fail), [How do trial periods work?](#subscriber-how-do-trial-periods-work), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 7 | `NotInitialized` | [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Service temporarily unavailable](#subscriber-service-temporarily-unavailable), [Why did my withdrawal fail?](#merchant-why-did-my-withdrawal-fail), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged) |
| 8 | `InsufficientAllowance` | [How do I subscribe?](#subscriber-how-do-i-subscribe), [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [How much allowance should I approve?](#subscriber-how-much-allowance-should-i-approve), [Why did my charge fail?](#subscriber-why-did-my-charge-fail), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 9 | `GracePeriodElapsed` | [Why did my charge fail?](#subscriber-why-did-my-charge-fail), [What is the grace period?](#subscriber-what-is-the-grace-period), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 10 | `MerchantNotWhitelisted` | [How do I subscribe?](#subscriber-how-do-i-subscribe), [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use), [How do I start accepting revenue?](#merchant-how-do-i-start-accepting-revenue) |
| 11 | `SelfReferral` | [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail) |
| 12 | `InvalidTokenAddress` | [How do I subscribe?](#subscriber-how-do-i-subscribe), [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail) |
| 13 | `InvalidFeeBps` | [Why is my revenue lower than expected?](#merchant-why-is-my-revenue-lower-than-expected), [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |
| 14 | `MetadataLabelTooLong` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |
| 15 | `AmountExceedsMaximum` | [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use), [Amount and interval validation errors](#merchant-amount-and-interval-validation-errors) |
| 16 | `SubscriptionNotActive` | [How do I pause and resume?](#subscriber-how-do-i-pause-and-resume), [How do I cancel?](#subscriber-how-do-i-cancel), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged) |
| 17 | `SubscriptionPaused` | [Why did my charge fail?](#subscriber-why-did-my-charge-fail), [How do I pause and resume?](#subscriber-how-do-i-pause-and-resume), [How do I cancel?](#subscriber-how-do-i-cancel), [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use), [Pause vs freeze vs contract pause](#merchant-pause-vs-freeze-vs-contract-pause), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 18 | `ContractPaused` | [How do I subscribe?](#subscriber-how-do-i-subscribe), [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Why did my charge fail?](#subscriber-why-did-my-charge-fail), [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use), [Service temporarily unavailable](#subscriber-service-temporarily-unavailable), [Why did my withdrawal fail?](#merchant-why-did-my-withdrawal-fail), [Pause vs freeze vs contract pause](#merchant-pause-vs-freeze-vs-contract-pause), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 19 | `IntervalTooShort` | [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Amount and interval validation errors](#merchant-amount-and-interval-validation-errors) |
| 20 | `BatchTooLarge` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 21 | `ZeroBalanceAvailable` | [Why did my withdrawal fail?](#merchant-why-did-my-withdrawal-fail) |
| 22 | `MerchantFrozen` | [How do I subscribe?](#subscriber-how-do-i-subscribe), [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [How do I start accepting revenue?](#merchant-how-do-i-start-accepting-revenue), [Pause vs freeze vs contract pause](#merchant-pause-vs-freeze-vs-contract-pause) |
| 23 | `NoPendingProposal` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes), [No pending proposal errors](#merchant-no-pending-proposal-errors) |
| 24 | `SubscriptionAlreadyActive` | [How do I transfer my subscription?](#subscriber-how-do-i-transfer-my-subscription), [Destination already has an active subscription](#merchant-destination-already-has-an-active-subscription) |
| 25 | `DailyLimitExceeded` | [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use) |
| 26 | `InvalidFeeCollector` | [Why is my revenue lower than expected?](#merchant-why-is-my-revenue-lower-than-expected), [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |
| 27 | `InvalidPauseExpiry` | [How do I pause and resume?](#subscriber-how-do-i-pause-and-resume) |
| 28 | `GlobalVolumeExceeded` | [Why did my charge fail?](#subscriber-why-did-my-charge-fail), [Why is my revenue lower than expected?](#merchant-why-is-my-revenue-lower-than-expected), [Arithmetic overflow vs volume cap](#merchant-arithmetic-overflow-vs-volume-cap) |
| 29 | `InvalidBatchSize` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged) |
| 30 | `ContractPausedError` (deprecated alias of 18) | [Service temporarily unavailable](#subscriber-service-temporarily-unavailable), [Keeper ChargeResult values](#merchant-keeper-chargeresult-values) |
| 31 | `Reserved31` (reserved, never emitted) | Here: reserved slot, no action needed — kept mapped in `frontend/src/utils/errors.ts` |
| 32 | `InvalidRecipient` | [Daily limits and pay per use](#subscriber-daily-limits-and-pay-per-use) |
| 33 | `InvalidVolumeCap` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes), [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Arithmetic overflow vs volume cap](#merchant-arithmetic-overflow-vs-volume-cap) |
| 34 | `InvalidFeeBounds` | [Why is my revenue lower than expected?](#merchant-why-is-my-revenue-lower-than-expected), [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |
| 35 | `FeeOutOfBoundsAtCommit` | [Why is my revenue lower than expected?](#merchant-why-is-my-revenue-lower-than-expected), [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |
| 36 | `ArithmeticOverflow` | [Why are my subscribers not being charged?](#merchant-why-are-my-subscribers-not-being-charged), [Arithmetic overflow vs volume cap](#merchant-arithmetic-overflow-vs-volume-cap) |
| 37 | *(unassigned gap)* | Here: intentional gap, never emitted — no new code may reuse 37 |
| 38 | `RefundMerchantMismatch` | [How do I cancel?](#subscriber-how-do-i-cancel), [Why is my revenue lower than expected?](#merchant-why-is-my-revenue-lower-than-expected), [How do refunds work?](#merchant-how-do-refunds-work) |
| 39 | `RefundAmountMustBePositive` | [How do I cancel?](#subscriber-how-do-i-cancel), [Why is my revenue lower than expected?](#merchant-why-is-my-revenue-lower-than-expected), [How do refunds work?](#merchant-how-do-refunds-work) |
| 40 | `InsufficientMerchantBalance` | [How do I cancel?](#subscriber-how-do-i-cancel), [Why is my revenue lower than expected?](#merchant-why-is-my-revenue-lower-than-expected), [How do refunds work?](#merchant-how-do-refunds-work) |
| 41 | `CannotClearActiveSubscriber` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |
| 42 | `SchemaMigrationRequired` | [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Service temporarily unavailable](#subscriber-service-temporarily-unavailable) |
| 43 | `ResumeGraceLapsed` | [What is the grace period?](#subscriber-what-is-the-grace-period), [How do I pause and resume?](#subscriber-how-do-i-pause-and-resume) |
| 44 | `AdminAlreadySet` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |
| 45 | `NoPendingAdmin` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes), [No pending proposal errors](#merchant-no-pending-proposal-errors) |
| 46 | `IntervalExceedsMaximum` | [Why did my subscribe fail?](#subscriber-why-did-my-subscribe-fail), [Labels, fees, and freezes](#merchant-labels-fees-and-freezes), [Amount and interval validation errors](#merchant-amount-and-interval-validation-errors) |
| 47 | `FreezeReasonTooLong` | [Labels, fees, and freezes](#merchant-labels-fees-and-freezes) |

Source of truth for codes: [`contract/src/errors.rs`](../contract/src/errors.rs), [ERROR-CODES.md](ERROR-CODES.md).
