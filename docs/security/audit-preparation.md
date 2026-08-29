# Security Audit Preparation Guide

This guide prepares the FlowPay protocol team for a formal Soroban smart-contract security audit. Use it to assemble artifacts, document invariants, scope the engagement, and brief auditors on intentional design choices that can look like bugs.

**Related**

- Security overview: [`docs/SECURITY.md`](../SECURITY.md)
- Threat matrix: [`docs/security/threat_matrix.md`](threat_matrix.md)
- Error recovery: [`docs/ERROR-CODES.md`](../ERROR-CODES.md)
- Contract source: [`contract/src/`](../../contract/src/)

---

## 1. Preparation Checklist

Complete these items **before** kickoff with an external auditor.

### Documents to assemble

- [ ] This guide (invariants, scope, known limitations)
- [ ] [`threat_matrix.md`](threat_matrix.md) with current mitigations
- [ ] [`SECURITY.md`](../SECURITY.md) auth model table
- [ ] [`ARCHITECTURE.md`](../ARCHITECTURE.md) and storage/TTL notes
- [ ] [`API.md`](../API.md) public ABI reference
- [ ] Latest testnet deployment addresses and WASM hashes
- [ ] `cargo test` / CI green report for the audit-tagged commit
- [ ] Diff since last reviewed commit (if any prior review)

### Code freeze & tagging

- [ ] Tag the audit candidate: `git tag audit-vX.Y.Z <commit>`
- [ ] Freeze non-critical merges to the tagged branch
- [ ] Publish SHA256 of the release WASM artifact

### Access for auditors

- [ ] Read access to the GitHub repo (or a mirror) at the tagged commit
- [ ] Build instructions: Rust toolchain, `wasm32-unknown-unknown`, `cd contract && cargo test`
- [ ] Point of contact for private questions (security@payflow.dev)

---

## 2. Contract Invariants

Auditors should treat the following as **required properties** of a correct deployment. Statements use RFC-style language.

### Funds & allowances

1. The contract **MUST NOT** transfer more tokens from a user than that user’s current Stellar Asset Contract (SAC) allowance to the FlowPay contract.
2. A successful `charge()` / `pay_per_use()` **MUST** move funds only via the token contract’s authorized transfer path (`transfer_from` or equivalent).
3. The protocol fee portion **MUST NOT** exceed `amount * bps / 10_000` for the configured `bps`, and `bps` **MUST** be in `[0, 10000]`.

### Subscription lifecycle

4. `initialize()` **MUST** succeed at most once per deployed instance (`AlreadyInitialized` thereafter).
5. Subscription amount and interval **MUST NOT** change without the required admin (or documented privileged) authorization path.
6. A charge **MUST NOT** succeed unless the subscription exists, is active, is not user-paused, and the billing interval has elapsed.
7. A charge **MUST NOT** succeed after `last_charged + interval + grace_period` (`GracePeriodElapsed`).
8. User-authenticated entrypoints (`subscribe`, `cancel`, `pause`, `resume`, `set_daily_limit`, etc.) **MUST** require the subject user’s signature.

### Limits & batching

9. Daily spent for `pay_per_use` **MUST NOT** exceed the user-configured daily limit while that limit is present in temporary storage.
10. `batch_charge` input size **MUST NOT** exceed the configured / hard maximum (`BatchTooLarge`).
11. Global volume accounting **MUST NOT** allow a charge that would exceed the configured global volume cap (`GlobalVolumeExceeded`).

### Admin & pause

12. Admin-only functions **MUST** verify the caller is the current admin (or complete the documented two-step transfer / proposal flow).
13. While the contract pause flag is set, charge and subscribe paths **MUST** fail closed (`ContractPaused` / `ContractPausedError`).
14. Two-step commits (admin transfer, fee, grace) **MUST NOT** succeed without a pending, non-expired proposal (`NoPendingProposal`).

### Merchants & validation

15. When whitelist mode is enabled, subscribe **MUST NOT** succeed for a non-whitelisted merchant.
16. Subscribe **MUST NOT** succeed for a frozen merchant.
17. Self-referral **MUST NOT** be accepted (`referrer != user`).
18. Invalid fee collectors (e.g. the contract’s own address) **MUST** be rejected.

---

## 3. Threat Model Summary

Mapped from [`threat_matrix.md`](threat_matrix.md) and [`SECURITY.md`](../SECURITY.md). Ratings are qualitative for briefing (Likelihood × Impact: L/M/H).

