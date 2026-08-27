# Two-Step Admin Operator Playbooks

Step-by-step runbooks for **contract WASM upgrade** and **protocol fee rotation** ceremonies. These flows use temporary storage with a **17,280-ledger TTL** (~24 hours at ~5 s/ledger). If step 2 is not submitted before the TTL expires, the pending proposal disappears and `commit_*` panics with `NoPendingProposal` (23).

For security rationale and state diagrams, see [`architecture/two-step-auth.md`](../architecture/two-step-auth.md). Implementation references: [`contract/src/upgrade.rs`](../../contract/src/upgrade.rs), [`contract/src/fee.rs`](../../contract/src/fee.rs), [`scripts/soroban-admin.ts`](../../scripts/soroban-admin.ts), [`scripts/rotate-fee-collector.ts`](../../scripts/rotate-fee-collector.ts), [`scripts/pre-upgrade-check.ts`](../../scripts/pre-upgrade-check.ts).

---

## Timing budget

| Constant | Value | Wall-clock estimate |
| --- | --- | --- |
| `PENDING_UPGRADE_TTL_LEDGERS` | 17,280 | ~24 h |
| `PendingFee` TTL (same on every `propose_fee`) | 17,280 | ~24 h |

**Operator rule:** complete propose → verify → commit within **one working day**. Budget time as:

| Phase | Suggested budget | Notes |
| --- | --- | --- |
| Pre-flight reads | 15 min | `get_fee`, `get_pending_upgrade`, `contract_health_check`, `pre-upgrade-check` |
| Step 1 (propose) | 5 min | Admin signature; emits `fee_proposed` or `upg_proposed` |
| Independent verification | 1–4 h | Reproducible WASM build / hash compare; fee bounds review |
| Step 2 (commit) | 5 min | Admin signature; irreversible for upgrade |
| Post-commit verification | 15 min | Re-read committed state; optional `migrate()` after upgrade |

If verification cannot finish before ~20 h after propose, **do not commit** — either abort (see below) or re-propose to refresh the TTL.

---

## Shared verification commands

Set once per session (Testnet example):

```bash
export CONTRACT_ID="<CONTRACT_ID>"
export NETWORK="testnet"   # or mainnet
export ADMIN_KEY="admin"   # soroban identity name
```

| Check | Command | Healthy signal |
| --- | --- | --- |
| Protocol fee (committed) | `soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_fee` | Expected `(collector, bps)` or `null` if unset |
| Pending WASM hash | `soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_pending_upgrade` | Matches intended hash before commit; `null` when none |
| Fee bounds (Mainnet) | `soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_fee_bounds` | Pending bps must fit `[min, max]` at commit |
| Contract health | `soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- contract_health_check` | `is_healthy: true` before/after ceremony |
| Pre-upgrade script | `cd scripts && CONTRACT_ID="$CONTRACT_ID" npm run pre-upgrade-check` | Schema version and active count reviewed |

TypeScript helpers (`scripts/soroban-admin.ts`) expose `readContractValue`, `invokeContract`, and `simulateRead` for the same reads when you prefer SDK simulation over CLI.

---

## Playbook A — Contract WASM upgrade

### When to use

Replacing production WASM via `propose_upgrade` / `commit_upgrade` (not the test-only single-step `upgrade`).

### Pre-flight (required)

1. Run [`scripts/pre-upgrade-check.ts`](../../scripts/pre-upgrade-check.ts) and record `get_schema_version`, `get_active_count`, and admin address.
2. **Pause keepers** or expect charge failures during the swap window ([`KEEPER.md`](../KEEPER.md)).
3. Build release WASM locally; record SHA256 hash. It must match the hash passed to `propose_upgrade`.
4. Optional: `contract_health_check` — confirm `is_healthy` and note `schema_version`.

### Step 1 — Propose

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- propose_upgrade --new_wasm_hash <WASM_HASH_HEX>
```

**Verify immediately:**

```bash
soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_pending_upgrade
# Expected: Some(<WASM_HASH_HEX>)
```

Watch for `upg_proposed` in your indexer or `scripts/watch-events.ts`.

### Step 2 — Independent verification (do not skip)

- Rebuild WASM from the tagged release commit; compare hash to `get_pending_upgrade`.
- Re-run `npm run pre-upgrade-check` if subscriber count or schema changed since step 1.
- Confirm no unintended admin proposals are pending.

### Step 3 — Commit

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- commit_upgrade
```

