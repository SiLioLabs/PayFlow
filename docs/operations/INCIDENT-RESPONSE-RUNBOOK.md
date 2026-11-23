# Incident Response Runbook

Use this runbook for suspected exploits, accounting discrepancies, unexpected contract state, or compromised operational credentials. It complements the [keeper runbook](keeper_runbook.md) and [two-step admin playbooks](two_step_admin_playbooks.md).

## Severity and roles

| Severity | Examples | Response target |
| --- | --- | --- |
| SEV-1 | Active loss of funds, unauthorized admin action, exploitable upgrade | Immediate; page incident lead and protocol admin |
| SEV-2 | Accounting discrepancy, isolated merchant abuse, degraded charging | Within 30 minutes; frozen-scope containment |
| SEV-3 | Suspected issue with no confirmed impact | Same day; investigate and document |

Roles:

- **Incident lead:** owns the timeline, communication, and decision record.
- **Protocol admin:** uses the privileged Soroban identities and records every transaction hash.
- **Keeper owner:** pauses keepers and protects operational queues.
- **Merchant/on-call liaison:** validates merchant reports and prepares approved public messages.
- **Independent verifier:** reviews hashes and evidence; should not share admin credentials.

Never share secret keys in tickets, chat, screenshots, or shell history. Use named Stellar identities and a hardware-backed or controlled signer where available.

## First 15 minutes

1. Declare severity and open a timestamped incident record.
2. Stop automated charging: stop the keeper and disable any deployment scheduler.
3. Preserve evidence: ledger height, RPC responses, keeper logs, DLQ entries, event logs, account/merchant addresses, and all transaction hashes.
4. If funds or subscriptions are actively at risk, pause the contract:

```bash
export CONTRACT_ID="<CONTRACT_ID>"
export NETWORK="testnet" # or mainnet
export ADMIN_KEY="admin"

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- pause_contract

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- is_contract_paused
```

Do not unpause until independent verification confirms the cause is contained.

## Containment procedures

### Freeze a merchant

Use only for a confirmed abusive or compromised merchant. Provide a short operator reason when required by the deployment tooling.

```bash
export MERCHANT_ADDRESS="<MERCHANT_ADDRESS>"

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- freeze_merchant \
  --merchant "$MERCHANT_ADDRESS" \
  --reason "<INCIDENT_REASON>"

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- is_merchant_frozen \
  --merchant "$MERCHANT_ADDRESS"
```

If the `reason` argument is unsupported by the installed CLI/contract ABI, use the API-compatible invoke without it and record the reason off-chain. A freeze blocks new subscriptions for that merchant; it does not erase existing subscriptions. Use `unfreeze_merchant` only after the incident lead authorizes recovery.

### Cancel a pending upgrade

Do not commit a proposed WASM hash that is implicated by the incident.

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- get_pending_upgrade

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- cancel_pending_upgrade
```

### Upgrade to a corrective release

A corrective upgrade is a separate, verified maintenance action. Build the exact tagged source, record the SHA-256, and perform the two-step ceremony in [two_step_admin_playbooks.md](two_step_admin_playbooks.md).

```bash
sha256sum contract/target/wasm32-unknown-unknown/release/payflow.wasm

export WASM_HASH_HEX="<SHA256_HEX>"

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- propose_upgrade --new_wasm_hash "$WASM_HASH_HEX"

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- get_pending_upgrade

# After independent verification:
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- commit_upgrade
```

After commit, verify `get_pending_upgrade`, `contract_health_check`, `get_schema_version`, and, if a layout changed, migrate subscriber pages until the version reaches `3` as documented in [the deployment migration procedure](../DEPLOYMENT.md#state-migration).

## Accounting discrepancy

1. Export the affected charge, transfer, fee, and subscription events around the discrepancy.
2. Reconcile against on-chain SAC transfers and stored subscription/fee state.
3. Identify the smallest affected address and merchant scope.
4. Compare keeper submissions with RPC transaction results; do not assume a missing event means no transfer occurred.
5. Pause or freeze only when broader activity is at risk; preserve a read-only evidence snapshot otherwise.
6. Record the discrepancy and resolution in the incident log, including whether affected funds require off-chain reconciliation.

## Recovery and closeout

Before recovery:

- Root cause is documented and no active exploit path remains.
- Corrective WASM, configuration, or merchant state is independently reviewed.
- Testnet reproduction and relevant contract/script tests pass.
- Affected transactions and balances are reconciled.
- Incident lead approves unpause and keeper restart.

Unpause and verify:

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- unpause_contract

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- is_contract_paused

soroban contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- contract_health_check
```

Restart keepers in dry-run or low-rate mode first if practical. Drain the DLQ only after verifying the original failure mode is resolved.

## Post-incident checklist

- [ ] Timeline and affected ledger range recorded
- [ ] Transaction hashes and RPC evidence archived
- [ ] Funds and accounting reconciled
- [ ] Merchant freeze/pause/upgrade actions reversed when safe
- [ ] Keeper and DLQ state verified
- [ ] Testnet reproduction added or existing test extended
- [ ] Root-cause and corrective tasks assigned
- [ ] A follow-up review scheduled
- [ ] Documentation and runbooks updated
- [ ] Severity and disclosure decision recorded

## Communication templates

### Initial containment notice

> We are investigating a service-impacting PayFlow incident. [Briefly state scope and affected operation.] Containment actions are active. Keepers and affected operations are temporarily paused while we verify on-chain state. Next update: [time].

### Progress update

> Incident update: no additional [fund loss/unauthorized state change] has been confirmed as of [timestamp]. We have [actions taken]. The cause is [confirmed/suspected]. Next update: [time].

### Resolution notice

> The PayFlow incident is contained and recovery is complete. [State resolved scope.] We completed [pause/freeze/upgrade/reconciliation]. Normal operations restarted at [timestamp]. No new impact is being observed. A post-incident review will cover [follow-up topics].

### Status service unavailable

> PayFlow contract operations are temporarily restricted while operators investigate [general category]. Read-only status checks remain available. Do not retry duplicate payment or subscription transactions. Operators will publish the next update at [time].
