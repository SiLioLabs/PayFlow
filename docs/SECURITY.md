# Security

This document describes the security model of FlowPay, known limitations, and how to report vulnerabilities.

---

## Current Status

FlowPay is deployed on **Testnet only** and has **not been formally audited**. It should not be used to manage real funds on Mainnet until an independent security audit has been completed.

---

## Security Model

### Allowance-Based Spending

FlowPay never holds user funds. It uses the Soroban token interface's `transfer_from` mechanism — the same pattern as ERC-20 `approve` + `transferFrom` on Ethereum.

The flow is:
1. User calls `approve()` on the token contract, granting FlowPay a spending allowance
2. FlowPay calls `transfer_from()` to move funds from user → merchant
3. The token contract enforces that the transferred amount does not exceed the approved allowance

This means:
- FlowPay cannot move more than the user has approved
- Users can revoke access at any time by calling `approve()` with `amount = 0` on the token contract
- Even if the FlowPay contract were compromised, it could only spend up to the approved allowance

### `require_auth()` Enforcement

Every function that mutates user state or moves user funds calls `user.require_auth()`:

| Function | Auth check |
| --- | --- |
| `subscribe()` | `user.require_auth()` |
| `pay_per_use()` | `user.require_auth()` |
| `cancel()` | `user.require_auth()` |
| `pause()` | `user.require_auth()` |
| `resume()` | `user.require_auth()` |
| `charge()` | None (intentionally permissionless — see below) |
| `initialize()` | None (one-time setup) |

### Why `charge()` is Permissionless

`charge()` has no auth requirement by design. This allows keeper services to trigger charges without holding user private keys. The contract enforces correctness independently:

- The subscription must exist
- `active` must be `true`
- The billing interval must have elapsed

If any condition fails, the transaction panics and no funds move. A malicious caller cannot extract funds by calling `charge()` — they can only trigger a legitimate charge that the user already consented to when subscribing.

### `initialize()` is One-Time Only

The contract checks for the existence of `DataKey::Token` before writing it. A second call to `initialize()` panics immediately. This prevents an attacker from re-initializing the contract with a malicious token address after deployment.

### No Upgradability

The FlowPay contract has no upgrade mechanism. Once deployed, the code is immutable. This is a deliberate security choice — it means no admin can change the contract logic after users have subscribed.

### Rust Memory Safety

The contract is written in Rust, which eliminates entire classes of vulnerabilities common in other languages: buffer overflows, use-after-free, null pointer dereferences, and integer overflow (Soroban's release profile enables `overflow-checks = true`).

---

## Known Limitations

### No TTL Management

Persistent storage entries on Stellar have a TTL (time-to-live). If a subscription's storage entry expires, it will be evicted from the ledger and the subscription will be lost. Currently, FlowPay does not automatically extend TTLs. A future version should call `env.storage().persistent().extend_ttl()` on active subscriptions during `charge()`.

**Mitigation:** On Testnet this is not a concern for development. For Mainnet, ensure a keeper service also extends TTLs regularly.

### No Allowance Validation at Subscribe Time

`subscribe()` does not verify that the user has approved a sufficient allowance before storing the subscription. If the user's allowance is too low, `charge()` will fail at transfer time. A future improvement would check the allowance in `subscribe()` and reject subscriptions with insufficient approval.

### Single Token Per Contract

Each deployed FlowPay contract is initialized with a single token. Supporting multiple tokens (e.g. both XLM and USDC) requires either deploying multiple contracts or refactoring the storage model. Multi-token support is a planned feature.

### Keeper Centralization

The `charge()` trigger relies on an external keeper. If the keeper goes offline, charges will not be processed. This is a liveness concern, not a safety concern — no funds can be lost, but merchants may not receive payments on time. A decentralized keeper network would improve this.

---

## Vulnerability Disclosure

If you discover a security vulnerability in FlowPay, please do **not** open a public GitHub issue.

Instead, report it privately:

- **Email:** [leave blank — add your contact email]
- **Subject:** `[FlowPay Security] Brief description`

Please include:
- A description of the vulnerability
- Steps to reproduce
- The potential impact
- Any suggested mitigations

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

We appreciate responsible disclosure and will credit researchers in the release notes unless they prefer to remain anonymous.

---

## Audit Roadmap

Before recommending Mainnet use, we plan to:

1. Complete the full feature set (multi-token, TTL management, pause/resume)
2. Expand the test suite to 100% branch coverage
3. Engage an independent Soroban security auditor
4. Publish the audit report publicly

If you are a security researcher interested in auditing FlowPay, please reach out.
