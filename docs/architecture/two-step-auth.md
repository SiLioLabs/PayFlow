# Two-Step Authorization Flows

PayFlow gates its most consequential admin operations — reassigning the admin, changing the protocol fee, changing the contract-wide grace period, and upgrading the contract's WASM — behind a two-step commit pattern instead of a single call. This document explains why that pattern exists, walks through all four flows with state diagrams, and covers what happens when a step is called out of order.

For the individual function signatures and CLI examples, see [API.md](../API.md) (linked from each flow below). For the broader module layout, see [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Table of Contents

- [Why Two-Step?](#why-two-step)
- [Two Variants of the Pattern](#two-variants-of-the-pattern)
- [Admin Transfer](#admin-transfer)
- [Protocol Fee](#protocol-fee)
- [Grace Period](#grace-period)
- [Contract Upgrade](#contract-upgrade)
- [Storage and Expiry Reference](#storage-and-expiry-reference)
- [Troubleshooting](#troubleshooting)

---

## Why Two-Step?

A single-step admin call is one signed transaction away from an irreversible, contract-wide mistake:

- **Fat-fingered input.** `set_fee(bps: 10000)` typed instead of `set_fee(bps: 100)` would instantly start taking 100% of every charge, with no chance to catch the typo before it affects a live subscriber.
- **Wrong address.** Transferring admin to a mistyped or unreachable address in one step would permanently lock the contract out of any admin action — there'd be no admin left who could undo it.
- **Compromised key, single window.** If an admin key is compromised, a single-step design lets one signed transaction do irreversible damage (drain fees to an attacker address, "upgrade" to malicious WASM) with no opportunity for anyone to notice and react in between.

Splitting each of these into a **propose** step (records the intent, changes nothing observable) and a separate **commit** (or **accept**) step (actually applies it) buys two things: a window — however short in practice — between intent and effect where the proposal is visible on-chain (via the `*_proposed` event) before it takes hold, and a requirement that the same authority (or, for admin transfer, a _different_ authority) deliberately issue a second transaction. Neither step alone can complete the change.

This does **not** make these operations timelocked in the sense of a mandatory delay — nothing stops an admin from calling `propose_fee` and `commit_fee` back to back in the same block. The protection is procedural (two distinct signed calls, one of which reveals intent via an event before the other executes), not a built-in cooldown.

---

## Two Variants of the Pattern

PayFlow actually implements two different flavors of "two-step," and it's worth telling them apart:

### Propose → Commit (same authority)

Used by **fee**, **grace period**, and **upgrade**. The admin calls `propose_*`, then the _same_ admin later calls `commit_*`. This protects against fat-fingering and gives observers (anyone watching events) a chance to flag a bad proposal before it's committed — but it does **not** protect against a single compromised admin key, since that one key can perform both steps.

```text
   admin                              admin
     │                                  │
     │ propose_X(new_value)             │ commit_X()
     ▼                                  ▼
┌─────────┐   PendingX = new_value  ┌─────────┐   X = new_value
│  (none)  │ ───────────────────▶  │ Pending  │ ───────────────▶  │ Committed │
└─────────┘                        └─────────┘                    └───────────┘
```

### Propose → Accept (different authority)

Used only by **admin transfer**. The _current_ admin calls `transfer_admin`, but the _new_ admin — a different key entirely — must call `accept_admin` to complete the change. This is the stronger protection: it guarantees the new admin address is actually controlled by someone who can sign for it, and a compromised current-admin key alone cannot complete a transfer to an address the attacker doesn't control.

```text
 current admin                      proposed new admin
      │                                    │
      │ transfer_admin(new_admin)          │ accept_admin()
      ▼                                    ▼
 ┌─────────┐  PendingAdmin = new_admin  ┌─────────┐   Admin = new_admin
 │ (admin)  │ ─────────────────────────▶│ Pending  │ ─────────────────▶ │ (new_admin is admin) │
 └─────────┘                            └─────────┘
```

---

## Admin Transfer

**Functions:** [`transfer_admin`](../API.md#transfer_admin) (step 1) / [`accept_admin`](../API.md#accept_admin) (step 2)
**Storage key:** `DataKey::PendingAdmin` — **instance** storage (persists until accepted or overwritten by a new `transfer_admin` call; not subject to the ~24h temporary-storage expiry described below)

```rust
// admin.rs
pub fn transfer_admin(env: &Env, new_admin: &Address) {
    let current_admin = get_admin(env);
    current_admin.require_auth();
    env.storage().instance().set(&DataKey::PendingAdmin, new_admin);
}

pub fn accept_admin(env: &Env) {
    let pending: Address = env.storage().instance().get(&DataKey::PendingAdmin)
        .expect("no pending admin");
    pending.require_auth();
    let old_admin = get_admin(env);
    set_admin(env, &pending);
    env.storage().instance().remove(&DataKey::PendingAdmin);
    events::publish_admin_transferred(env, &old_admin, &pending);
}
```

**State diagram:**

```text
┌──────────────┐  transfer_admin(new)   ┌───────────────────┐  accept_admin()   ┌────────────────┐
│ admin = A     │ ───────────────────▶ │ PendingAdmin = new  │ ─────────────────▶ │ admin = new     │
│ (no pending)  │  auth: A              │ admin = A (unchanged)│  auth: new         │ PendingAdmin unset│
└──────────────┘                        └───────────────────┘                     └────────────────┘
```

- **Step 1 auth:** the _current_ admin (`current_admin.require_auth()`).
- **Step 2 auth:** the _proposed_ admin (`pending.require_auth()`) — `A` (the old admin) cannot call `accept_admin` on `new`'s behalf, and `new` cannot self-nominate by calling `transfer_admin`.
- Until `accept_admin` is called, `A` remains the fully-functional admin — `PendingAdmin` being set does not restrict what `A` can still do.
- Emits `admin_transferred(old_admin, new_admin)` only on successful completion of step 2.

```bash
# Step 1 — current admin proposes
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- \
  transfer_admin --new_admin <NEW_ADMIN_ADDRESS>

# Step 2 — proposed admin accepts, becoming the active admin
soroban contract invoke --id <CONTRACT_ID> --source <NEW_ADMIN_KEY> --network testnet -- \
  accept_admin
```

---

## Protocol Fee

**Functions:** [`propose_fee`](../API.md#propose_fee) (step 1) / [`commit_fee`](../API.md#commit_fee) (step 2)
**Storage key:** `DataKey::PendingFee` — **temporary** storage, TTL extended to 17,280 ledgers (~1 day at 5s/ledger) on every `propose_fee` call

```rust
// fee.rs
pub fn propose_fee(env: &Env, collector: Address, bps: u32) {
    if bps > 10_000 { env.panic_with_error(ContractError::InvalidFeeBps); }
    if collector == env.current_contract_address() { env.panic_with_error(ContractError::InvalidFeeCollector); }
    env.storage().temporary().set(&DataKey::PendingFee, &(collector.clone(), bps));
    env.storage().temporary().extend_ttl(&DataKey::PendingFee, 17280, 17280);
    events::publish_fee_proposed(env, &collector, bps);
}

pub fn commit_fee(env: &Env) {
    let pending: (Address, u32) = env.storage().temporary().get(&DataKey::PendingFee)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoPendingProposal));
    env.storage().temporary().remove(&DataKey::PendingFee);
    env.storage().instance().set(&DataKey::FeeCollector, &pending.0);
    env.storage().instance().set(&DataKey::FeeBps, &pending.1);
    events::publish_fee_committed(env, &pending.0, pending.1);
}
```

**State diagram:**

```text
┌───────────────┐  propose_fee(collector, bps)   ┌────────────────────────┐  commit_fee()   ┌──────────────────┐
│ FeeBps = old   │ ─────────────────────────────▶ │ PendingFee = (c, bps)    │ ───────────────▶ │ FeeBps = bps       │
│ (no pending)   │  validates bps <= 10000,        │ FeeBps still = old       │                   │ FeeCollector = c    │
│                │  collector != self               │ TTL: 17280 ledgers (~1d) │                   │ PendingFee cleared  │
└───────────────┘                                  └────────────────────────┘                   └──────────────────┘
```

**⚠️ Auth gap worth flagging:** `propose_fee`/`commit_fee`'s doc comments in `lib.rs` say "Only the contract admin can call this," and [API.md](../API.md#propose_fee) documents `Auth: admin only` accordingly — but unlike `propose_grace_period`/`commit_grace_period` and `propose_upgrade`/`commit_upgrade` (both of which call `admin::require_admin(env)` explicitly), the current `fee.rs::propose_fee` and `fee.rs::commit_fee` implementations call neither `require_admin` nor `require_auth` on any address. As written, any account can currently call `propose_fee` and `commit_fee` — there is no on-chain enforcement of the "admin only" intent for this specific flow. This is a discrepancy between documented and actual behavior, not a design choice described anywhere else in the codebase; treat `propose_fee`/`commit_fee` as unauthenticated until this is fixed, and verify against `contract/src/fee.rs` directly rather than relying on the doc comment.

```bash
# Step 1 — propose new fee settings
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- \
  propose_fee --collector <COLLECTOR_ADDRESS> --bps 250

# Step 2 — commit the pending proposal
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- \
  commit_fee
```

---

## Grace Period

**Functions:** [`propose_grace_period`](../API.md#propose_grace_period) (step 1) / [`commit_grace_period`](../API.md#commit_grace_period) (step 2)
**Storage key:** `DataKey::PendingGracePeriod` — **temporary** storage, TTL extended to 17,280 ledgers (~1 day) on every propose

```rust
// grace.rs
pub fn propose_grace_period(env: &Env, seconds: u64) {
    assert!(seconds <= u64::MAX / 2, "grace period too large");
    crate::admin::require_admin(env);
    env.storage().temporary().set(&DataKey::PendingGracePeriod, &seconds);
    env.storage().temporary().extend_ttl(&DataKey::PendingGracePeriod, 17280, 17280);
    events::publish_grace_period_proposed(env, seconds);
}

pub fn commit_grace_period(env: &Env) {
    crate::admin::require_admin(env);
    let seconds: u64 = env.storage().temporary().get(&DataKey::PendingGracePeriod)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoPendingProposal));
    env.storage().temporary().remove(&DataKey::PendingGracePeriod);
    env.storage().instance().set(&DataKey::GracePeriod, &seconds);
    events::publish_grace_period_committed(env, seconds);
}
```

**State diagram:**

```text
┌────────────────────┐  propose_grace_period(s)   ┌───────────────────────────┐  commit_grace_period()   ┌────────────────────┐
│ GracePeriod = old    │ ─────────────────────────▶│ PendingGracePeriod = s      │ ────────────────────────▶ │ GracePeriod = s      │
│ (no pending)         │  auth: admin                │ GracePeriod still = old      │  auth: admin              │ PendingGracePeriod    │
│                      │                             │ TTL: 17280 ledgers (~1d)     │                            │  cleared              │
└────────────────────┘                              └───────────────────────────┘                            └────────────────────┘
```

Both `propose_grace_period` and `commit_grace_period` call `admin::require_admin(env)`, which internally does `get_admin(env).require_auth()` — this flow _is_ fully admin-gated on both steps, unlike protocol fee above. Applying a new grace period is **not retroactive**: `charge()` reads the live `GracePeriod` value at the moment it's called, so committing a change affects every subscriber's very next charge attempt, not just ones that subscribe afterward (see [SUBSCRIBER-LIFECYCLE.md § Grace Period, In Depth](../SUBSCRIBER-LIFECYCLE.md#grace-period-in-depth)).

```bash
# Step 1 — propose a new grace period (in seconds)
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- \
  propose_grace_period --seconds 86400

# Step 2 — commit it
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- \
  commit_grace_period
```

---

## Contract Upgrade

**Functions:** [`propose_upgrade`](../API.md#propose_upgrade) (step 1) / [`commit_upgrade`](../API.md#commit_upgrade) (step 2)
**Storage key:** `DataKey::PendingUpgrade` — **temporary** storage, TTL extended to 17,280 ledgers (~1 day) on every propose

```rust
// upgrade.rs
pub fn propose_upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
    admin::require_admin(env);
    env.storage().temporary().set(&DataKey::PendingUpgrade, &new_wasm_hash);
    env.storage().temporary().extend_ttl(&DataKey::PendingUpgrade, 17280, 17280);
    events::publish_upgrade_proposed(env, &new_wasm_hash);
}

pub fn commit_upgrade(env: &Env) {
    admin::require_admin(env);
    let pending_hash: BytesN<32> = env.storage().temporary().get(&DataKey::PendingUpgrade)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoPendingProposal));
    env.storage().temporary().remove(&DataKey::PendingUpgrade);
    env.deployer().update_current_contract_wasm(pending_hash.clone());
    events::publish_upgraded(env, &pending_hash);
}
```

**State diagram:**

```text
┌────────────────────┐  propose_upgrade(hash)   ┌───────────────────────┐  commit_upgrade()   ┌───────────────────────┐
│ wasm = current        │ ───────────────────────▶│ PendingUpgrade = hash    │ ────────────────────▶ │ wasm = hash               │
│ (no pending)          │  auth: admin              │ wasm still = current     │  auth: admin           │ deployer swaps live WASM  │
│                        │                           │ TTL: 17280 ledgers (~1d) │                         │ PendingUpgrade cleared    │
└────────────────────┘                             └───────────────────────┘                         └───────────────────────┘
```

This is the highest-stakes flow in the contract: `commit_upgrade` replaces the contract's executable code entirely via `env.deployer().update_current_contract_wasm()`. Both steps require admin auth. Because the proposal is visible on-chain via the `upg_proposed` event as soon as `propose_upgrade` runs, and the pending hash is queryable, a ~24h temporary-storage window exists during which the exact WASM hash being proposed can be independently verified (e.g., reproducibly built and hash-compared) before anyone commits it — this is the primary practical benefit of splitting upgrade into two steps rather than making it instant.

```bash
# Step 1 — propose the new WASM hash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- \
  propose_upgrade --new_wasm_hash <WASM_HASH>

# Step 2 — commit, swapping the live contract code
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet -- \
  commit_upgrade
```

---

## Storage and Expiry Reference

| Flow             | Pending key          | Storage type | Expires without commit?                                                    | Step 1 auth                      | Step 2 auth                      |
| ---------------- | -------------------- | ------------ | -------------------------------------------------------------------------- | -------------------------------- | -------------------------------- |
| Admin transfer   | `PendingAdmin`       | instance     | No — persists until accepted or overwritten by a new `transfer_admin` call | current admin                    | proposed (new) admin             |
| Protocol fee     | `PendingFee`         | temporary    | Yes — ~17,280 ledgers (~1 day) after the last `propose_fee` call           | _(undocumented gap — see above)_ | _(undocumented gap — see above)_ |
| Grace period     | `PendingGracePeriod` | temporary    | Yes — ~17,280 ledgers (~1 day) after the last `propose_grace_period` call  | admin                            | admin                            |
| Contract upgrade | `PendingUpgrade`     | temporary    | Yes — ~17,280 ledgers (~1 day) after the last `propose_upgrade` call       | admin                            | admin                            |

Soroban's temporary storage entries become inaccessible once their TTL lapses — the entry isn't explicitly deleted by any PayFlow code, it simply stops existing from the contract's point of view, and a subsequent `commit_*` call reads it as absent and panics with `ContractError::NoPendingProposal`, identical to never having called `propose_*` at all.

---

## Operator playbooks

For timed step-by-step ceremonies (TTL budgets, verification reads such as `get_pending_upgrade` and `get_fee`, abort/cancel paths, and keeper coordination), see [`operations/two_step_admin_playbooks.md`](../operations/two_step_admin_playbooks.md).

---

## Troubleshooting

### "I called commit before propose"

Every `commit_*` function reads its pending key with `.unwrap_or_else(|| env.panic_with_error(ContractError::NoPendingProposal))`, so calling `commit_fee`, `commit_grace_period`, or `commit_upgrade` with no prior (or expired) proposal panics with `ContractError::NoPendingProposal`.

`accept_admin` is the one exception: it has no corresponding `ContractError` variant and instead panics with the plain Rust message `"no pending admin"` (`.expect("no pending admin")` in `admin.rs`), since admin transfer predates the numbered-error-code convention used elsewhere.

### "How do I cancel a pending proposal?"

There is no dedicated `cancel_*` entry point for any of the four flows. In practice:

- **Fee, grace period, upgrade:** call `propose_*` again with a different value to overwrite the pending one (the temporary-storage entry is simply replaced), or just do nothing — the proposal auto-expires after ~17,280 ledgers (~1 day) and a subsequent `commit_*` will fail with `NoPendingProposal` as if it were never proposed.
- **Admin transfer:** the current admin can call `transfer_admin` again — either pointing at a different address, or at themselves — to overwrite `PendingAdmin`. Because this key lives in instance storage with no expiry, this is the _only_ way to clear a stale or mistaken admin proposal; it will not time out on its own.

### "My proposal seems to have disappeared"

If more than ~24 hours (17,280 ledgers) passed between `propose_fee`/`propose_grace_period`/`propose_upgrade` and the matching commit call, the temporary-storage entry has expired. Re-run the `propose_*` step and commit again promptly. This does not apply to admin transfer, which has no expiry.

### "commit_fee succeeded but I'm not the admin"

See [Protocol Fee](#protocol-fee) above — as of this writing, `propose_fee`/`commit_fee` do not enforce `require_admin` in the running contract, despite their doc comments and [API.md](../API.md#propose_fee) stating "admin only." Do not rely on this flow being permissioned until the implementation is aligned with its documentation.
