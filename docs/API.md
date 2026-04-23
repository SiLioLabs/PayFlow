# Contract API Reference

This document is the complete reference for the FlowPay Soroban smart contract. It covers every public function, its parameters, return values, auth requirements, and error conditions.

---

## Data Types

### `Subscription`

The core data structure stored per subscriber.

```rust
pub struct Subscription {
    pub merchant: Address,   // Stellar address of the payment recipient
    pub amount: i128,        // Amount per period, in stroops (1 XLM = 10_000_000)
    pub interval: u64,       // Seconds between charges
    pub last_charged: u64,   // Ledger UNIX timestamp of the last successful charge
    pub active: bool,        // false if the subscription has been cancelled
    pub paused: bool,        // true if the subscription is temporarily paused
}
```

### `DataKey`

Internal storage keys. Not part of the public API but useful for understanding storage layout.

```rust
pub enum DataKey {
    Subscription(Address),  // persistent — one entry per subscriber
    Token,                  // instance — the token contract address
}
```

---

## Functions

---

### `initialize`

One-time contract setup. Must be called before any other function.

```
initialize(env: Env, token: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `token` | `Address` | The Stellar Asset Contract (SAC) address of the token to use for payments |

**Auth:** None required.

**Storage written:** `DataKey::Token` in instance storage.

**Errors**

| Condition | Panic message |
| --- | --- |
| Called more than once | `"already initialized"` |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- initialize \
  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

---

### `subscribe`

Creates or overwrites a subscription for the calling user.

```
subscribe(env: Env, user: Address, merchant: Address, amount: i128, interval: u64)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |
| `merchant` | `Address` | The payment recipient. |
| `amount` | `i128` | Stroops to transfer per period. Must be > 0. |
| `interval` | `u64` | Seconds between charges. Must be > 0. Common values: `86400` (1 day), `604800` (1 week), `2592000` (~30 days). |

**Auth:** `user.require_auth()` — the transaction must be signed by `user`.

**Storage written:** `DataKey::Subscription(user)` in persistent storage. `last_charged` is set to the current ledger timestamp.

**Events emitted**

```
topic:  ("subscribed", user)
data:   (merchant, amount, interval)
```

**Errors**

| Condition | Panic message |
| --- | --- |
| `amount <= 0` | `"amount must be positive"` |
| `interval == 0` | `"interval must be positive"` |

**Pre-condition:** The user must have called `approve()` on the token contract granting the FlowPay contract an allowance of at least `amount` before subscribing.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- subscribe \
  --user <USER_ADDRESS> \
  --merchant <MERCHANT_ADDRESS> \
  --amount 50000000 \
  --interval 2592000
