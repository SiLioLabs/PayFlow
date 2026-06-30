# Security

This document describes the current security model, threat model, known limitations, and responsible disclosure process for FlowPay.

---

## Current Status

FlowPay is deployed on Testnet only and has not been formally audited. Treat the contract as experimental until an independent review is complete.

---

## Threat Model

FlowPay is designed so an attacker can try to disrupt execution, but not silently move funds beyond approved limits.

### What an attacker can do

- Call permissionless entry points such as `charge()` and `batch_charge()`.
- Submit malformed or repeated transactions.
- Try to front-run keeper calls or send charges too early.
- Attempt to use stale or expired state.
- Abuse admin-style entry points if they control the required signer.

### What an attacker cannot do, by design

- Spend more than the user-approved token allowance.
- Change another user's subscription without that user's signature.
- Reinitialize the contract once `initialize()` has succeeded.
- Bypass the contract's interval and grace-window checks.
- Move tokens without going through the token contract's own authorization checks.

### Main attack vectors

1. Excessive `charge()` calls before a billing interval elapses.
2. Keeper manipulation or downtime that delays recurring billing.
3. Admin key compromise.
4. Allowance misuse if a user approves too much or leaves approval active too long.
5. Storage corruption or stale state caused by TTL expiry or migration bugs.
6. Malicious upgrade intent if upgrade control is not governed carefully.

The contract is built to fail closed. If a precondition is violated, the call panics and no funds are transferred.

---

## Auth Model

| Function | Required signer |
| --- | --- |
| `subscribe()` | `user` |
| `subscribe_with_metadata()` | `user` |
| `charge()` | None |
| `extend_subscription_ttl()` | None |
| `pay_per_use()` | `user` |
| `cancel()` | `user` |
| `pause()` | `user` |
| `resume()` | `user` |
| `transfer_admin()` | current admin |
| `accept_admin()` | pending admin |
| `upgrade()` | current implementation does not enforce a signer in the wrapper |
| `set_subscription_amount()` | admin |
| `set_subscription_interval()` | admin |
| `set_min_interval()` | admin |
| `add_merchant()` | admin |
| `remove_merchant()` | admin |
| `set_whitelist_enabled()` | admin |
| `freeze_merchant()` | admin |
| `unfreeze_merchant()` | admin |
| `propose_fee()` | admin |
| `commit_fee()` | admin |
| `propose_grace_period()` | admin |
| `commit_grace_period()` | admin |
| `withdraw_merchant_revenue()` | merchant |
| `set_daily_limit()` | `user` |
| `remove_daily_limit()` | `user` |
| `set_metadata()` | `user` |
| `clear_metadata()` | `user` |
| `clear_charge_history()` | `user` |
| `transfer_subscription()` | `user` |
| read-only getters | none |
| `pause_contract()` / `unpause_contract()` | admin |
| `clear_merchant_revenue_history()` | admin |
| `reset_merchant_revenue()` | admin |
| `set_initial_admin()` | none |
| `migrate()` | none |

The current contract uses a mix of direct `require_auth()` checks and admin helper enforcement. That is intentional, but the auth path should be reviewed whenever a new public function is added.

---

## Storage Security

### Persistent vs temporary storage

- Persistent storage is used for long-lived subscription, merchant, metadata, referral, and history data.
- Temporary storage is used for short-lived proposals and daily limit counters.
- Instance storage holds protocol-wide configuration and pause flags.

### Security implications

- Temporary data can disappear if TTL expires, so it should only hold values that are safe to recompute or re-propose.
- Persistent subscription entries have their TTL refreshed during active lifecycle changes so they are less likely to be evicted.
- Read paths that depend on temporary data must tolerate missing entries.

### Practical risk

If storage TTL is not refreshed when expected, users may lose history or proposal state. The contract should prefer safe defaults and avoid treating temporary data as authoritative when a fallback exists.

---

## Upgrade Risks

The contract includes an upgrade wrapper, which means upgrade governance matters.

### Risks

- A malicious or compromised upgrade authority could replace contract behavior.
- An upgrade can accidentally change storage layout or event semantics.
- Off-chain integrations may break if a new version changes function behavior without a migration plan.

### Mitigations

- Keep migrations explicit and versioned.
- Preserve storage compatibility when adding fields.
- Update docs and tests whenever the public ABI changes.
- Review upgrade authority handling before Mainnet deployment.

---

## Known Limitations

- Single-token operation is still the default contract model.
- The keeper is an external liveness dependency.
- There is no fully decentralized dispute-resolution layer for failed or delayed charges.
- Admin powers are broad and should be treated as high trust until governance is tightened.

---

## Responsible Disclosure

If you discover a vulnerability, do not open a public issue.

Report it privately through one of the following channels:

- GitHub Security Advisories in this repository.
- Email: security@payflow.dev
- Subject line: [FlowPay Security] short description

Please include:

- A short description of the issue.
- Reproduction steps.
- Expected impact.
- Any logs, traces, or proof-of-concept details that help triage.

We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan as quickly as possible for critical issues.
