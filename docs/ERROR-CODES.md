# Error Codes Reference & Recovery Playbook

This document is the complete reference for all error codes returned by the FlowPay smart contract (`contract/src/errors.rs`). Each error includes when it occurs, the immediate cause, numbered recovery steps, and prevention advice.

Use the [quick-reference table](#quick-reference-table) for lookups, then jump to the detailed recovery section for that code. Audience-specific walkthroughs are at the end:

- [Common error scenarios](#common-error-scenarios)
- [Keeper operators (`batch_charge`)](#keeper-operators-batch_charge)
- [Frontend developers](#frontend-developers)

---

## Quick-Reference Table

| Code | Name                        | Category     | When it occurs (short)             |
| ---- | --------------------------- | ------------ | ---------------------------------- |
| 1    | `AlreadyInitialized`        | State        | `initialize()` called twice        |
| 2    | `AmountMustBePositive`      | Validation   | Amount ≤ 0                         |
| 3    | `IntervalMustBePositive`    | Validation   | Interval ≤ 0                       |
| 4    | `NoSubscriptionFound`       | State        | No subscription for user/token     |
| 5    | `SubscriptionInactive`      | State        | Charge/pay on cancelled sub        |
| 6    | `IntervalNotElapsed`        | Limit        | Charge before interval ends        |
| 7    | `NotInitialized`            | State        | Call before `initialize()`         |
| 8    | `InsufficientAllowance`     | Auth / Limit | Token allowance too low            |
| 9    | `GracePeriodElapsed`        | Limit        | Charge after grace window          |
| 10   | `MerchantNotWhitelisted`    | Auth         | Merchant not on whitelist          |
| 11   | `SelfReferral`              | Validation   | Referrer == subscriber             |
| 12   | `InvalidTokenAddress`       | Validation   | Token is not a contract/SAC        |
| 13   | `InvalidFeeBps`             | Validation   | Fee bps > 10000                    |
| 14   | `MetadataLabelTooLong`      | Validation   | Label > 64 bytes                   |
| 15   | `AmountExceedsMaximum`      | Limit        | Amount above max                   |
| 16   | `SubscriptionNotActive`     | State        | Op requires active sub             |
| 17   | `SubscriptionPaused`        | State        | Charge while user-paused           |
| 18   | `ContractPaused`            | State        | Op while protocol paused           |
| 19   | `IntervalTooShort`          | Validation   | Interval below min floor           |
| 20   | `BatchTooLarge`             | Limit        | Batch size above max               |
| 21   | `ZeroBalanceAvailable`      | State        | Merchant withdraw with 0           |
| 22   | `MerchantFrozen`            | Auth         | Subscribe to frozen merchant       |
| 23   | `NoPendingProposal`         | State        | Commit without proposal            |
| 24   | `SubscriptionAlreadyActive` | State        | Transfer target already subscribed |
| 25   | `DailyLimitExceeded`        | Limit        | `pay_per_use` over daily cap       |
| 26   | `InvalidFeeCollector`       | Validation   | Fee collector invalid              |
| 27   | `InvalidPauseExpiry`        | Validation   | Pause expiry not in future         |
| 28   | `GlobalVolumeExceeded`      | Limit        | Protocol volume cap hit            |
| 29   | `InvalidBatchSize`          | Validation   | Configured batch limit invalid     |
| 30   | `ContractPausedError`       | State        | Subscribe while paused             |
| 32   | `InvalidRecipient`          | Validation   | Recipient address invalid          |
| 33   | `InvalidVolumeCap`          | Validation   | Volume cap override not positive   |
| 34   | `InvalidFeeBounds`          | Validation   | Fee bounds min/max invalid         |
| 35   | `FeeOutOfBoundsAtCommit`    | Validation   | Pending fee outside bounds         |
| 36   | `ArithmeticOverflow`        | State        | Checked arithmetic would overflow  |
| 41   | `CannotClearActiveSubscriber` | State      | Admin index repair of an active subscriber |

> **Note:** Code `31` is intentionally unused. Source of truth: [`contract/src/errors.rs`](../contract/src/errors.rs).

---

## Recovery by Error Code

### 1 — `AlreadyInitialized`

| Field               | Detail                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| **When it occurs**  | Calling `initialize()` on a contract that already has an admin/token configured |
| **Immediate cause** | Instance storage already holds initialization state                             |

**Recovery steps**

1. Confirm the contract ID — you may be targeting an already-deployed instance.
2. If you need a fresh deployment, upload WASM and deploy a **new** contract ID.
3. Do not retry `initialize()` on the live instance; use admin/config entrypoints instead.

**Prevention:** Run deploy scripts that call `initialize()` only once and persist the contract ID in env/config.

---

### 2 — `AmountMustBePositive`

| Field               | Detail                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| **When it occurs**  | `subscribe()`, `pay_per_use()`, or amount setters receive `amount <= 0` |
| **Immediate cause** | Validation rejects non-positive amounts                                 |

**Recovery steps**

1. Inspect the amount passed from the client (watch for unit mistakes: stroops vs whole tokens).
2. Resubmit with `amount > 0`.
3. If the UI allows zero, fix client-side validation before signing.

**Prevention:** Validate `amount > 0` in the frontend and keeper before invoking the contract.

---

### 3 — `IntervalMustBePositive`

| Field               | Detail                                                      |
| ------------------- | ----------------------------------------------------------- |
| **When it occurs**  | `subscribe()` (or interval setters) receive `interval <= 0` |
| **Immediate cause** | Interval failed the positive check                          |

**Recovery steps**

1. Ensure interval is expressed in **seconds** and is greater than zero.
2. Also satisfy the minimum floor (see error `19`); positive alone is not enough if `set_min_interval` is high.
3. Resubmit `subscribe()` with a valid interval.

**Prevention:** Clamp interval inputs to `max(60, min_interval)` in the UI.

---

### 4 — `NoSubscriptionFound`

| Field               | Detail                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| **When it occurs**  | `charge()`, `pause()`, `resume()`, `cancel()`, getters, or related ops for a user with no stored subscription |
| **Immediate cause** | Persistent storage has no `Subscription` for that user                                                        |

**Recovery steps**

1. Call a read helper (e.g. subscription getter) to confirm the user/token pair.
2. Have the user call `subscribe()` (or `subscribe_with_metadata()`) first.
3. If transferring, ensure the source still has a subscription before operating on it.

**Prevention:** Indexers and keepers should skip addresses not present in the subscriber index.

---

### 5 — `SubscriptionInactive`

| Field               | Detail                                                         |
| ------------------- | -------------------------------------------------------------- |
| **When it occurs**  | Charging or paying against a cancelled / inactive subscription |
| **Immediate cause** | Subscription exists but `active == false`                      |

**Recovery steps**

1. Confirm status via read functions or events (`cancelled`).
2. Ask the user to re-subscribe if they still want service.
3. Remove inactive addresses from keeper charge queues to avoid repeated failures.

**Prevention:** Filter `batch_charge` inputs to active subscribers only.

---

### 6 — `IntervalNotElapsed`

| Field               | Detail                                                     |
| ------------------- | ---------------------------------------------------------- |
| **When it occurs**  | `charge()` / batch charge before `last_charged + interval` |
| **Immediate cause** | Billing interval has not completed                         |

**Recovery steps**

1. Read `last_charged` and `interval`; compute `next_eligible = last_charged + interval`.
2. Wait until ledger time ≥ `next_eligible`.
3. Retry the charge (or let the next keeper cycle pick it up).

**Prevention:** Keepers should treat this as `Skipped` / expected noise, not an alert-worthy failure.

---

### 7 — `NotInitialized`

| Field               | Detail                                                        |
| ------------------- | ------------------------------------------------------------- |
| **When it occurs**  | Any operational call before successful `initialize()`         |
| **Immediate cause** | Admin/token (or related) config missing from instance storage |

**Recovery steps**

1. Verify deployment completed and `initialize(token, admin, …)` succeeded.
2. Run post-deploy verification (`scripts/verify-contract.sh` or health reads).
3. Only then open the contract to users/keepers.

**Prevention:** Gate frontend and keeper startup on a successful health/schema check.

---

### 8 — `InsufficientAllowance`

| Field               | Detail                                                               |
| ------------------- | -------------------------------------------------------------------- |
| **When it occurs**  | Charge, subscribe, or pay-per-use path finds token allowance below required amount |
| **Immediate cause** | SAC `allowance(user → FlowPay)` is too low or spent down             |

`charge()` and `pay_per_use*()` preflight the allowance against the **gross**
amount before any transfer runs. When a protocol fee is configured the charge
is pulled in two legs (fee → collector, net → merchant) against that same
allowance, so an allowance covering only the fee leg is rejected up front
rather than part-way through. Budget for `amount`, not `amount - fee`.

`batch_charge()` does **not** raise this error: it records
`ChargeResult::AllowanceInsufficient` for that subscriber and continues the
batch. See [`EVENTS.md`](EVENTS.md#batch_charge_skips).

**Recovery steps**

1. Query the token contract allowance for `(from=user, spender=FlowPay)`.
2. Have the user call `approve()` (or increase allowance) for at least one billing cycle — preferably several cycles for recurring plans.
3. Retry `subscribe()` / `charge()` / `pay_per_use()`.

**Prevention:** Prompt users to approve a buffer (e.g. N cycles). Surface low-allowance warnings in the UI before charge day.

---

### 9 — `GracePeriodElapsed`

| Field               | Detail                                                             |
| ------------------- | ------------------------------------------------------------------ |
| **When it occurs**  | Charge attempted after `last_charged + interval + grace_period`    |
| **Immediate cause** | Billing window closed; subscription treated as lapsed for charging |

**Recovery steps**

1. Confirm grace period via admin config / docs.
2. Inform the user the recurring charge window closed; they must **re-subscribe**.
3. For keepers: log the address, remove from retry-until-success loops, and alert if many lapse at once (missed cycles).

**Prevention:** Run keepers more frequently than the shortest interval; monitor cycle latency. See [docs/KEEPER.md](KEEPER.md).

---

### 10 — `MerchantNotWhitelisted`

| Field               | Detail                                                              |
| ------------------- | ------------------------------------------------------------------- |
| **When it occurs**  | Subscribe when whitelist mode is enabled and merchant is not listed |
| **Immediate cause** | `is_whitelist_enabled` and merchant missing from whitelist storage  |

**Recovery steps**

1. Admin: call `add_merchant(merchant)` or disable whitelist with `set_whitelist_enabled(false)` if policy allows.
2. User: retry subscribe after merchant is approved.
3. Confirm whitelist state with read helpers before marketing a merchant publicly.

**Prevention:** Onboard merchants through an admin checklist before listing them in the frontend.

---

### 11 — `SelfReferral`

| Field               | Detail                                    |
| ------------------- | ----------------------------------------- |
| **When it occurs**  | `subscribe()` with `referrer == user`     |
| **Immediate cause** | Referral validation rejects self-referral |

**Recovery steps**

1. Clear the referrer field or supply a different address.
2. Resubmit subscribe.

**Prevention:** Client-side check that referrer ≠ connected wallet.

---

### 12 — `InvalidTokenAddress`

| Field               | Detail                                                         |
| ------------------- | -------------------------------------------------------------- |
| **When it occurs**  | Initialize/subscribe with a non-contract / invalid SAC address |
| **Immediate cause** | Address fails contract/SAC validation                          |

**Recovery steps**

1. Confirm the address is the Stellar Asset Contract (SAC) for the asset, not a random account.
2. Use the network’s published SAC for the token.
3. Retry with the corrected address.

**Prevention:** Hard-code known SAC IDs per network in frontend config.

---

### 13 — `InvalidFeeBps`

| Field               | Detail                              |
| ------------------- | ----------------------------------- |
| **When it occurs**  | Fee proposal/set with `bps > 10000` |
| **Immediate cause** | Basis points outside `[0, 10000]`   |

**Recovery steps**

1. Recalculate fee: `10000` bps = 100%.
2. Propose/commit a value ≤ 10000.
3. Document the intended fee for operators.

**Prevention:** Admin UI max-value validation at 10000.

---

### 14 — `MetadataLabelTooLong`

| Field               | Detail                                                              |
| ------------------- | ------------------------------------------------------------------- |
| **When it occurs**  | `set_metadata` / subscribe-with-metadata label longer than 64 bytes |
| **Immediate cause** | Label byte length > 64                                              |

**Recovery steps**

1. Truncate or shorten the label to ≤ 64 bytes (UTF-8 aware).
2. Retry the metadata write.

**Prevention:** Enforce `label.length` / byte-length limits in the UI.

---

### 15 — `AmountExceedsMaximum`

| Field               | Detail                                         |
| ------------------- | ---------------------------------------------- |
| **When it occurs**  | Payment/subscription amount above protocol max |
| **Immediate cause** | Amount failed `require_valid_amount` max check |

**Recovery steps**

1. Read the configured maximum from docs/admin config.
2. Lower the amount, or (admin) raise the max if the product requires it.
3. Retry the call.

**Prevention:** Display max amount in subscribe/pay forms.

---

### 16 — `SubscriptionNotActive`

| Field               | Detail                                                               |
| ------------------- | -------------------------------------------------------------------- |
| **When it occurs**  | Lifecycle ops (e.g. pause flows) that require an active subscription |
| **Immediate cause** | Subscription state is not active                                     |

**Recovery steps**

1. Read current subscription state.
2. If cancelled, re-subscribe; if paused, use `resume()` where appropriate.
3. Retry the intended operation only when state matches the API contract.

**Prevention:** Disable UI actions that are invalid for the current status machine. See [SUBSCRIBER-LIFECYCLE.md](SUBSCRIBER-LIFECYCLE.md).

---

### 17 — `SubscriptionPaused`

| Field               | Detail                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| **When it occurs**  | `charge()` / `pay_per_use()` while the user has paused the subscription |
| **Immediate cause** | Pause flag / pause-until state blocks billing                           |

**Recovery steps**

1. User calls `resume()` (when pause expiry / policy allows).
2. Keeper: treat as skip — do not hammer retries.
3. After resume, wait until the next eligible interval before charging.

**Prevention:** Surface paused state clearly in the product UI; keepers map this to `Paused` / skip.

---

### 18 — `ContractPaused`

| Field               | Detail                                                     |
| ------------------- | ---------------------------------------------------------- |
| **When it occurs**  | Sensitive operations while the admin circuit breaker is on |
| **Immediate cause** | Instance `ContractPaused` flag is true                     |

**Recovery steps**

1. Confirm pause via health/status reads.
2. Contact protocol admin / follow incident runbook — only admin can `unpause_contract()`.
3. Keepers should stop cycling and alert (do not spam failed txs).

**Prevention:** Announce maintenance windows; use [keeper incident response](operations/keeper_runbook.md).

---

### 19 — `IntervalTooShort`

| Field               | Detail                                        |
| ------------------- | --------------------------------------------- |
| **When it occurs**  | Interval `< 60` or below admin `min_interval` |
| **Immediate cause** | Floor check in subscribe/validation           |

**Recovery steps**

1. Read `get_min_interval` (or equivalent) and use `interval >= max(60, min_interval)`.
2. Resubmit subscribe/update.

**Prevention:** Fetch min interval at app load and clamp inputs.

---

### 20 — `BatchTooLarge`

| Field               | Detail                                                       |
| ------------------- | ------------------------------------------------------------ |
| **When it occurs**  | `batch_charge` (or related batch APIs) with too many entries |
| **Immediate cause** | Batch length exceeds configured/hard max (typically 100)     |

**Recovery steps**

1. Reduce page size (e.g. `KEEPER_PAGE_SIZE=100` or lower).
2. Split the address list into multiple invocations.
3. Retry each smaller batch.

**Prevention:** Cap keeper page size in config; never exceed contract max.

---

### 21 — `ZeroBalanceAvailable`

| Field               | Detail                                                  |
| ------------------- | ------------------------------------------------------- |
| **When it occurs**  | `withdraw_merchant_revenue()` with zero accrued balance |
| **Immediate cause** | Merchant revenue storage is empty/zero                  |

**Recovery steps**

1. Confirm accrued revenue via merchant balance getters.
2. Wait until successful charges have credited the merchant.
3. Retry withdraw when balance > 0.

**Prevention:** Disable withdraw CTA when displayed balance is zero.

---

### 22 — `MerchantFrozen`

| Field               | Detail                                  |
| ------------------- | --------------------------------------- |
| **When it occurs**  | Subscribe to a merchant frozen by admin |
| **Immediate cause** | Merchant freeze flag set                |

**Recovery steps**

1. Choose a different merchant, or wait for admin `unfreeze_merchant()`.
2. Existing subscribers should follow admin guidance (charges may still be gated by other checks).

**Prevention:** Hide frozen merchants in discovery UI; poll freeze status.

---

### 23 — `NoPendingProposal`

| Field               | Detail                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| **When it occurs**  | Two-step commit (`accept_admin`, fee/grace commit, etc.) with no proposal |
| **Immediate cause** | Temporary proposal storage missing or expired                             |

**Recovery steps**

1. Re-run the propose step (`transfer_admin` / `propose_fee` / `propose_grace_period`, etc.).
2. Complete commit/accept before proposal TTL expires.
3. See [two-step auth](architecture/two-step-auth.md).

**Prevention:** Automate propose→commit within the same ops window; monitor proposal TTL.

---

### 24 — `SubscriptionAlreadyActive`

| Field               | Detail                                                                        |
| ------------------- | ----------------------------------------------------------------------------- |
| **When it occurs**  | `transfer_subscription` to an address that already has an active subscription |
| **Immediate cause** | Target user already holds an active sub                                       |

**Recovery steps**

1. Cancel or transfer away the target’s existing subscription first, **or** choose a different recipient.
2. Retry the transfer.

**Prevention:** Pre-check target subscription state in the UI.

---

### 25 — `DailyLimitExceeded`

| Field               | Detail                                                           |
| ------------------- | ---------------------------------------------------------------- |
| **When it occurs**  | `pay_per_use` would push `DailySpent + amount` over `DailyLimit` |
| **Immediate cause** | User-set daily spending cap                                      |

**Recovery steps**

1. Show remaining room: `DailyLimit - DailySpent`.
2. Wait for temporary storage TTL reset (~24h), or user raises/removes the limit via `set_daily_limit` / `remove_daily_limit`.
3. Retry with a smaller amount if appropriate.

**Prevention:** Display remaining daily budget before confirming pay-per-use. See [DAILY-LIMITS.md](DAILY-LIMITS.md).

---

### 26 — `InvalidFeeCollector`

| Field               | Detail                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| **When it occurs**  | Fee config uses an invalid collector (e.g. the contract’s own address) |
| **Immediate cause** | Fee module validation rejected collector                               |

**Recovery steps**

1. Set collector to a dedicated treasury/multisig account (not the contract ID).
2. Re-propose and commit the fee.

**Prevention:** Admin tooling blocklist of the contract address as collector.

---

### 27 — `InvalidPauseExpiry`

| Field               | Detail                                                            |
| ------------------- | ----------------------------------------------------------------- |
| **When it occurs**  | `pause_until` / pause APIs with expiry not strictly in the future |
| **Immediate cause** | `expiry_timestamp <= now`                                         |

**Recovery steps**

1. Choose an expiry timestamp strictly greater than current ledger time.
2. Retry the pause call.

**Prevention:** UI date picker minimum = now + 1 minute (or similar).

---

### 28 — `GlobalVolumeExceeded`

| Field               | Detail                                               |
| ------------------- | ---------------------------------------------------- |
| **When it occurs**  | A charge would exceed the protocol global volume cap |
| **Immediate cause** | Global volume accounting hit the configured ceiling  |

**Recovery steps**

1. Admin reviews volume limits and whether to raise or reset per governance.
2. Pause marketing of new high-volume flows until capacity is available.
3. Retry after admin adjustment (if approved).

**Prevention:** Monitor global volume metrics; alert before the ceiling.

---

### 29 — `InvalidBatchSize`

| Field               | Detail                                                                |
| ------------------- | --------------------------------------------------------------------- |
| **When it occurs**  | Admin/config sets an invalid batch size limit at initialize or update |
| **Immediate cause** | Configured batch limit fails validation                               |

**Recovery steps**

1. Use a positive batch size within the allowed range (respect hard max used by `BatchTooLarge`).
2. Re-run initialize/config with a valid value.

**Prevention:** Document allowed batch size range next to deploy scripts.

---

### 30 — `ContractPausedError`

| Field               | Detail                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| **When it occurs**  | New `subscribe()` (and similar entry paths) while the contract is paused                        |
| **Immediate cause** | Pause flag blocks new subscriptions (`ContractPausedError` distinct from code 18 on some paths) |

**Recovery steps**

1. Treat like a protocol pause: wait for admin `unpause_contract()`.
2. Do not prompt users to “try again” in a tight loop — show maintenance messaging.
3. Keepers should halt subscribe-related automation.

**Prevention:** Same as code 18 — coordinated pause/unpause communications.

---

### 32 — `InvalidRecipient`

| Field               | Detail                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| **When it occurs**  | Transfer/withdraw paths with an invalid recipient (e.g. contract address where an account is required) |
| **Immediate cause** | Recipient failed address-type validation                                                               |

**Recovery steps**

1. Use a valid account (or allowed) recipient address.
2. Retry the transfer/withdraw.

**Prevention:** Validate recipient type in the client before building the tx.

---

### 33 — `InvalidVolumeCap`

| Field               | Detail                                                         |
| ------------------- | -------------------------------------------------------------- |
| **When it occurs**  | Admin `set_global_volume_cap` with `new_cap <= 0`              |
| **Immediate cause** | Configured hourly volume cap must be strictly positive         |

**Recovery steps**

1. Choose a positive cap in stroops.
2. Retry `set_global_volume_cap` as admin.

**Prevention:** Validate `new_cap > 0` in admin tooling. See [`MAINNET-DEPLOYMENT.md`](./MAINNET-DEPLOYMENT.md#2-volume-cap).

---

### 34 — `InvalidFeeBounds`

| Field               | Detail                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| **When it occurs**  | Admin `set_fee_bounds` with `min_bps > max_bps` or `max_bps > 10_000`      |
| **Immediate cause** | Fee bound range is empty or exceeds 100% (10_000 bps)                       |

**Recovery steps**

1. Choose `min_bps <= max_bps` with `max_bps <= 10000`.
2. Retry `set_fee_bounds` as admin.

**Prevention:** Validate bounds in admin UI before signing. See [`API.md`](./API.md#set_fee_bounds).

---

### 35 — `FeeOutOfBoundsAtCommit`

| Field               | Detail                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- |
| **When it occurs**  | `commit_fee` when pending bps is outside current `[MinFeeBps, MaxFeeBps]`              |
| **Immediate cause** | Bounds were tightened (or never matched) between `propose_fee` and `commit_fee`        |

**Recovery steps**

1. Call `get_fee_bounds` and `get_fee` / inspect pending proposal.
2. Either `set_fee_bounds` to include the pending bps, or `propose_fee` again with in-range bps, then `commit_fee`.

**Prevention:** Set bounds before proposing; do not tighten bounds under an in-flight proposal unless that is intended.

---

### 36 — `ArithmeticOverflow`

| Field               | Detail                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **When it occurs**  | A checked operation would leave range: trial extension, fee multiplication, protocol-fee accrual, or global volume accumulation |
| **Immediate cause** | Inputs or accumulated state near the type's limit (`u64::MAX`, `i128::MAX`)                                  |

**Recovery steps**

1. Do not retry unchanged — the same inputs overflow deterministically.
2. Shrink the offending input (e.g. a smaller `additional_seconds` on `extend_trial`, a smaller amount).
3. If the overflow came from accumulated protocol state rather than the call's
   inputs, escalate: the counter, not the caller, is at its limit.

**Distinct from `28 GlobalVolumeExceeded`:** #28 means the protocol is at its
hourly volume cap (a policy decision, retry next window); #36 means the value
is not representable at all.

**Prevention:** Bound amounts and durations client-side against the documented caps.

---

### 41 — `CannotClearActiveSubscriber`

| Field               | Detail                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| **When it occurs**  | `clear_subscriber_index_entry` is called on a slot whose occupant still has an active subscription |
| **Immediate cause** | Admin repair refused: the index entry is not stale                                              |

**Recovery steps**

1. Confirm the occupant with `get_subscriber_at(index)` and `get_subscription(user)`.
2. If the subscription should remain live, do **not** clear the slot — keepers still need it.
3. If the subscriber should leave the index, cancel (or otherwise deactivate) first, then retry the repair only if the slot was left un-tombstoned.

**Prevention:** Use this repair only for stale/corrupt slots, never as a substitute for `cancel()`.

---

## Error Categories

| Category       | Codes                                    | Typical owners                |
| -------------- | ---------------------------------------- | ----------------------------- |
| Auth / access  | 8, 10, 22                                | User + admin                  |
| State          | 1, 4, 5, 7, 16, 17, 18, 21, 23, 24, 30, 36, 41 | Deployer, user, admin, keeper |
| Validation     | 2, 3, 11, 12, 13, 14, 19, 26, 27, 29, 32, 33, 34, 35 | Client / admin tooling        |
| Limit / timing | 6, 9, 15, 20, 25, 28                     | Keeper + user                 |

---

## Common Error Scenarios

### Scenario A — Subscription charge fails

**Symptoms:** Single `charge(user)` panics, or `batch_charge` returns non-`Charged` for a user.

**Walkthrough**

1. Decode the contract error code (or `ChargeResult` variant for batch).
2. Map with this playbook:
   - `6 IntervalNotElapsed` → wait; not a user bug.
   - `8 InsufficientAllowance` → user must re-approve.
   - `9 GracePeriodElapsed` → user must re-subscribe; investigate keeper lag.
   - `17 SubscriptionPaused` → user must resume.
   - `18` / `30` → protocol paused; stop retries.
   - `5` / `4` → inactive or missing; remove from queue.
3. Fix the root cause, then retry **once**.
4. If still failing, capture tx hash, user address, ledger time, and escalate.

### Scenario B — User can't subscribe

**Symptoms:** `subscribe()` / `subscribe_with_metadata()` fails in wallet.

**Walkthrough**

1. Check code:
   - `2` / `3` / `19` → fix amount/interval inputs.
   - `8` → approve token allowance first (and fund balance).
   - `10` / `22` → merchant not allowed / frozen.
   - `11` → bad referrer.
   - `12` → wrong SAC.
   - `7` / `18` / `30` → protocol not ready or paused.
2. Confirm network (testnet vs mainnet) and contract ID in frontend env.
3. Retry after the specific fix; avoid blind re-signs.

---

## Keeper Operators (`batch_charge`)

`batch_charge` is designed so **per-user failures should not abort the whole batch** when returned as `ChargeResult`. Full transaction panics (e.g. `BatchTooLarge`, `ContractPaused`) abort the invocation.

| Error / result                                 | Keeper action                               | Alert?              |
| ---------------------------------------------- | ------------------------------------------- | ------------------- |
| Interval not elapsed / Skipped                 | Continue; normal                            | No                  |
| InsufficientAllowance                          | Log user; optional user notify webhook      | Low                 |
| GracePeriodElapsed                             | Log + count; investigate cycle lag if spike | Yes if spike        |
| SubscriptionPaused / Inactive / None           | Skip; prune index cache                     | No                  |
| BatchTooLarge (20)                             | Lower page size; split batch                | Yes                 |
| ContractPaused (18) / ContractPausedError (30) | **Stop** the loop; page on-call             | Critical            |
| RPC / timeout                                  | Retry with backoff; failover RPC            | Yes after N retries |

**Recovery checklist for keepers**

1. Parse error code from logs / simulation.
2. Apply the table above — never infinite-retry grace or pause errors.
3. For DLQ / advanced failover, see [operations/keeper_runbook.md](operations/keeper_runbook.md) and [KEEPER.md](KEEPER.md).

---

## Frontend Developers

### Show to the user (user-facing copy)

| Codes        | Guidance                                                      |
| ------------ | ------------------------------------------------------------- |
| 8            | “Increase your token allowance and try again.”                |
| 9            | “This subscription lapsed. Please subscribe again.”           |
| 11           | “You cannot refer yourself.”                                  |
| 14           | “Label must be 64 bytes or fewer.”                            |
| 17           | “Resume your subscription to continue.”                       |
| 22           | “This merchant is temporarily unavailable.”                   |
| 24           | “Destination already has an active subscription.”             |
| 25           | “Daily spending limit reached. Try a smaller amount or wait.” |
| 27           | “Pick a pause end time in the future.”                        |
| 2, 3, 15, 19 | Inline field validation messages                              |

### Handle silently or as soft status (no scary toast)

| Codes                           | Guidance                                              |
| ------------------------------- | ----------------------------------------------------- |
| 6                               | Expected when polling early — show “Next charge at …” |
| 4, 5                            | Reflect empty/cancelled state in UI                   |
| Keeper-only Skipped equivalents | Do not surface as errors                              |

### Escalate / maintenance banner (not “you did something wrong”)

| Codes     | Guidance                                                  |
| --------- | --------------------------------------------------------- |
| 7, 18, 30 | “Service temporarily unavailable.”                        |
| 10        | “Merchant pending approval.”                              |
| 28        | “Protocol capacity reached; try later.”                   |
| 20, 29    | Operator/config bugs — log to telemetry, don’t blame user |

Always map numeric Soroban contract errors to this document before inventing new copy.

---

## Related

- Contract source: [`contract/src/errors.rs`](../contract/src/errors.rs)
- Troubleshooting runbook: [`docs/operations/troubleshooting.md`](operations/troubleshooting.md)
- Keeper guide: [`docs/KEEPER.md`](KEEPER.md)
- API reference: [`docs/API.md`](API.md)
- Security model: [`docs/SECURITY.md`](SECURITY.md)
