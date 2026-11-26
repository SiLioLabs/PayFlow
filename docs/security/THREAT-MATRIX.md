# Security Specification & Threat Matrix

## Authorization & Role Boundaries

### Role Hierarchy

```
┌─────────────────────────────────────┐
│ Admin Role                          │
│ - Full contract control             │
│ - Emergency circuit breakers        │
│ - Parameter modifications           │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ Merchant Role                       │
│ - Initiate batch_charge operations  │
│ - Collect merchant statistics       │
│ - View subscriber lists             │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ User Role                           │
│ - Subscribe to services             │
│ - View own subscription status      │
│ - Request cancellation              │
└─────────────────────────────────────┘
```

## Threat Vectors & Mitigations

### 1. Token Allowance Draining

**Threat:** Attacker exploits unlimited allowance to drain user tokens.

**Attack Vector:**

- Malicious merchant requests infinite allowance
- User unknowingly approves excessive spending
- Contract executes repeated charges exceeding authorized amount

**Code-Level Defenses:**

```rust
// validation.rs: Enforce per-transaction maximum
const MAX_AMOUNT: u128 = 1_000_000_000_000; // 1M tokens max per charge

fn validate_charge_amount(amount: u128) -> Result<(), Error> {
    if amount > MAX_AMOUNT {
        return Err(Error::AmountExceedsMaximum);
    }
    Ok(())
}

// subscription.rs: Enforce minimum intervals to prevent spam
const MIN_BILLING_INTERVAL: u64 = 86400; // 24 hours minimum

fn validate_billing_interval(interval: u64) -> Result<(), Error> {
    if interval < MIN_BILLING_INTERVAL {
        return Err(Error::IntervalTooShort);
    }
    Ok(())
}
```

**Mitigation Strategy:**

- ✓ Hard cap on transaction amount (`MAX_AMOUNT`)
- ✓ Minimum billing interval prevents rapid draining
- ✓ User-controlled allowance limits at token level
- ✓ Grace periods delay charges if token balance insufficient

---

### 2. Unauthenticated Administrative Access

**Threat:** Unauthorized caller attempts administrative operations.

**Attack Vector:**

- Attacker calls `admin_emergency_freeze()` without authorization
- Attacker modifies critical parameters via `admin_update_*` functions
- Contract state corrupted or service halted

**Code-Level Defenses:**

```rust
// admin.rs: Authorization check on all admin functions
pub fn require_admin(env: &Env) {
    let admin = env.storage().instance()
        .get::<Address>(&DataKey::Admin)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NotInitialized));
    admin.require_auth();
}

// validation.rs: Strict permission checking
fn require_admin(env: &Env) -> Result<Address, Error> {
    let admin = env.storage().instance().get::<Address>(&ADMIN_KEY)?;
    if env.invoker() != admin {
        return Err(Error::Unauthorized);
    }
    Ok(admin)
}
```

**Mitigation Strategy:**

- ✓ Every admin function validates `env.invoker()` against stored admin address
- ✓ Administrative authority uses two-step `transfer_admin` / `accept_admin` handoff
- ✓ All modifications require explicit authorization check
- ✓ Failed auth attempts logged/emitted as events

