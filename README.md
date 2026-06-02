# PayFlow — `get_daily_limit()` Read Function

**Issue:** Add `get_daily_limit()` read function (symmetric to `set_daily_limit`)  
**Branch:** `feat/get-daily-limit`  
**Status:** ✅ Implemented & tested

---

## What This Does

Users who set a daily spending cap via `set_daily_limit()` had no way to read it back. This adds a public `get_daily_limit()` function to the `FlowPay` contract so users can query their current cap at any time.

---

## Background

FlowPay is a Soroban smart contract on Stellar that handles recurring subscriptions and pay-per-use billing. The `pay_per_use()` function supports an optional daily spending limit — users can call `set_daily_limit()` to cap how much they spend in a single day. Before this change, there was no corresponding read function, leaving users unable to verify what limit they had set.

---

## Changes

### `contract/src/spending_limit.rs`

The internal helper `get_daily_limit` reads from temporary storage and returns `None` if no limit has been set for the user:

```rust
/// Returns the daily spending limit for a user, or `None` if not set.
pub fn get_daily_limit(env: &Env, user: &Address) -> Option<i128> {
    env.storage()
        .temporary()
        .get(&DataKey::DailyLimit(user.clone()))
}
```

### `contract/src/lib.rs`

The public contract method exposes this to callers. No auth is required — reading your own limit is a view-only operation:

```rust
/// Returns the current daily spending limit for the caller, or `None` if unset.
pub fn get_daily_limit(env: Env, user: Address) -> Option<i128> {
    spending_limit::get_daily_limit(&env, &user)
}
```

---

## API

```
get_daily_limit(env: Env, user: Address) -> Option<i128>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `user` | `Address` | The subscriber address to query |

**Returns:** `Some(limit)` in stroops if a limit is set, `None` otherwise.  
**Auth:** None required.  
**Storage:** Reads `DataKey::DailyLimit(user)` from temporary storage.

**CLI example:**
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_daily_limit \
  --user <USER_ADDRESS>
```

---

## Tests

The following tests in `contract/src/test.rs` cover this function:

### `test_daily_limit_visibility_and_spend_tracking`

Verifies the full lifecycle — `None` before setting, correct value after setting, and unchanged after a `pay_per_use` call:

```rust
#[test]
fn test_daily_limit_visibility_and_spend_tracking() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);

    // None before any limit is set
    assert_eq!(client.get_daily_limit(&user), None);
    assert_eq!(client.get_daily_spent(&user), 0);

    client.set_daily_limit(&user, &4_0000000);

    // Returns the set value
    assert_eq!(client.get_daily_limit(&user), Some(4_0000000));

    client.pay_per_use(&user, &1_0000000);

    // Limit unchanged after spending
    assert_eq!(client.get_daily_spent(&user), 1_0000000);
    assert_eq!(client.get_daily_limit(&user), Some(4_0000000));
}
```

### `test_daily_limit_removed_event_emitted`

Verifies `get_daily_limit` returns `None` after `remove_daily_limit` is called:

```rust
#[test]
fn test_daily_limit_removed_event_emitted() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.set_daily_limit(&user, &4_0000000);
    client.remove_daily_limit(&user);

    assert_eq!(client.get_daily_limit(&user), None);
    assert_last_user_event(&env, "daily_limit_removed", &user);
}
```

---

## Running the Tests

```bash
cd contract
cargo test
```

To run only the spending limit tests:

```bash
cargo test daily_limit
```

Expected output:
```
test test::test_daily_limit_allows_spend_within_limit ... ok
test test::test_daily_limit_accumulates_across_calls ... ok
test test::test_daily_limit_blocks_cumulative_overspend ... ok
test test::test_daily_limit_blocks_overspend ... ok
test test::test_daily_limit_removed_event_emitted ... ok
test test::test_daily_limit_set_event_emitted ... ok
test test::test_daily_limit_visibility_and_spend_tracking ... ok
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | 1.70+ | `curl https://sh.rustup.rs -sSf \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | 21.x | `cargo install --locked soroban-cli` |

---

## Related

- `set_daily_limit(user, limit)` — sets the cap
- `remove_daily_limit(user)` — clears the cap
- `get_daily_spent(user)` — returns how much has been spent today
- `pay_per_use(user, amount)` — the function this limit applies to
- Full API reference: [`docs/API.md`](docs/API.md)
- Architecture overview: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
