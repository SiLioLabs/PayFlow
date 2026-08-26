# Contributing to the FlowPay Contract

This guide covers everything Rust/Soroban contributors need to know: module layout, adding a new public function, testing conventions, event emission rules, error variant guidelines, and the PR checklist.

For general contribution guidelines (branching, commit style, frontend), see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

---

## Table of Contents

- [Module Layout](#module-layout)
- [Adding a New Public Function](#adding-a-new-public-function)
- [Testing Conventions](#testing-conventions)
- [Benchmarks](#benchmarks)
- [Event Emission Rules](#event-emission-rules)
- [Error Variant Guidelines](#error-variant-guidelines)
- [PR Checklist](#pr-checklist)

---

## Module Layout

```
contract/src/
├── lib.rs                    # Contract entry point: DataKey enum, Subscription struct,
│                             # FlowPay impl block with all public functions
├── errors.rs                 # ContractError enum (#[contracterror])
├── events.rs                 # All publish_* helpers
├── batch.rs                  # batch_charge logic and ChargeResult enum
├── charge_exec.rs            # Shared charge execution (precheck + execute)
├── admin.rs                  # Admin / ownership helpers
├── fee.rs                    # Protocol fee calculation and transfer
├── grace.rs                  # Grace period get/set
├── limits.rs                 # Contract-wide amount limits
├── merchant_stats.rs         # Per-merchant revenue tracking
├── migration.rs              # Schema versioning and state migration
├── min_interval.rs           # Minimum subscription interval floor
├── referral.rs               # Referral tracking
├── spending_limit.rs         # Per-user daily spending limits (temporary storage)
├── storage.rs                # Low-level storage helpers and TTL extension
├── subscription_count.rs     # Active subscription counter
├── subscription_history.rs   # Per-user charge history
├── subscription_metadata.rs  # User-assigned subscription labels
├── token.rs                  # SAC token client helpers
├── trial.rs                  # Trial period support
├── upgrade.rs                # Contract upgrade (wasm hash)
├── validation.rs             # Input validation helpers
├── whitelist.rs              # Merchant whitelist
├── bench.rs                  # Benchmark tests (cfg(test) only)
└── test.rs                   # Unit tests (cfg(test) only)
```

**Rules:**
- Business logic belongs in a focused module, not in `lib.rs`.
- `lib.rs` only wires public contract functions to module helpers — no logic inline.
- `bench.rs` and `test.rs` are gated with `#[cfg(test)]`.

---

## Adding a New Public Function

Follow these five steps every time.

### 1. Add a storage key (if needed)

In `lib.rs`, add a variant to `DataKey` for any new persistent state:

```rust
// lib.rs — DataKey enum
DataKey::UserPreference(Address),
```

### 2. Implement the logic in a module

Create or extend a module file. Keep functions small and single-purpose:

```rust
// src/my_feature.rs
use soroban_sdk::{Address, Env};
use crate::DataKey;

pub fn get_preference(env: &Env, user: &Address) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::UserPreference(user.clone()))
}

pub fn set_preference(env: &Env, user: &Address, value: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::UserPreference(user.clone()), &value);
}
```

### 3. Declare the module in `lib.rs`

```rust
// lib.rs
mod my_feature;
```

### 4. Expose the public contract function in `lib.rs`

```rust
// lib.rs — FlowPay impl block

/// Returns the caller's preference value, or `None` if unset.
pub fn get_preference(env: Env, user: Address) -> Option<u32> {
    my_feature::get_preference(&env, &user)
}

/// Sets the caller's preference value. Requires caller auth.
pub fn set_preference(env: Env, user: Address, value: u32) {
    user.require_auth();
    my_feature::set_preference(&env, &user, value);
    events::publish_preference_set(&env, &user, value);
}
```

**Auth rule:** any function that mutates user state or moves funds **must** call `user.require_auth()` before doing anything else.

### 5. Add tests and events

See [Testing Conventions](#testing-conventions) and [Event Emission Rules](#event-emission-rules) below.

---

## Testing Conventions

All tests live in `contract/src/test.rs` and are gated with `#![cfg(test)]`.

### Test setup

Use the shared `setup()` helper for a standard environment with one funded user and one merchant:

```rust
fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Mint and approve tokens for the user
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &200);

    (env, contract_id, token_addr, user, merchant)
}
```

Only deviate from `setup()` when a test requires a genuinely different environment.

### Naming

Name tests after the behaviour being verified, not the function name:

```
test_daily_limit_blocks_overspend        ✓
test_set_daily_limit                     ✗ (describes what it calls, not what it checks)
```

Group related tests using a shared prefix so `cargo test <prefix>` runs the whole suite:

```
test_daily_limit_allows_spend_within_limit
test_daily_limit_accumulates_across_calls
test_daily_limit_blocks_cumulative_overspend
test_daily_limit_visibility_and_spend_tracking
test_daily_limit_removed_event_emitted
```

### What to test

Every new public function needs at minimum:

| Test | What it verifies |
|------|-----------------|
| Happy path | Function succeeds under normal conditions |
| Precondition failure | Correct error when inputs are invalid |
| Auth enforcement | Panics when called without the required auth |
| State after | Storage reflects the expected change |
| Event emitted | The correct event was published (for state-changing functions) |

### Asserting events

Use `env.events().all()` and check the last event:

```rust
fn assert_last_user_event(env: &Env, topic: &str, user: &Address) {
    let events = env.events().all();
    let (_, topics, _) = events.get(events.len() - 1).unwrap();
    assert_eq!(topics.get(0).unwrap(), Symbol::new(env, topic).into_val(env));
    assert_eq!(topics.get(1).unwrap(), user.clone().into_val(env));
}
```

### Advancing ledger time

Use `env.ledger().set()` to simulate time passing:

```rust
env.ledger().set(soroban_sdk::testutils::LedgerInfo {
    timestamp: current + 86_400, // advance by one day
    ..env.ledger().get()
});
```

### Running tests

```bash
cd contract
cargo test                       # all tests
cargo test daily_limit           # tests matching the prefix
cargo test -- --nocapture        # show println! output (useful for bench)
```

---

## Benchmarks

Benchmark tests live in `contract/src/bench.rs` and measure CPU instruction counts to detect performance regressions.

### Baselines

| Function | CPU instructions | Memory bytes |
|----------|-----------------|--------------|
| `subscribe()` | ~4 200 000 | ~200 000 |
| `charge()` | ~3 800 000 | ~180 000 |
| `pay_per_use()` | ~3 600 000 | ~170 000 |
| `batch_charge()` — 10 users | ~28 000 000 | ~1 200 000 |

Thresholds in `bench.rs` include ~10% headroom. If your change shifts a baseline by more than 5%, update the table and the constant.

### Adding a bench test

```rust
#[test]
fn bench_my_feature() {
    let (env, contract_id, token_addr, user, merchant) = bench_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    // ... setup state ...

    let usage = env.budget().cpu_instruction_count();
    client.my_function(&user);
    let delta = env.budget().cpu_instruction_count() - usage;

    println!("my_function instructions: {delta}");
    assert!(delta < MY_FUNCTION_MAX_INSTRUCTIONS);
}
```

---

## Event Emission Rules

- **Every state-changing public function must emit an event.** Read-only functions must not.
- All `publish_*` helpers live in `events.rs`. Add new ones there; never call `env.events().publish()` directly from `lib.rs` or module files.
- Use a two-element topic tuple `(Symbol, Address)` for user-scoped events, or a single-element `(Symbol,)` for contract-wide events.
- Topic symbols must be 32 characters or fewer (Soroban `Symbol` limit).
- Name symbols with snake_case matching the action: `subscribed`, `charged`, `daily_limit_set`, `merchant_frozen`.

**Adding a new event:**

```rust
// events.rs
pub fn publish_preference_set(env: &Env, user: &Address, value: u32) {
    env.events().publish(
        (Symbol::new(env, "preference_set"), user.clone()),
        value,
    );
}
```

Then call it from `lib.rs` after the state has been written:

```rust
my_feature::set_preference(&env, &user, value);
events::publish_preference_set(&env, &user, value);  // always last
```

The full event catalogue is documented in [`docs/EVENTS.md`](../docs/EVENTS.md).

---

## Error Variant Guidelines

All contract errors are defined in `errors.rs` as variants of `ContractError` (`#[contracterror]`).

- **One variant per distinct failure reason.** Do not reuse a variant for different conditions.
- Assign the next sequential `u32` discriminant. Never reuse or reorder existing values.
- Add a doc comment explaining exactly when the error is returned.
- Return errors via `Err(ContractError::VariantName)` from internal helpers; `lib.rs` should propagate or `unwrap_or_else` to panic with a clear message only as a last resort.

```rust
// errors.rs
/// Returned when a user's daily spending limit would be exceeded by this payment.
DailyLimitExceeded = 24,
```

The full error reference is in [`docs/ERROR-CODES.md`](../docs/ERROR-CODES.md).

---

## PR Checklist

Before opening a pull request against `main`:

**Contract**
- [ ] `cargo test` passes with no failures
- [ ] `cargo clippy -- -D warnings` passes with no warnings
- [ ] `cargo check` passes
- [ ] Every new public function has tests (happy path, auth, error cases, event)
- [ ] Every new state-changing function emits an event via `events.rs`
- [ ] New `ContractError` variants have doc comments and sequential discriminants
- [ ] New `DataKey` variants are documented in a comment explaining the storage type (persistent / temporary / instance) and TTL if relevant
- [ ] No `unwrap()` on user-controlled input — use `ok_or(ContractError::...)` instead
- [ ] No floating-point arithmetic — all amounts are in stroops (i128)
- [ ] `#![no_std]` is preserved — no `std::` imports anywhere

**Benchmarks**
- [ ] If your change touches `subscribe`, `charge`, `pay_per_use`, or `batch_charge`, run `cargo test bench -- --nocapture` and confirm instruction counts are within the documented baselines
- [ ] Update `bench.rs` constants and the baselines table if a deliberate change shifts a baseline

**Documentation**
- [ ] New public functions are added to [`docs/API.md`](API.md)
- [ ] New events are added to [`docs/EVENTS.md`](EVENTS.md)
- [ ] New error codes are added to [`docs/ERROR-CODES.md`](ERROR-CODES.md)
- [ ] PR description explains what changed, why, and links to the relevant issue

**CI**
- [ ] The `Backend (Rust)` GitHub Actions workflow passes (`cargo build` + `cargo test`)

---

## Related

- General contribution guide: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- API reference: [`docs/API.md`](API.md)
- Event catalogue: [`docs/EVENTS.md`](EVENTS.md)
- Error codes: [`docs/ERROR-CODES.md`](ERROR-CODES.md)
- Architecture and storage design: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- Testing runbook: [`docs/development/testing_runbook.md`](development/testing_runbook.md)