| Threat                                         | Category       | L   | I   | Primary mitigations                                                              |
| ---------------------------------------------- | -------------- | --- | --- | -------------------------------------------------------------------------------- |
| Token allowance draining via repeated charges  | Access / funds | M   | H   | Per-tx max amount; min interval; grace window; SAC allowance ceiling             |
| Unauthenticated admin actions                  | Access control | L   | H   | `require_auth` / admin checks on privileged entrypoints; two-step admin transfer |
| Short-interval spam / resource exhaustion      | DoS            | M   | M   | Min interval floor; batch size caps; pagination                                  |
| Excessive permissionless `charge()` calls      | Abuse          | H   | L   | Interval + grace checks; fail closed; no auth does not bypass amount rules       |
| Keeper downtime / delayed billing              | Liveness       | M   | M   | Off-chain HA keepers; monitoring; user re-subscribe after grace                  |
| Admin key compromise                           | Access control | L   | H   | Hardware wallet / multisig before mainnet; pause circuit breaker                 |
| Storage TTL expiry / stale temporary proposals | Integrity      | M   | M   | Persistent TTL refresh on lifecycle; temp data treated as non-authoritative      |
| Malicious or buggy upgrade                     | Upgrade        | L   | H   | Explicit migrate; governance of upgrade authority; WASM hash verification        |

### Threat categories for audit deep-dives

1. **Access control** — admin, merchant freeze/whitelist, user auth boundaries
2. **Arithmetic / accounting** — fees, daily limits, global volume, revenue balances
3. **Reentrancy / external calls** — token contract interactions, fail-closed panics
4. **Liveness & operational** — keeper permissionless charge, pause behavior

---

## 4. Audit Scope

### In scope

| Component                  | Path / artifact                               | Notes                                |
| -------------------------- | --------------------------------------------- | ------------------------------------ |
| FlowPay Soroban contract   | `contract/src/**`                             | All public entrypoints and modules   |
| Error taxonomy             | `contract/src/errors.rs`                      | Panic codes and fail-closed behavior |
| Build & tests              | `contract/Cargo.toml`, `contract/src/test.rs` | Unit/integration tests in-repo       |
| Deployed WASM at audit tag | Release build `flow_pay.wasm`                 | Hash must match tag                  |

### Out of scope (unless explicitly added)

| Component                          | Reason                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| Frontend (`frontend/`)             | UX / wallet integration; not on-chain fund custody logic                            |
| Scripts (`scripts/`)               | Operational helpers; not consensus-critical                                         |
| Keeper bots / off-chain schedulers | Liveness dependency; document assumptions but not full code audit unless contracted |
| Third-party SAC / Stellar core     | Platform trust assumptions                                                          |
| Marketing site / docs typos        | Non-security unless they contradict invariants                                      |

### Assumptions auditors may rely on

- Stellar/Soroban consensus and the SAC implementation behave correctly.
- Users understand allowance risks when approving the contract.
- Admin keys are held by trusted operators until governance hardens.

---

## 5. Known Limitations (Intentional Design)

Document these so reviewers do **not** file them as unexpected vulnerabilities without context.

| Behavior                                                         | Why it exists                                                      | Residual risk                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **`charge()` / `batch_charge()` are permissionless**             | Keepers (or anyone) must trigger billing without holding user keys | Spam txs / griefing gas; mitigated by interval checks and fail-closed transfers |
| **Broad admin powers** (pause, freeze, fee, upgrade-related ops) | Early protocol needs emergency control                             | Key compromise impact is high — require HW wallet / multisig for mainnet        |
| **External keeper liveness**                                     | Soroban has no native cron                                         | Missed cycles → grace elapsed → user re-subscribe                               |
| **No on-chain dispute layer**                                    | Product scope                                                      | Failed/delayed charges handled operationally                                    |
| **Single-token-per-deployment default**                          | Simplifies accounting                                              | Multi-token needs separate instances or future design                           |
| **Temporary storage for daily limits / proposals**               | TTL auto-reset / short-lived commits                               | Entries can disappear; code must tolerate absence                               |
| **Upgrade wrapper present**                                      | Allows bugfix evolution                                            | Upgrade authority must be governed carefully                                    |

> Permissionless charge is **by design**: correctness comes from allowance + interval + active-state checks, not from keeper identity. See FAQ in [`README.md`](../../README.md) and [`SECURITY.md`](../SECURITY.md).

---

## 6. Suggested Audit Kickoff Brief

Provide auditors with a short written brief containing:

1. Tag / commit SHA and WASM hash
2. Link to this document + threat matrix
3. Top three concerns you want emphasized (e.g. fee math, pause paths, batch_charge)
4. Timeline and severity triage SLA
5. Disclosure preference (GitHub Security Advisories / email)

---

## 7. After the Audit

- [ ] Triage findings by severity; assign owners
- [ ] Patch in private forks if needed; re-run full `cargo test`
- [ ] Re-audit or delta-review critical fixes
- [ ] Publish report (or summary) before mainnet
- [ ] Update [`SECURITY.md`](../SECURITY.md) status from “not audited” when complete

For mainnet go-live gates after audit, see [`MAINNET-DEPLOYMENT.md`](../MAINNET-DEPLOYMENT.md) (when present) and [`DEPLOYMENT.md`](../DEPLOYMENT.md).
