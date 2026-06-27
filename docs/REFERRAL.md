# Referral System Guide

This guide explains how the PayFlow referral tracking system works and how to use it to build referral reward programs.

---

## Table of Contents

- [How Referral Tracking Works](#how-referral-tracking-works)
- [Subscribing with a Referrer](#subscribing-with-a-referrer)
- [Reading Referrer Data](#reading-referrer-data)
- [Referred Event](#referred-event)
- [Building a Referral Program](#building-a-referral-program)
- [CLI Examples](#cli-examples)

---

## How Referral Tracking Works

PayFlow includes a simple, built-in referral tracking system:
- Stores a referrer address for each subscriber
- Emits an event when a referred user subscribes
- Prevents self-referrals
- Allows updating or clearing the referrer when re-subscribing

Referral data is stored in persistent storage under `DataKey::Referral(user_address)`.

---

## Subscribing with a Referrer

To track referrals, pass the referrer address in the `referrer` parameter when calling `subscribe()`.

### Key Points:
- `referrer` is optional (can be `null`)
- If provided, the referrer cannot be the same as the user (self-referrals are not allowed)
- If a user re-subscribes with a new referrer, it replaces the old one
- If a user re-subscribes with `referrer: null`, it clears the stored referrer

---

## Reading Referrer Data

Use the `get_referrer()` function to read the referrer for any user:

```rust
pub fn get_referrer(env: Env, user: Address) -> Option<Address>
```

This returns:
- `Some(referrer_address)` if a referrer was recorded
- `None` if no referrer was recorded (or it was cleared)

---

## Referred Event

When a user subscribes with a referrer, PayFlow emits a `referred` event:

### Event Details:
- **Event Name**: `referred`
- **Topic Keys**: `["referred", user_address]`
- **Payload Schema**: `referrer: Address`
- **JSON Example**:
  ```json
  {
    "topic": ["referred", "GNEW...USER"],
    "data": "GREF...ERRER"
  }
  ```

---

## Building a Referral Program

PayFlow's referral tracking is a building block - you can build your own custom referral reward system on top of it. Here are some ideas:

### Example 1: One-Time Signup Bonus
1. Listen for `referred` events
2. When a new user subscribes with a referrer, send a bonus token to the referrer
3. Optional: Require the new user to make their first payment before rewarding the referrer

### Example 2: Recurring Commission
1. Listen for `charged` events
2. For each charge, check if the user has a referrer using `get_referrer()`
3. If they do, send a percentage of the charged amount to the referrer as commission

### Example 3: Tiered Rewards
- Track how many referrals each referrer has made
- Give higher commission rates for referrers with more referrals

---

## CLI Examples

### Subscribing with a Referrer

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source user \
  --network testnet \
  -- subscribe \
  --user USER_ADDRESS \
  --merchant MERCHANT_ADDRESS \
  --amount 50000000 \
  --interval 2592000 \
  --token TOKEN_ADDRESS \
  --trial-period 0 \
  --referrer REFERRER_ADDRESS
```

### Reading a Referrer

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source any \
  --network testnet \
  -- get_referrer \
  --user USER_ADDRESS
```

### Clearing a Referrer

To clear a referrer for a user, re-subscribe with `--referrer null`:

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source user \
  --network testnet \
  -- subscribe \
  --user USER_ADDRESS \
  --merchant MERCHANT_ADDRESS \
  --amount 50000000 \
  --interval 2592000 \
  --token TOKEN_ADDRESS \
  --trial-period 0 \
  --referrer null
```
