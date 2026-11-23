# Security
<!-- updated -->
> **Revision date:** 2026-09-26  
> Auth matrix rebuilt by grepping `require_auth` across `contract/src/` (lib.rs, admin.rs, fee.rs, grace.rs, merchant_stats.rs, migration.rs, upgrade.rs). All 22 call sites accounted for. `transfer_subscription` corrected to two signers; `cancel_and_refund_prorated`, `withdraw_merchant_revenue`, `set_merchant_fee_recipient`, `pay_per_use_to`, `pause_until`, `extend_trial`, and `batch_charge` added. `clear_charge_history` and `set_initial_admin` corrected to admin-gated. Stale single-token limitation removed.

This document describes the current security model, threat model, known limitations, and responsible disclosure process for FlowPay.

---

## Current Status

FlowPay is deployed on Testnet only and has not been formally audited. Treat the contract as experimental until an independent review is complete.

### Audit roadmap

1. Complete the internal preparation checklist in [`docs/security/AUDIT-PREPARATION.md`](security/AUDIT-PREPARATION.md).
2. Freeze and tag an audit candidate commit; publish the WASM hash.
3. Engage an independent Soroban-focused auditor with the in-scope contract sources.
4. Remediate findings, re-test, and publish the report (or summary) before Mainnet.

Use the [Security Audit Preparation Guide](security/AUDIT-PREPARATION.md) for invariants, threat mapping, scope, and known limitations to brief auditors.

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
| `subscribe()`, `subscribe_with_metadata()` | `user` |
| `cancel()` | `user` |
| `extend_trial()` | `user` |
| `pause()`, `pause_until()` | `user` |
| `resume()` | `user` |
| `pay_per_use()`, `pay_per_use_to()` | `user` |
| `set_daily_limit()`, `remove_daily_limit()` | `user` |
| `set_metadata()`, `clear_metadata()` | `user` |
| `transfer_subscription()` | `user` **and** `new_user` |
| `cancel_and_refund_prorated()` | `user` **and** `merchant` |
| `withdraw_merchant_revenue()` | `merchant` |
| `set_merchant_fee_recipient()` | `merchant` |
| `transfer_admin()` | current admin |
| `accept_admin()` | pending admin |
| `initialize()`, `set_initial_admin()` | admin |
| `set_max_batch_size()`, `set_max_whitelist_batch_size()` | admin |
| `set_fee_bounds()`, `set_global_volume_cap()` | admin |
| `batch_pause_subscriptions()`, `batch_cancel()` | admin |
| `whitelist_batch_add()`, `whitelist_batch_remove()` | admin |
| `set_subscription_amount()`, `set_subscription_interval()` | admin |
| `set_min_interval()` | admin |
| `add_merchant()`, `remove_merchant()` | admin |
| `set_whitelist_enabled()` | admin |
| `freeze_merchant()`, `unfreeze_merchant()` | admin |
| `clear_fee()`, `propose_fee()`, `commit_fee()` | admin |
| `propose_grace_period()`, `commit_grace_period()` | admin |
| `clear_charge_history()`, `prune_charge_history()` | admin |
| `clear_merchant_revenue_history()`, `reset_merchant_revenue()` | admin |
| `prune_merchant_revenue_days()` | admin |
| `extend_subscriber_index_ttl()`, `clear_subscriber_index_entry()` | admin |
| `pause_contract()`, `unpause_contract()` | admin |
| `propose_upgrade()`, `commit_upgrade()`, `cancel_pending_upgrade()` | admin |
| `migrate()`, `finalize_migration()` | admin |
| `set_keeper_tip_bps()` | admin |
| `charge()`, `batch_charge()` | none |
| `extend_subscription_ttl()`, `batch_extend_subscription_ttl()` | none |
| `bump_subscription()`, `bump_instance_ttl()` | none |
| `bump_merchant_revenue_day()` | none |
| `simulate_charge()`, `simulate_pay_per_use()`, `simulate_pay_per_use_to()` | none |
| read-only getters | none |

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

- The keeper is an external liveness dependency.
- There is no fully decentralized dispute-resolution layer for failed or delayed charges.
- Admin powers are broad and should be treated as high trust until governance is tightened.

For merchant finance teams assembling billing records for accounting or regulatory review, see [COMPLIANCE.md](./COMPLIANCE.md) (audit trail generation, on-chain vs ephemeral data, retention, and explicit non-goals such as KYC and tax calculation).

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