**Post-commit verification:**

```bash
soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_pending_upgrade
# Expected: null

soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- contract_health_check
# Expected: is_healthy true (unless intentionally paused)

soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_schema_version
# If layout changed: run migrate() once (admin), then re-check version == CURRENT_VERSION (3)
```

Restart keepers; drain any DLQ per [`keeper_runbook.md`](keeper_runbook.md).

### Abort / cancel paths (upgrade)

| Situation | Action |
| --- | --- |
| Wrong hash proposed | `cancel_pending_upgrade()` (admin) — clears pending without swapping WASM |
| Verification failed | Do **not** call `commit_upgrade`; use `cancel_pending_upgrade()` or wait for TTL expiry |
| TTL expired | `get_pending_upgrade` returns `null`; `commit_upgrade` → `NoPendingProposal`. Re-run step 1 |
| Emergency | Admin: `pause_contract()` → investigate → `cancel_pending_upgrade()` or commit fix → `unpause_contract()` |

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- cancel_pending_upgrade
```

---

## Playbook B — Fee collector rotation (preserve BPS)

Rotates the protocol fee **collector** while keeping the current basis points. Uses `propose_fee` / `commit_fee` ([`fee.rs`](../../contract/src/fee.rs)). The helper script [`scripts/rotate-fee-collector.ts`](../../scripts/rotate-fee-collector.ts) wraps the same flow: read `get_fee`, propose with existing `fee_bps`, commit, verify `get_fee`.

### Pre-flight

```bash
soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_fee
soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_fee_bounds
```

Record current `(collector, bps)`. Confirm new collector ≠ contract address and pending bps will satisfy bounds at commit.

### Step 1 — Propose

```bash
CURRENT_BPS=250   # from get_fee

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- propose_fee --collector <NEW_COLLECTOR> --bps "$CURRENT_BPS"
```

There is no `get_pending_fee` view; confirm via `fee_proposed` event or proceed promptly to commit after manual review.

### Step 2 — Commit

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- commit_fee
```

**Verify:**

```bash
soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_fee
# Expected: (NEW_COLLECTOR, CURRENT_BPS)
```

Or use the script:

```bash
cd scripts
cp .env.example .env   # set CONTRACT_ID, ADMIN_SECRET_KEY, RPC_URL
tsx rotate-fee-collector.ts --new-collector <NEW_COLLECTOR>
```

### Abort / cancel paths (fee)

| Situation | Action |
| --- | --- |
| Wrong collector or bps proposed | Call `propose_fee` again with corrected values (overwrites `PendingFee` and **resets TTL** to 17,280 ledgers) |
| Decided not to change | Wait for TTL expiry (~24 h) — committed `get_fee` unchanged; `commit_fee` after expiry fails with `NoPendingProposal` |
| Bounds tightened after propose | `commit_fee` → `FeeOutOfBoundsAtCommit` (35). Re-propose with in-range bps or adjust bounds (admin) |
| Emergency stop | Do not call `commit_fee`; overwrite or let TTL expire. No dedicated `cancel_pending_fee` entrypoint |

---

## Keeper coordination

During upgrade ceremonies, keepers should be **stopped or paused** before `commit_upgrade` and restarted only after `contract_health_check` and optional `migrate()` succeed. Fee rotation does not require a keeper halt unless you also change BPS during high traffic (charges use live fee config at commit time).

See [`KEEPER.md`](../KEEPER.md) and [`MAINNET-DEPLOYMENT.md`](../MAINNET-DEPLOYMENT.md#rollback--upgrade).

---

## Related

- [`architecture/two-step-auth.md`](../architecture/two-step-auth.md) — pattern reference
- [`API.md`](../API.md) — `propose_upgrade`, `commit_upgrade`, `get_pending_upgrade`, `propose_fee`, `commit_fee`, `get_fee`
- [`ERROR-CODES.md`](../ERROR-CODES.md) — `NoPendingProposal` (23), `FeeOutOfBoundsAtCommit` (35)
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — Testnet deploy and migration
- [`MAINNET-DEPLOYMENT.md`](../MAINNET-DEPLOYMENT.md) — Mainnet gates and rollback
