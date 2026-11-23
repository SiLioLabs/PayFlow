# Development Testing Runbook

## Overview

This guide documents standard testing practices for PayFlow contract development. It covers ledger time manipulation, external contract mocking, and Rust unit test patterns.

## Ledger Time Manipulation

### Setting Ledger Timestamp

Tests simulate time-based billing logic (renewal periods, grace windows, trial expiration) by manipulating the ledger timestamp:

```rust
#[test]
fn test_subscription_renewal_after_interval() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PayFlowContract);

    // Create subscription at timestamp 1000
    env.ledger().set_timestamp(1000);
    let user = Address::random(&env);
    let merchant = Address::random(&env);

    env.invoke_contract(
        &contract_id,
        &Symbol::new(&env, "subscribe"),
        &vec![
            &env,
            &user,
            &merchant,
            &1_000_000i128,      // amount
            &86400i64,            // 24-hour interval
        ],
    );

    // Advance time to next billing window
    env.ledger().set_timestamp(1000 + 86400 + 1); // Just past interval

    // Verify charge is now eligible
    let eligible = env.invoke_contract(
        &contract_id,
        &Symbol::new(&env, "is_charge_eligible"),
        &vec![&env, &user],
    );

    assert_eq!(eligible, true);
}
```

### Grace Period Testing

```rust
#[test]
fn test_grace_period_extends_charge_window() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PayFlowContract);

    env.ledger().set_timestamp(1000);

    // Setup subscription
    let user = Address::random(&env);
    env.invoke_contract(&contract_id, &Symbol::new(&env, "subscribe"), &vec![/*...*/]);

    // Simulate insufficient balance at charge time
    env.ledger().set_timestamp(1000 + 86400 + 1);

    // Charge fails due to low balance
    let result = env.invoke_contract(
        &contract_id,
        &Symbol::new(&env, "charge"),
        &vec![&env, &user],
    );
    assert!(result.is_err());

    // Grace period window (1 hour) allows retry
    env.ledger().set_timestamp(1000 + 86400 + 3600);

    let grace_result = env.invoke_contract(
        &contract_id,
        &Symbol::new(&env, "charge"),
        &vec![&env, &user],
    );
    assert!(grace_result.is_ok());
}
```

### Trial Period Expiration

```rust
#[test]
fn test_trial_expires_after_duration() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PayFlowContract);

    env.ledger().set_timestamp(1000);

    // Activate trial (30 days = 2592000 seconds)
    env.invoke_contract(
        &contract_id,
        &Symbol::new(&env, "activate_trial"),
        &vec![&env, &user],
    );

    // Before expiration - trial active
    env.ledger().set_timestamp(1000 + 2591999);
    let status = check_subscription_status(&env, &contract_id, &user);
    assert_eq!(status, SubscriptionStatus::TrialActive);

    // After expiration - trial expires
    env.ledger().set_timestamp(1000 + 2592001);
    let status = check_subscription_status(&env, &contract_id, &user);
    assert_eq!(status, SubscriptionStatus::Active);
}
```

## External Token Contract Mocking

### Mock Token Setup

```rust
#[test]
fn test_charge_with_mock_token() {
    let env = Env::default();

    // Deploy mock token contract
    let token = env.register_stellar_asset_contract(AssetType::Native);
    let token_client = TokenClient::new(&env, &token);

    let user = Address::random(&env);
    let merchant = Address::random(&env);

    // Mint initial balance to user
    token_client.mint(&user, &1_000_000_000i128);

    // Deploy PayFlow contract
    let contract_id = env.register_contract(None, PayFlowContract);

    // User approves PayFlow to spend tokens
    token_client.approve(&user, &contract_id, &1_000_000_000i128, &10000i64);

    // Execute subscription
    env.invoke_contract(
        &contract_id,
        &Symbol::new(&env, "subscribe"),
        &vec![
            &env,
            &user,
            &merchant,
            &100_000i128,
            &86400i64,
        ],
    );

    // Verify token approval consumed
    let balance = token_client.balance(&user);
    assert!(balance < 1_000_000_000i128);
}
```

### Mock Token Failures

```rust
#[test]
fn test_charge_fails_with_insufficient_balance() {
    let env = Env::default();
    let token = env.register_stellar_asset_contract(AssetType::Native);
    let token_client = TokenClient::new(&env, &token);

    let user = Address::random(&env);
    let merchant = Address::random(&env);

    // Mint only 50 tokens to user
    token_client.mint(&user, &50i128);

    let contract_id = env.register_contract(None, PayFlowContract);
    token_client.approve(&user, &contract_id, &50i128, &10000i64);

    // Attempt subscription requiring 100 tokens
    let result = env.invoke_contract(
        &contract_id,
        &Symbol::new(&env, "subscribe"),
        &vec![
            &env,
            &user,
            &merchant,
            &100i128,  // Exceeds balance
            &86400i64,
        ],
    );

    // Should fail
    assert!(result.is_err());
}
```