The admin is trusted to pause contracts, change billing parameters and fees, freeze merchants, repair/cancel subscriptions, govern migrations, and commit upgrades. It should be a multisig or governed account, not a single hot key. For the complete function-level power and delay table, see [docs/SECURITY.md](../SECURITY.md#administrator-powers-and-trust-assumptions).

---

### 3. Short-Interval Transaction Spamming

**Threat:** Attacker uses minimal billing intervals to spam blockchain and exhaust resources.

**Attack Vector:**

- Create subscription with 1-second interval
- Spam `batch_charge()` call thousands of times per minute
- Exhaust keeper bot resources or degrade network performance

**Code-Level Defenses:**

```rust
// min_interval.rs: Enforce minimum charging intervals
const MIN_BILLING_INTERVAL: u64 = 86400; // 24 hours
const GRACE_PERIOD_WINDOW: u64 = 3600;  // 1 hour buffer

fn validate_charge_eligibility(
    last_charge_time: u64,
    billing_interval: u64,
    current_time: u64,
) -> Result<(), Error> {
    let next_charge_time = last_charge_time.checked_add(billing_interval)
        .ok_or(Error::ArithmeticOverflow)?;

    if current_time < next_charge_time {
        return Err(Error::TooEarlyToCharge);
    }

    Ok(())
}

// batch.rs: Pagination prevents single-transaction overload
fn batch_charge(env: Env, page_offset: u32, page_size: u32) -> Result<u32, Error> {
    const MAX_PAGE_SIZE: u32 = 100;

    if page_size > MAX_PAGE_SIZE {
        return Err(Error::PageSizeTooLarge);
    }

    // Process only one page per invocation
    Ok(process_page(env, page_offset, page_size)?)
}
```

**Mitigation Strategy:**

- ✓ Minimum 24-hour billing interval enforced at contract validation
- ✓ `batch_charge()` processes limited pages per call (max 100 subscriptions)
- ✓ Timestamp validation prevents charging same subscription twice in interval
- ✓ Pagination design limits single invocation gas cost

---

## Emergency Circuit Breaker

**Security Implications:**

The `admin_emergency_freeze()` function pauses all subscription charges:

```rust
fn admin_emergency_freeze(env: Env) -> Result<(), Error> {
    require_admin(&env)?;
    env.storage().instance().set(&IS_FROZEN_KEY, &true);
    env.events().publish(("emergency_freeze", "invoked"), ());
    Ok(())
}
```

**Risks & Mitigations:**

- **Risk:** Freezing contract stops all billing (potential revenue loss)
- **Mitigation:** Only callable by admin; requires off-chain governance approval
- **Risk:** Indefinite freeze state could orphan active subscriptions
- **Mitigation:** Unfreeze function allows admin to restore service post-audit

---

## 4. Re-entrancy and Checks-Effects-Interactions Ordering

**Threat:** A hostile token contract calls back into FlowPay during a token transfer, observing or modifying state before it is fully committed. Classic EVM-style re-entrancy: a callback re-reads pre-charge state (`last_charged`, `DailySpent`, `MerchantRevenue`) and charges again.

**Defences (both must hold):**

1. **Host-level re-entry prevention.** Soroban rejects a cross-contract call back into a contract instance that is still on the call stack, so a token cannot re-enter FlowPay mid-transfer. This is host-enforced; no opt-in guard is needed.
2. **Checks-Effects-Interactions ordering.** Independently of the host guarantee, every money-moving entrypoint now commits *all* of its state writes (including events) **before** the first token call, so even a permitted callback could never observe stale state. This is the ordering an auditor reads off the code, and the ordering pinned by the tests below.

**How the ordering is enforced:** the fee helpers are split into a planning half and a settlement half:

- `fee::plan_subscription_charge` / `fee::plan_pay_per_use` — allowance preflight, fee split, `TotalProtocolFees` accrual, referral accrual. **No token calls.**
- `fee::settle_subscription_charge` / `fee::settle_pay_per_use` — the token transfers described by the plan. Called last, after the caller's effects.

**Ordering per entry point** (`C` = checks, `E` = effects/state writes + events, `I` = token interactions):

| Entry point | Checks | Effects (all before any token call) | Interactions (last) | Order |
|---|---|---|---|---|
| `charge(user)` (also `charge_with_tip`, `batch_charge`, and `charge_subscription(id=0)` via `charge_exec::execute_charge`) | pause, auth, subscription state, interval, grace, allowance preflight, fee split | `GlobalVolume`, `MerchantRevenue`, last-charge record, `last_charged`, subscription TTL, charge history, `TotalProtocolFees`, referral accrual, `charged` / keeper-tip events | `transfer_from` legs: fee collector, keeper tip, referral reward, merchant net | ✅ C → E → I |
| `charge_subscription(user, id≠0)` (`multi_subscription::settle`) | interval, grace, allowance preflight, fee split | `GlobalVolume`, per-token settled revenue, `last_charged`, subscription TTL, `additional_subscription_paid` | `transfer_from` legs (same as `charge`) | ✅ C → E → I |
| `pay_per_use(user, amount)` (`pay_per_use_inner`, id 0) | pause, auth, amount caps, active/paused, allowance preflight, per-use merchant cap, daily limit | fee accrual, `GlobalVolume`, `DailySpent`/`DayStart`, `MerchantRevenue`, subscription TTL, `pay_per_use` event | `transfer_from`: fee collector, merchant net | ✅ C → E → I |
| `pay_per_use_to(user, amount, recipient)` | as `pay_per_use` + recipient sanity + whitelist | fee accrual, `GlobalVolume`, `DailySpent`/`DayStart`, `MerchantRevenue`, TTL, `pay_per_use` event | `transfer_from`: fee collector, recipient net | ✅ C → E → I |
| `pay_per_use_with_nonce(user, amount, nonce)` | nonce unused + everything `pay_per_use` checks | nonce recorded, then the `pay_per_use` effects above | as `pay_per_use` | ✅ C → E → I |
| `pay_per_use_subscription(user, id≠0)` | as `pay_per_use` | fee accrual, `GlobalVolume`, `DailySpent`/`DayStart`, per-token settled revenue, TTL, `additional_subscription_paid` | `transfer_from`: fee collector, merchant net | ✅ C → E → I |
| `cancel_and_refund_prorated(user, merchant)` | active, not paused, merchant match, refund > 0, merchant balance | `cancel_inner` (`active = false`, active count, subscriber index, referral removal, TTL), `cancelled_with_refund` event | `transfer` merchant → user | ✅ C → E → I |
| `refund_last_charge(user, merchant)` | merchant match, last-charge present, amount > 0, merchant balance | `MerchantRevenue` reversal, `TotalProtocolFees` reversal, last-charge record cleared, TTL, `refunded` event | `transfer` merchant → user | ✅ C → E → I |
| `withdraw_merchant_revenue(merchant)` | pause, auth, non-zero revenue | `MerchantRevenue` reset, `merchant_withdrawal` event | `transfer` contract → merchant | ✅ C → E → I |
| `subscribe` / `cancel` / `pause` / admin setters | — | state writes only | none | ✅ no interaction |

**Tests:** `contract/src/test/reentrancy.rs` deploys a `HostileToken` (a working SAC-shaped token that calls back into FlowPay from inside `transfer` / `transfer_from`) and asserts, per money-moving path, that the re-entrant call is rejected (`try_*` returns `Err`) and that no partial state or balance change survives:

- `hostile_token_without_reentry_completes_charge` (control: the mock token is a valid token)
- `reentrant_token_cannot_double_charge_via_charge`
- `reentrant_token_cannot_double_spend_via_pay_per_use`
- `reentrant_token_cannot_double_spend_via_pay_per_use_to`
- `reentrant_token_cannot_double_refund_via_cancel_and_refund`
- `reentrant_token_cannot_double_refund_via_refund_last_charge`
- `reentrant_token_cannot_double_withdraw_merchant_revenue`

**Residual notes:**

- `cancel_inner`, `refund_last_charge` and `withdraw_merchant_revenue` still validate the merchant's token balance with a `balance()` read before their writes. A read-only token call cannot mutate FlowPay state, so it does not affect CEI ordering; it exists to convert an underfunded merchant into a typed `InsufficientMerchantBalance` instead of an opaque SAC failure.
- Events are emitted in the effects phase, before the transfers. Soroban rolls back events and storage together if a transfer fails, so this does not change failure behaviour.

**References:**

- Soroban host re-entry prevention (single contract instance per call stack).
- CEI pattern: https://docs.soliditylang.org/en/latest/security-considerations.html#re-entrancy

---

## Audit Checklist

- [ ] All admin functions verified to check `env.invoker()`
- [ ] Allowance limits enforced in `charge()` and `batch_charge()`
- [ ] Minimum billing intervals enforced in `subscribe()`
- [ ] Timestamp checks prevent duplicate charges
- [ ] Grace period logic prevents draining insufficient accounts
- [ ] Emergency freeze state properly initialized and managed
- [ ] All state mutations emit observable events
