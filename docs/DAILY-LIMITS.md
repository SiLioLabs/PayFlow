# Daily Spending Limits Deep-Dive Guide

Daily spending limits are FlowPay's primary consumer-protection control for metered billing. Recurring `charge()` calls are already bounded by a fixed subscription `amount` and `interval`. By contrast, `pay_per_use` and `pay_per_use_to` can pull arbitrary amounts on demand — so users need an explicit daily cap.

This guide explains how that cap is implemented in `contract/src/spending_limit.rs`, how the ~24-hour window is approximated with temporary storage TTL (not a wall clock), how both pay-per-use entrypoints share one budget, how to inspect live state, edge cases at TTL boundaries, and how to surface remaining balance in a TypeScript UI.

**Related docs:** [API Reference](./API.md) · [Storage and TTL](./architecture/storage_and_ttl.md) · [Architecture](./ARCHITECTURE.md) · [Error Codes](./ERROR-CODES.md)

---

## Table of Contents

- [Why Daily Limits Exist](#why-daily-limits-exist)
- [Core Concepts and Storage Keys](#core-concepts-and-storage-keys)
- [TTL-Based Window: 17,280 Ledgers ≈ 24 Hours](#ttl-based-window-17280-ledgers--24-hours)
- [Enforcement Flow](#enforcement-flow)
- [Shared Limit: `pay_per_use` and `pay_per_use_to`](#shared-limit-pay_per_use-and-pay_per_use_to)
- [API Reference](#api-reference)
- [State Inspection](#state-inspection)
- [Numerical Examples](#numerical-examples)
- [Timeline Walkthrough](#timeline-walkthrough)
- [Edge Cases](#edge-cases)
- [Integration Guide (TypeScript UI)](#integration-guide-typescript-ui)
- [UX Recommendations](#ux-recommendations)
- [FAQ](#faq)
- [Related Tests](#related-tests)

---

## Why Daily Limits Exist

Without a daily cap, a compromised merchant integration, a buggy client, or a malicious actor with a valid allowance could drain a subscriber via repeated `pay_per_use` calls. The daily limit is an **opt-in, user-authorized** ceiling:

1. The user calls `set_daily_limit(user, limit)` (requires `user.require_auth()`).
2. Every subsequent `pay_per_use` / `pay_per_use_to` call checks `DailySpent + amount <= DailyLimit` before transferring.
3. On success, the contract increments `DailySpent` by the gross `amount` (fees do not reduce the counted spend).
4. After ~24 hours of ledger time, the day-window markers expire and spend tracking resets automatically.

Standard recurring charges via `charge()` / `batch_charge()` **do not** consume the daily limit. Those paths are already constrained by subscription terms.

---

## Core Concepts and Storage Keys

All daily-limit state lives in **temporary** Soroban storage under three keys (see `DataKey` in `contract/src/lib.rs`):

| Key                | Type stored            | Purpose                                          |
| ------------------ | ---------------------- | ------------------------------------------------ |
| `DailyLimit(user)` | `i128` (stroops)       | The user-configured cap                          |
| `DailySpent(user)` | `i128` (stroops)       | Accumulated gross spend in the current window    |
| `DayStart(user)`   | `()` (presence marker) | Anchors the start of the current ~24-hour window |

**Units:** All amounts are **stroops**. `1 XLM = 10,000,000` stroops. Example: a 10 XLM limit is `100_000_000` stroops (`10_0000000` in Rust literal style used throughout the contract tests).

**Source of truth:** `contract/src/spending_limit.rs` defines `LEDGERS_PER_DAY = 17_280` and the helpers `get_daily_limit`, `set_daily_limit`, `remove_daily_limit`, `get_daily_spent`, `get_day_start`, `record_spend`, and `enforce_limit`.

---

## TTL-Based Window: 17,280 Ledgers ≈ 24 Hours

FlowPay does **not** use calendar midnights, UTC day boundaries, or an on-chain cron. The “day” is a **TTL-anchored ledger window**.

### Why ledgers, not wall-clock time?

Stellar closes roughly one ledger every **5 seconds**:

```text
17,280 ledgers × 5 seconds/ledger = 86,400 seconds = 24 hours
```

The constant in code is:

```rust
/// Approximate number of ledgers in one day.
/// Stellar closes ~1 ledger every 5 seconds → 17,280 ledgers/day.
const LEDGERS_PER_DAY: u32 = 17_280;
```

When `set_daily_limit` writes `DailyLimit`, and when `record_spend` creates `DayStart` / updates `DailySpent`, each key’s temporary TTL is extended to `LEDGERS_PER_DAY` via `extend_ttl(&key, LEDGERS_PER_DAY, LEDGERS_PER_DAY)`.

### Why this is approximate, not exact

| Factor                           | Effect                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| Variable ledger close time       | If ledgers close faster or slower than 5 s, real time drifts from 24 h   |
| Network congestion / empty slots | Close intervals can stretch, delaying TTL expiry in wall-clock terms     |
| Testnet vs Pubnet timing         | Testnet ledgers can be less regular; do not assume exact midnight resets |
| TTL is ledger-count based        | Expiry is tied to `sequence_number` advancement, not `timestamp` alone   |

So “after 24 hours” means **after approximately 17,280 ledgers have closed since the TTL was last set for that key** — not “at 00:00 UTC.”

### How the day window advances

Critical design detail from `record_spend`:

1. **First spend of a window:** If `DayStart` is absent, the contract creates it and sets its TTL to ~1 day. `DailySpent` becomes `amount`.
2. **Later spends in the same window:** `DailySpent` accumulates. **`DayStart` TTL is not refreshed** — the window end is fixed at the first spend of that window.
3. **`DailySpent` TTL is refreshed** on every spend (extended again to `LEDGERS_PER_DAY`), but `get_daily_spent` ignores `DailySpent` whenever `DayStart` is missing — so the spent counter effectively resets when `DayStart` expires.
4. **`DailyLimit` is independent:** Setting a limit extends only the limit key. The cap can outlive or outlast a spend window depending on when it was last written. If the user is inactive for ~1 day after setting the limit, the limit itself can expire from temporary storage.

This is verified by `test_daily_limit_day_start_boundary` in `contract/src/test.rs`, which advances `sequence_number` by `17_281` ledgers and confirms the next spend starts a fresh `DailySpent` total.

---

## Enforcement Flow

Both entrypoints share `pay_per_use_inner` in `contract/src/lib.rs`:

```text
pay_per_use / pay_per_use_to
        │
        ▼
  validate amount, subscription active/unpaused
        │
        ▼
  spending_limit::enforce_limit(user, amount)
        │   if DailyLimit set AND spent + amount > limit
        │   → panic ContractError::DailyLimitExceeded (code 24)
        ▼
  transfer tokens (protocol fee + net to merchant/recipient)
        │
        ▼
  spending_limit::record_spend(user, amount)
```

`enforce_limit` only runs when a limit is present (`Some(limit)`). If `get_daily_limit` returns `None`, spending is unbounded by this feature (still subject to allowance, max amount, pause flags, etc.).

Error surface for UIs: simulate the transaction first; on `DailyLimitExceeded`, prompt the user to raise the limit, wait for the window to expire, or reduce the amount.

---

## Shared Limit: `pay_per_use` and `pay_per_use_to`

`pay_per_use` pays the subscription merchant. `pay_per_use_to` pays an arbitrary (optionally whitelisted) `recipient`. **Both draw from the same `DailyLimit` / `DailySpent` / `DayStart` keys for that user.**

There is no separate per-merchant or per-recipient daily budget. Example from contract tests (`test_pay_per_use_to_daily_limit_shared_with_pay_per_use`):

| Step | Call                                     | Limit  | Cumulative spent | Result                              |
| ---- | ---------------------------------------- | ------ | ---------------- | ----------------------------------- |
| 1    | `set_daily_limit(user, 10 XLM)`          | 10 XLM | 0                | OK                                  |
| 2    | `pay_per_use(user, 6 XLM)`               | 10 XLM | 6 XLM            | OK                                  |
| 3    | `pay_per_use_to(user, 6 XLM, recipient)` | 10 XLM | would be 12      | **Rejected** (`DailyLimitExceeded`) |

Routing payment to a different recipient does **not** create a second pool. Frontends that offer both “pay merchant” and “pay custom recipient” must sum pending intent against the **same** remaining balance.

Recurring `charge()` remains exempt: a user can hit their daily pay-per-use cap and still be billed on schedule for their subscription.

---

## API Reference

### `set_daily_limit(user, limit)`

- **Auth:** `user.require_auth()`
- **Constraints:** `limit` must be `> 0` or the contract panics with `AmountMustBePositive`
- **Storage:** Writes `DailyLimit(user)` in temporary storage; TTL ≈ 17,280 ledgers
- **Events:** Emits `daily_limit_set`
- **Does not** reset `DailySpent` or `DayStart` by itself — raising the cap mid-window immediately allows more spend within the same day anchor

### `remove_daily_limit(user)`

- **Auth:** `user.require_auth()`
- **Storage:** Removes `DailyLimit`, `DailySpent`, and `DayStart`
- **Events:** Emits `daily_limit_removed`
- **Effect:** Immediately clears the cap **and** today’s tracking; subsequent pay-per-use calls are uncapped until a new limit is set

### `get_daily_limit(user) -> Option<i128>`

- **Auth:** none (read-only)
- **Returns:** `Some(limit)` in stroops, or `None` if never set or TTL-expired

### `get_daily_spent(user) -> i128`

- **Auth:** none
- **Returns:** Accumulated spend in the current window, or `0` if `DayStart` is absent (even if a stale `DailySpent` entry somehow remains)

### `get_day_start(user) -> bool`

- **Auth:** none
- **Returns:** `true` if `DayStart(user)` exists in temporary storage (window is active); `false` if the window has not started or has expired
- **Semantics:** This is a **presence** check, not a wall-clock timestamp. `DayStart` stores unit `()` — there is no on-chain “started at 10:00 UTC” value to display

---

## State Inspection

Use the three read helpers together to render a complete status panel:

```text
limit     = get_daily_limit(user)     // Option<i128>
spent     = get_daily_spent(user)     // i128
dayActive = get_day_start(user)       // bool

remaining = if limit is Some(L): max(L - spent, 0) else: unbounded
```

### Interpretation matrix

| `get_daily_limit` | `get_day_start` | `get_daily_spent` | Meaning                                                                                              |
| ----------------- | --------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `None`            | `false`         | `0`               | No cap; no window started                                                                            |
| `None`            | `true`          | `> 0`             | Cap expired/removed but window marker still alive until TTL (rare mid-transition); treat as uncapped |
| `Some(L)`         | `false`         | `0`               | Cap set; no spend yet today (or window expired and not yet spent)                                    |
| `Some(L)`         | `true`          | `S`               | Active window; remaining ≈ `L - S`                                                                   |

**Concrete example:** Limit is 10 XLM (`100_000_000` stroops), spent is 7 XLM (`70_000_000` stroops), remaining is **3 XLM** (`30_000_000` stroops). A `pay_per_use` of 4 XLM would panic; 3 XLM would succeed and leave remaining at 0.

CLI inspection:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_daily_limit --user <USER>
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_daily_spent --user <USER>
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_day_start --user <USER>
```

---

## Numerical Examples

Assume `1 XLM = 10_000_000` stroops.

### Example A — within limit

| Action            | Amount (XLM) | Amount (stroops) | Spent after | Remaining (limit 10 XLM) |
| ----------------- | ------------ | ---------------- | ----------- | ------------------------ |
| `set_daily_limit` | 10           | `100_000_000`    | 0           | 10 XLM                   |
| `pay_per_use`     | 4            | `40_000_000`     | 4 XLM       | 6 XLM                    |
| `pay_per_use`     | 3            | `30_000_000`     | 7 XLM       | 3 XLM                    |

### Example B — single-call overspend blocked

Limit = 3 XLM (`30_000_000`). First `pay_per_use(5 XLM)` → `0 + 50_000_000 > 30_000_000` → `DailyLimitExceeded`. Spent stays `0`; no transfer occurs.

### Example C — cumulative overspend blocked

Limit = 5 XLM. Spend 3 XLM (OK, spent = 3). Next spend 3 XLM → `3 + 3 = 6 > 5` → rejected. Spent remains 3 XLM.

### Example D — shared pool across entrypoints

Limit = 10 XLM. `pay_per_use(6)` then `pay_per_use_to(6, recipient)` → second call rejected even though recipients differ.

---

## Timeline Walkthrough

```text
Ledger / Time     Action                         Storage
--------------------------------------------------------------------------------
T0                set_daily_limit(50 XLM)        DailyLimit=50 (TTL ~1 day from T0)

T0 + 1h           pay_per_use(20 XLM)            DayStart created (TTL ~1 day from this ledger)
                                                 DailySpent=20

T0 + 6h           pay_per_use(20 XLM)            DayStart unchanged (still expires ~T0+1h+24h)
                                                 DailySpent=40

T0 + 10h          pay_per_use(15 XLM)            REJECTED (40+15 > 50)

~T0 + 1h + 24h    DayStart TTL expires           DayStart gone; get_daily_spent → 0
                                                 get_day_start → false

Later             pay_per_use(15 XLM)            New DayStart; DailySpent=15
                                                 Accepted if DailyLimit still present
```

Note: `DailyLimit` may expire on its **own** TTL clock (from last `set_daily_limit`). Frontends should warn when `get_daily_limit` suddenly returns `None` after previously showing a value.

---

## Edge Cases

### TTL expires between simulation and submission

Soroban temporary entries can be evicted when their TTL elapses. If a client simulates while `DayStart` is alive and `spent + amount` is under the limit, but by inclusion time `DayStart` has expired:

- `get_daily_spent` effectively becomes `0` for enforcement.
- The call is **more likely to succeed**, not fail — a reset mid-flight relaxes the budget.
- Conversely, if `DailyLimit` expires mid-flight, enforcement is skipped entirely (`None` limit).

There is no partial “half-applied” spend: either `enforce_limit` passes and `record_spend` runs after a successful transfer path, or the transaction panics and reverts.

### TTL expires mid-batch of user actions

Each transaction is atomic. A multi-step UX (two sequential `pay_per_use` txs) can straddle a TTL boundary: the first fills the old window; the second may open a new window with spent reset to the new amount. Always re-query `get_daily_spent` / `get_day_start` between user-initiated payments.

### Ledger time manipulation on Testnet

Local tests and some Testnet scenarios advance `sequence_number` and `timestamp` independently. Contract logic for daily limits keys off **storage TTL / ledger sequence**, not “has 86,400 seconds of timestamp elapsed.” When writing tests:

- Advance `env.ledger().sequence_number` by at least `17_281` to expire a `DayStart` set with `LEDGERS_PER_DAY` (see `test_daily_limit_day_start_boundary`).
- Re-approve token allowances after large sequence jumps — allowances also use ledger-based live-until semantics.
- Do not assume Testnet wall-clock midnight matches on-chain resets.

### Limit set but never spent

`DayStart` is created on **first spend**, not on `set_daily_limit`. Until the first `pay_per_use` / `pay_per_use_to`, `get_day_start` is `false` and `get_daily_spent` is `0`, even though a limit exists.

### Removing the limit mid-window

`remove_daily_limit` deletes all three keys. This is the supported way to **reset early** (see FAQ). Spend tracking does not survive removal.

### Fees and counted spend

Protocol fees reduce what the merchant receives but **do not** reduce `DailySpent`. A 10 XLM pay-per-use with a non-zero fee still counts as 10 XLM toward the daily limit.

---

## Integration Guide (TypeScript UI)

The FlowPay frontend already exposes helpers in `frontend/src/stellar.ts` (`getDailyLimit`, `getDailySpent`) and renders them in `DailyLimitCard`. Below is a self-contained pattern you can copy into any Soroban TypeScript client to show **limit**, **spent**, and **remaining**.

```typescript
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const STROOPS_PER_XLM = 10_000_000n;

function formatXlm(stroops: bigint): string {
  return `${(Number(stroops) / Number(STROOPS_PER_XLM)).toFixed(7)} XLM`;
}

async function readI128(
  server: Server,
  contractId: string,
  networkPassphrase: string,
  user: string,
  method: "get_daily_limit" | "get_daily_spent",
): Promise<bigint | null> {
  const contract = new Contract(contractId);
  const account = await server.getAccount(user);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, new Address(user).toScVal()))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) throw new Error(String(sim.error));
  const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return method === "get_daily_limit" ? null : 0n;

  // Decode Option<i128> for get_daily_limit, i128 for get_daily_spent
  // (use your project's ScVal decoder helpers — see frontend/src/stellar.ts)
  return retval; // replace with decodeI128 / decodeOption as appropriate
}

async function readDayStart(
  server: Server,
  contractId: string,
  networkPassphrase: string,
  user: string,
): Promise<boolean> {
  const contract = new Contract(contractId);
  const account = await server.getAccount(user);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call("get_day_start", new Address(user).toScVal()))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) throw new Error(String(sim.error));
  const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval;
  return retval?.b() ?? false;
}

/** Display model for a daily-limit progress UI. */
export async function loadDailyLimitView(user: string) {
  const server = new Server(import.meta.env.VITE_RPC_URL);
  const contractId = import.meta.env.VITE_CONTRACT_ID;
  const networkPassphrase = import.meta.env.VITE_NETWORK_PASSPHRASE;

  const [limit, spent, dayActive] = await Promise.all([
    readI128(server, contractId, networkPassphrase, user, "get_daily_limit"),
    readI128(server, contractId, networkPassphrase, user, "get_daily_spent"),
    readDayStart(server, contractId, networkPassphrase, user),
  ]);

  const spentVal = spent ?? 0n;
  const remaining =
    limit === null || limit === undefined
      ? null
      : limit > spentVal
        ? limit - spentVal
        : 0n;

  return {
    limitLabel: limit == null ? "Not set" : formatXlm(limit),
    spentLabel: formatXlm(spentVal),
    remainingLabel: remaining == null ? "Unlimited" : formatXlm(remaining),
    dayWindowActive: dayActive,
    // Example: limit 10 XLM, spent 7 XLM → remaining 3 XLM
    progressPct:
      limit != null && limit > 0n ? Number((spentVal * 100n) / limit) : 0,
  };
}
```

Wire `progressPct` into a progress bar, disable the pay-per-use submit button when `remaining` is `0n`, and re-fetch after every successful payment or `set_daily_limit` / `remove_daily_limit` transaction.

---

## UX Recommendations

1. **Show remaining, not only spent.** Users think in “how much can I still spend?” — compute `limit - spent` whenever `get_daily_limit` is `Some`.
2. **Warn on limit TTL.** If a previously known limit becomes `None`, explain that temporary storage expired (~24 h of inactivity after the last `set_daily_limit`) and offer to re-apply the cap.
3. **Simulate before signing.** Catch `DailyLimitExceeded` (error code 24) before asking for a wallet signature.
4. **Treat both pay-per-use paths as one budget.** Any UI that can call `pay_per_use_to` must use the same remaining balance as `pay_per_use`.
5. **Explain the approximate reset.** Prefer copy like “resets about 24 hours after your first spend today” over “resets at midnight.”

---

## FAQ

### Why didn't my limit reset after 24 hours?

The spend counter resets when the **`DayStart` temporary entry expires**, which is ~17,280 ledgers after the **first spend of that window** — not 24 wall-clock hours after you set the limit, and not at calendar midnight. If ledger closes are slower than 5 seconds, the reset arrives later in real time. Also confirm you are looking at `get_daily_spent` / `get_day_start`: the **`DailyLimit` value itself** is a separate TTL and may still show the same cap after the spend window rolls.

Checklist:

1. Call `get_day_start(user)` — if it is still `true`, the window has not expired yet.
2. Remember the clock started at the first `pay_per_use` / `pay_per_use_to` of the window, not at `set_daily_limit`.
3. On Testnet, ledger timing can drift; wait for sequence advancement or re-check after more ledgers.

### Can I reset my limit early?

Yes. Call `remove_daily_limit(user)` (requires your signature). That deletes `DailyLimit`, `DailySpent`, and `DayStart` immediately. To keep a cap but clear today’s usage, remove and then `set_daily_limit` again with the desired value — there is no separate “reset spent only” entrypoint. Raising the limit with `set_daily_limit` without removing does **not** clear `DailySpent`; it only raises the ceiling for the current window.

### Does `charge()` count toward my daily limit?

No. Only `pay_per_use` and `pay_per_use_to` call `enforce_limit` / `record_spend`.

### Are amounts in XLM or stroops?

On-chain values are always **stroops**. Convert with `stroops / 10_000_000` for XLM display.

### What error should my app handle?

`ContractError::DailyLimitExceeded` (code **24**) when `spent + amount > limit`.

---

## Related Tests

Run the spending-limit suite from the contract crate:

```bash
cd contract
cargo test daily_limit
```

Notable cases:

| Test                                                                            | Behavior covered                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `test_daily_limit_allows_spend_within_limit`                                    | Single spend under cap                              |
| `test_daily_limit_blocks_overspend`                                             | Single spend over cap                               |
| `test_daily_limit_accumulates_across_calls`                                     | Multi-call accumulation                             |
| `test_daily_limit_blocks_cumulative_overspend`                                  | Cumulative breach                                   |
| `test_daily_limit_visibility_and_spend_tracking`                                | `get_daily_limit` / `get_daily_spent` lifecycle     |
| `test_daily_limit_day_start_boundary`                                           | TTL / sequence expiry resets spent                  |
| `test_pay_per_use_to_daily_limit_shared_with_pay_per_use`                       | Shared budget across entrypoints                    |
| `test_daily_limit_set_event_emitted` / `test_daily_limit_removed_event_emitted` | Events                                              |
| `test_get_day_start_visibility`                                                 | `get_day_start` before/after spend and after remove |

---

## See Also

- Implementation: [`contract/src/spending_limit.rs`](../contract/src/spending_limit.rs)
- Entrypoints: [`contract/src/lib.rs`](../contract/src/lib.rs) (`pay_per_use`, `pay_per_use_to`, daily-limit methods)
- Frontend card: [`frontend/src/components/DailyLimitCard.tsx`](../frontend/src/components/DailyLimitCard.tsx)
- Storage overview: [Storage and TTL](./architecture/storage_and_ttl.md)