## TTL Extension Testing

### Verifying Ledger Entry TTL

```rust
#[test]
fn test_subscription_ttl_extended_on_charge() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PayFlowContract);

    env.ledger().set_timestamp(1000);

    // Create subscription
    let user = Address::random(&env);
    env.invoke_contract(&contract_id, &Symbol::new(&env, "subscribe"), &vec![/*...*/]);

    // Get initial TTL
    let initial_ttl = env.ledger().max_live_until();

    // Advance time and charge
    env.ledger().set_timestamp(1000 + 86400 + 1);
    env.invoke_contract(&contract_id, &Symbol::new(&env, "charge"), &vec![&env, &user]);

    // TTL should be extended
    let new_ttl = env.ledger().max_live_until();
    assert!(new_ttl > initial_ttl);
}
```

## Panic Testing

### Asserting Contract Panics

```rust
#[test]
#[should_panic(expected = "Unauthorized")]
fn test_admin_freeze_panics_without_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PayFlowContract);

    let unauthorized_user = Address::random(&env);
    env.as_contract(&contract_id, || {
        env.invoke_contract(
            &contract_id,
            &Symbol::new(&env, "admin_emergency_freeze"),
            &vec![],
        )
        .unwrap(); // Will panic with Unauthorized error
    });
}
```

### Custom Panic Patterns

```rust
#[test]
fn test_invalid_amount_panics() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PayFlowContract);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.invoke_contract(
            &contract_id,
            &Symbol::new(&env, "charge"),
            &vec![
                &env,
                &Address::random(&env),
                &0i128, // Invalid: zero amount
            ],
        )
    }));

    assert!(result.is_err());
}
```

## Test Execution Workflow

### Running All Tests

```bash
# Run entire test suite
cargo test

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_subscription_renewal_after_interval

# Run tests matching pattern
cargo test batch_charge
```

### Debugging Failed Tests

```bash
# Run with backtrace
RUST_BACKTRACE=1 cargo test -- --nocapture

# Run single test with full output
cargo test test_name -- --nocapture --test-threads=1

# Check for panics
cargo test -- --test-threads=1
```

### Snapshot Testing

Contract test snapshots live under `contract/test_snapshots/` in two subdirectories:

- `contract/test_snapshots/bench/` — benchmark CPU/memory snapshots
- `contract/test_snapshots/test/` — test output snapshots

These are JSON captures of expected output used to detect regressions in instruction counts, memory usage, and event emission.

```bash
# Run tests (generates/validates snapshots)
cargo test

# Review snapshot updates
git diff test_snapshots/

# Run with output to see what changed
cargo test -- --nocapture
```

When a snapshot changes:

1. Run `git diff test_snapshots/` to inspect the difference.
2. If the change is deliberate (e.g., you optimized a code path), accept the new snapshot by committing the updated JSON file.
3. If the change is unexpected, investigate as a potential regression.
4. Never blindly accept snapshot churn — cost increases should be justified, especially in the contract hot path.

## Best Practices

1. **Always set initial ledger timestamp** to predictable value (e.g., 1000)
2. **Mock all external dependencies** (tokens, oracle data)
3. **Test both success and failure paths** for each function
4. **Use descriptive test names** (e.g., `test_grace_period_extends_charge_window`)
5. **Isolate tests** - each test creates independent environment
6. **Keep tests deterministic** - avoid non-deterministic time or random values
7. **Test edge cases** - boundary conditions, off-by-one errors, overflow scenarios

---

## Frontend Testing (Vitest)

Frontend tests run with Vitest in a jsdom environment. Vitest globals (`describe`, `it`, `expect`, `vi`) are enabled globally — no imports needed.

### Running frontend tests

```bash
cd frontend
npx vitest run          # Single run
npx vitest              # Watch mode
```

### Test file location

All frontend tests live under `frontend/src/__tests__/` with the naming convention `*.test.ts` or `*.test.tsx`.

### Mocking patterns

The frontend mocks `stellar.ts` in `frontend/src/__tests__/__mocks__/stellar.ts`. Component tests use `@testing-library/react` for rendering and `@testing-library/user-event` for interaction simulation.

### Vitest configuration

The Vitest config is at `frontend/vitest.config.ts`:

- **Environment:** `jsdom`
- **Globals:** `true` (no need to import test functions)
- **Setup file:** `frontend/src/setupTests.ts`

### Writing a new frontend test

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyComponent from "../components/MyComponent";

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(<MyComponent prop="value" />);
    expect(screen.getByText("value")).toBeInTheDocument();
  });

  it("handles user interaction", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<MyComponent onClick={onClick} />);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```
