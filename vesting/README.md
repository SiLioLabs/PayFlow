# Academy Vesting Contract

`academy-vesting` is a separate Soroban workspace crate used for academy reward grants and vesting schedules. It is independent of the recurring billing contract, but can hold and distribute a SAC token grant recorded by a FlowPay deployment or academy integration.

## Relationship to FlowPay

FlowPay manages subscriptions and pay-per-use billing. This crate does not charge subscriptions or access FlowPay storage. An integration may use FlowPay for product billing and use `AcademyVestingContract` for separate, time-based reward allocations.

## Public API

| Function | Authorization | Purpose |
| --- | --- | --- |
| `init(admin, reward_token, governance)` | Unauthenticated one-time initializer; no second initialization | Stores the admin, reward SAC token, and governance address. The `admin` argument is not authenticated by `init`; deployment must ensure initialization is performed with trusted values before the contract is used. |
| `grant_vesting(admin, beneficiary, amount, start_time, cliff, duration)` | Stored admin | Creates a vesting grant and returns its grant ID. |
| `claim(grant_id, beneficiary)` | Beneficiary | Claims the amount vested at claim time and transfers it from the contract. A grant can be claimed only once, so claiming before full vesting forfeits access to the later-vesting remainder. |
| `revoke(grant_id, admin, revoke_delay)` | Stored admin | Revokes an unclaimed grant after the grant's revoke delay. The minimum delay is 3600 seconds. |
| `get_vesting(grant_id)` | None | Returns the stored vesting schedule. |
| `get_vested_amount(grant_id)` | None | Returns the amount vested at the current ledger timestamp. |
| `get_info()` | None | Returns `(admin, reward_token, governance)`. |

The vesting schedule stores `beneficiary`, `amount`, `start_time`, `cliff`, `duration`, `claimed`, `revoked`, and `revoke_time`. Grants are indexed by grant ID in persistent storage under `sched`; initialization values use `init`, `admin`, `token`, `gov`, and `cnt`.

Vesting starts at `start_time`. No amount is available before the cliff; after the cliff, the vested amount is linear until `duration`; the full amount becomes available at or after `duration`.

All configuration and grant records use persistent storage. The contract does not use instance storage or maintain storage TTLs for this crate. `get_vesting` and `get_vested_amount` are read-only; `claim` transfers the SAC reward token from the vesting contract to the authenticated beneficiary.

The contract emits `grant`, `cred_iss`, `claim`, `v_claimed`, and `revoke` events. The alias events (`cred_iss` and `v_claimed`) provide indexer-compatible representations of grant and claim activity.

### Error codes

| Code | Meaning |
| --- | --- |
| `4001` | Unauthorized |
| `4002` | Nothing is vested yet |
| `4003` | Grant already claimed |
| `4004` | Invalid schedule |
| `4005` | Insufficient reward-token balance |
| `4006` | Grant not found |
| `4007` | Grant revoked |
| `4008` | Invalid revoke timelock |
| `4009` | Not enough time has elapsed to revoke |

## Build and test

From the repository root:

```bash
npm run backend:vesting:typecheck
npm run backend:vesting:test
```

Or directly from the crate:

```bash
cd vesting
cargo check
cargo test
cargo build --release --target wasm32-unknown-unknown
```

The release WASM is written to `vesting/target/wasm32-unknown-unknown/release/academy_vesting.wasm`.
