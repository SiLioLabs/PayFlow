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
// limits.rs: Enforce per-transaction maximum
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

## Audit Checklist

- [ ] All admin functions verified to check `env.invoker()`
- [ ] Allowance limits enforced in `charge()` and `batch_charge()`
- [ ] Minimum billing intervals enforced in `subscribe()`
- [ ] Timestamp checks prevent duplicate charges
- [ ] Grace period logic prevents draining insufficient accounts
- [ ] Emergency freeze state properly initialized and managed
- [ ] All state mutations emit observable events