```

---

### `charge`

Triggers a recurring charge for a subscriber. Permissionless — anyone can call this.

```
charge(env: Env, user: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber to charge. |

**Auth:** None. This function is intentionally permissionless so keeper services can call it without holding user keys.

**What it does:**
1. Loads the subscription for `user`
2. Asserts `active == true`
3. Asserts `now >= last_charged + interval`
4. Calls `transfer_from(contract, user, merchant, amount)` on the token contract
5. Updates `last_charged = now`

**Events emitted**

```
topic:  ("charged", user)
data:   (merchant, amount, timestamp)
```

**Errors**

| Condition | Panic message |
| --- | --- |
| No subscription exists | `"no subscription found"` |
| Subscription is cancelled | `"subscription is not active"` |
| Subscription is paused | `"subscription is paused"` |
| Interval has not elapsed | `"interval not elapsed yet"` |
| Contract not initialized | `"not initialized"` |
| Insufficient allowance | Host error from token contract |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER_KEY> \
  --network testnet \
  -- charge \
  --user <USER_ADDRESS>
```

---

### `pay_per_use`

Instantly transfers an arbitrary amount from the user to their subscribed merchant. No interval check. Useful for metered or usage-based billing.

```
pay_per_use(env: Env, user: Address, amount: i128)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The payer. Must match the transaction signer. |
| `amount` | `i128` | Stroops to transfer. Must be > 0. |

**Auth:** `user.require_auth()`.

**What it does:**
1. Loads the subscription for `user`
2. Asserts `active == true`
3. Calls `transfer_from(contract, user, merchant, amount)` on the token contract

Note: `pay_per_use` does **not** update `last_charged`. It is independent of the recurring billing cycle.

**Events emitted**

```
topic:  ("pay_per_use", user)
data:   (merchant, amount)
```

**Errors**

| Condition | Panic message |
| --- | --- |
| `amount <= 0` | `"amount must be positive"` |
| No subscription exists | `"no subscription found"` |
| Subscription is cancelled | `"subscription is not active"` |
| Subscription is paused | `"subscription is paused"` |
| Insufficient allowance | Host error from token contract |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- pay_per_use \
  --user <USER_ADDRESS> \
  --amount 1000000
```

---

### `pause`

Temporarily halts charges for a subscription. The subscription record is preserved and can be resumed at any time. Both `charge()` and `pay_per_use()` will panic while paused.

```
pause(env: Env, user: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |

**Auth:** `user.require_auth()`.

**Events emitted**

```
topic:  ("paused", user)
data:   ()
```

**Errors**

| Condition | Panic message |
| --- | --- |
| No subscription exists | `"no subscription found"` |
| Subscription is cancelled | `"subscription is not active"` |
| Subscription already paused | `"subscription is already paused"` |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- pause \
  --user <USER_ADDRESS>
```

---

### `resume`

Resumes a paused subscription, re-enabling `charge()` and `pay_per_use()`.

```
resume(env: Env, user: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |

**Auth:** `user.require_auth()`.

**Events emitted**

```
topic:  ("resumed", user)
data:   ()
```

**Errors**

| Condition | Panic message |
| --- | --- |
| No subscription exists | `"no subscription found"` |
| Subscription is cancelled | `"subscription is not active"` |
| Subscription is not paused | `"subscription is not paused"` |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- resume \
  --user <USER_ADDRESS>
```

---

### `cancel`

Deactivates a subscription. The subscription record remains in storage with `active = false`. No further charges can be made.

```
cancel(env: Env, user: Address)
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber. Must match the transaction signer. |

**Auth:** `user.require_auth()`.

**Events emitted**

```
topic:  ("cancelled", user)
data:   ()
```

**Errors**

| Condition | Panic message |
| --- | --- |
| No subscription exists | `"no subscription found"` |

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- cancel \
  --user <USER_ADDRESS>
```

---

### `get_subscription`

Read-only view function. Returns the subscription for a given user, or `None` if none exists.

```
get_subscription(env: Env, user: Address) -> Option<Subscription>
```

**Parameters**

| Name | Type | Description |
| --- | --- | --- |
| `user` | `Address` | The subscriber address to look up. |

**Auth:** None.

**Returns:** `Option<Subscription>` — `None` if no subscription exists for this address.

**CLI example**

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_subscription \
  --user <USER_ADDRESS>
```

---

## Units & Conversions

All amounts are in **stroops** — the smallest unit of a Stellar token.

| Amount | Stroops |
| --- | --- |
| 1 XLM | 10,000,000 |
| 0.5 XLM | 5,000,000 |
| 0.0000001 XLM | 1 |

All intervals are in **seconds**.

| Interval | Seconds |
| --- | --- |
| 1 day | 86,400 |
| 1 week | 604,800 |
| 30 days | 2,592,000 |

---

## Events Reference

All events can be indexed by listening to the Stellar RPC event stream for the FlowPay contract ID.

| Event name | Topic | Data |
| --- | --- | --- |
| `subscribed` | `("subscribed", user_address)` | `(merchant, amount, interval)` |
| `charged` | `("charged", user_address)` | `(merchant, amount, timestamp)` |
| `pay_per_use` | `("pay_per_use", user_address)` | `(merchant, amount)` |
| `cancelled` | `("cancelled", user_address)` | `()` |
| `paused` | `("paused", user_address)` | `()` |
| `resumed` | `("resumed", user_address)` | `()` |
