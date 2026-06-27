# Daily Spending Limits in FlowPay

Daily spending limits are a core consumer protection feature in FlowPay. While recurring subscriptions charge a fixed amount at a predictable interval, the `pay_per_use` feature allows merchants to pull arbitrary amounts dynamically (e.g., for metered billing or usage-based access). 

To prevent unbounded fund drains, users can set a **Daily Spending Limit**. If a `pay_per_use` charge exceeds this limit, the smart contract automatically aborts the transaction.

---

## How the Daily Reset Works

FlowPay does not rely on a global cron job to reset daily limits. Instead, it utilizes Soroban's **Temporary Storage TTL (Time-To-Live)**.

### The `DayStart` Anchor
When a user makes their first `pay_per_use` spend of the day, the contract records a `DayStart` marker in temporary storage. This marker is given a TTL of exactly `LEDGERS_PER_DAY` (~17,280 ledgers, assuming 5 seconds per ledger).

1. **First Spend:** `DayStart` is created (TTL = 1 Day). `DailySpent` is set to the spend amount.
2. **Subsequent Spends:** `DailySpent` accumulates the new spend amounts. `DayStart` is **not** extended.
3. **Expiration:** After ~24 hours, `DayStart` is automatically evicted by the Stellar network.
4. **New Day:** The next time the user spends, the contract notices `DayStart` is missing, treats their `DailySpent` as 0, and writes a fresh `DayStart` to anchor a new 24-hour window.

*(Note: `DailyLimit` is kept on an independent TTL so that the limit itself persists across day boundaries, until it naturally expires due to inactivity or is explicitly removed).*

---

## Interaction with `pay_per_use`

The daily limit is **only** enforced during `pay_per_use` calls. Standard recurring charges (`charge()`) are exempt from this limit because they are strictly constrained by the pre-agreed subscription `amount` and `interval`.

If a `pay_per_use` call requests an amount that pushes the user's `DailySpent` above their `DailyLimit`, the transaction will panic with the error: `"daily spending limit exceeded"`.

---

## Daily Limit Functions

### 1. `set_daily_limit`
Sets (or overwrites) the maximum amount a user can spend via `pay_per_use` within a 24-hour window.
- **Parameters:** `user: Address`, `limit: i128` (in stroops)
- **Auth:** Requires the `user`'s signature.
- **Note:** Sets a TTL of ~1 day on the limit itself. Frontends or keeper bots must ensure this is refreshed if they want the limit to remain active indefinitely.

### 2. `get_daily_limit`
Retrieves the user's currently active daily limit.
- **Parameters:** `user: Address`
- **Returns:** `Option<i128>` (None if no limit is set or if it has expired).

### 3. `get_daily_spent`
Retrieves how much the user has spent in the current 24-hour window.
- **Parameters:** `user: Address`
- **Returns:** `i128` (Returns 0 if no spend has occurred today, or if the `DayStart` TTL has expired).

### 4. `remove_daily_limit`
Explicitly removes the daily limit and clears all associated tracking data (`DailySpent` and `DayStart`).
- **Parameters:** `user: Address`
- **Auth:** Requires the `user`'s signature.

---

## Timeline Example

```text
Time        Action                        Storage State
--------------------------------------------------------------------------------------
Day 1 09:00  set_daily_limit(50)          DailyLimit: 50 (TTL: 1 Day)
                                          
Day 1 10:00  pay_per_use(20)              DayStart: Created (TTL: 1 Day)
                                          DailySpent: 20
                                          
Day 1 15:00  pay_per_use(20)              DayStart: Unchanged (Expires Day 2 10:00)
                                          DailySpent: 40
                                          
Day 1 19:00  pay_per_use(15)              [REJECTED] 40 + 15 > 50

Day 2 10:01  --- TTL Expiration ---       DayStart gets evicted from storage.

Day 2 11:00  pay_per_use(15)              Contract sees DayStart is missing.
                                          Treats spent as 0. 0 + 15 <= 50 [ACCEPTED]
                                          DayStart: Created (Expires Day 3 11:00)
                                          DailySpent: 15
```

---

## UX Recommendations for Frontends

1. **Proactive Display:** If `get_daily_limit` returns a value, visually show a progress bar in the user dashboard comparing `get_daily_spent` against `get_daily_limit`.
2. **Warn on Expiry:** Because `DailyLimit` relies on temporary storage, if the user does not transact for a day, the limit itself will expire. The UI should notify the user if their previously set limit has lapsed.
3. **Graceful Failures:** If a user is performing a manual `pay_per_use` action in the app, simulate the transaction first. If it hits the limit, prompt them to either increase their limit using `set_daily_limit` or wait until their 24-hour window resets.
