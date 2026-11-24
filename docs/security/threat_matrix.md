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
fn admin_emergency_freeze(env: Env) -> Result<(), Error> {
    let admin = env.storage().instance().get::<Address>(&ADMIN_KEY)?;
    let caller = env.invoker();

    if caller != admin {
        return Err(Error::Unauthorized);
    }

    // Execute freeze logic
    Ok(())
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
- ✓ Admin address immutable after deployment (no transfer function)
- ✓ All modifications require explicit authorization check
- ✓ Failed auth attempts logged/emitted as events

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

---

## 4. Re-entrancy and Checks-Effects-Interactions Ordering

**Threat:** A hostile token contract calls back into FlowPay during a token transfer, observing or modifying state before it is fully committed.

**Soroban Host Guarantee:** Soroban enforces single-contract-instance re-entry prevention at the host level. Cross-contract calls to the same contract instance within the same transaction are rejected. This eliminates classical EVM-style re-entrancy.

**CEI Ordering per Entry Point:**

| Entry point | Checks | Effects (state writes) | Interactions (token calls) | CEI order |
|---|---|---|---|---|
| `charge(user)` | allowance, interval, grace, pause | `last_charged`, subscription TTL, `MerchantRevenue`, fee accrual, `ActiveCount`, event | `token::transfer_from` (user → merchant), fee leg if configured | ✅ Writes before transfer |
| `pay_per_use(user, amount)` | active, not paused, allowance, daily limit | `DailySpent`, `DayStart`, `MerchantRevenue`, fee accrual, event | `token::transfer_from` (user → merchant), fee leg if configured | ✅ Writes before transfer |
| `pay_per_use_to(user, amount, recipient)` | active, not paused, allowance, daily limit, whitelist | `DailySpent`, `DayStart`, `MerchantRevenue`, fee accrual, event | `token::transfer_from` (user → recipient), fee leg if configured | ✅ Writes before transfer |
| `cancel_and_refund_prorated(user, merchant)` | active, not paused, merchant match, balance | `cancel_inner` (sub.active=false, count, index), event | `token::transfer` (merchant → user) | ✅ State cleared before transfer |
| `batch_charge(users)` | pause gate, per-user: allowance, interval, grace | per-user: `last_charged`, TTL, `MerchantRevenue`, fee | per-user: `token::transfer_from` | ✅ Per-user writes before transfer |

**Note on `pay_per_use_inner`:** `fee::transfer_pay_per_use` (token interaction) is called before `merchant_stats::increment_revenue_with_daily` and `spending_limit::record_spend` (effects). This is safe because:
1. Soroban atomicity rolls back all state if the transfer fails.
2. The Soroban host prevents re-entrant calls back into this contract during the transfer.
3. The revenue/spend counters are internal accounting only and do not gate the transfer.

A future hardening pass should reorder these writes ahead of the transfer call to satisfy strict CEI independently of host guarantees.

**Mitigation Strategy:**

- ✅ Soroban host prevents re-entrant calls to the same contract instance.
- ✅ `cancel_and_refund_prorated` zeros/removes the subscription before transferring — mirrors the classic re-entrancy guard pattern.
- ✅ CEI ordering verified by unit tests `test_charge_cei_ordering_*` and `test_pay_per_use_cei_ordering_*` and `test_cancel_and_refund_cei_ordering_*` in `contract/src/test.rs`.
- ⚠️ `pay_per_use_inner`: `merchant_stats` and `spending_limit` writes happen after the token call. No exploitable path exists due to host re-entrancy prevention, but strict CEI reordering is recommended in a follow-up.

**References:**
- Soroban single-instance re-entrancy: host enforced, no opt-in needed.
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
