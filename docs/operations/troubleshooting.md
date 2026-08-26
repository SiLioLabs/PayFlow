# Troubleshooting Runbook

Common ChargeResult errors, wallet failures, and operational issues with diagnosis steps and resolutions.

For full error code documentation, see [`docs/ERROR-CODES.md`](../ERROR-CODES.md). For merchant-specific issues, see [`docs/MERCHANT-INTEGRATION.md`](../MERCHANT-INTEGRATION.md).

---

## Table of Contents

1. [Allowance Problems](#1-allowance-problems)
2. [Grace Period Issues](#2-grace-period-issues)
3. [Merchant Pause](#3-merchant-pause)
4. [Contract Pause](#4-contract-pause)
5. [Wrong Network](#5-wrong-network)
6. [Empty CONTRACT_ID](#6-empty-contract_id)
7. [RPC Failures](#7-rpc-failures)
8. [Wallet / ChargeResult Frontend Errors](#8-wallet--chargeresult-frontend-errors)

---

## 1. Allowance Problems

### Symptoms

- `charge()` or `batch_charge()` returns `ChargeResult::Skipped` or panics with `InsufficientAllowance` (code 8).
- `subscribe()` fails with a token transfer error.
- Frontend shows "Token Allowance Failed" or similar.

### Likely cause

The subscriber's SAC (Stellar Asset Contract) allowance for the PayFlow contract has been spent down or revoked. Allowances are consumed with each charge; if the subscriber approved only one cycle's worth, the second charge will fail.

### Diagnosis steps

1. Query the on-chain allowance for the subscriber:

```bash
soroban contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --network testnet \
  -- allowance \
  --owner <USER_ADDRESS> \
  --spender <CONTRACT_ID>
```

2. Compare against the subscription amount. If `allowance < subscription_amount`, the next charge will fail.

3. Use the repository's monitoring script:

```bash
cd scripts
npm install
npx tsx check-allowances.ts
```

This scans active subscriptions and reports which users have insufficient allowances.

### Resolution steps

1. Have the subscriber approve a new allowance (ideally 6+ cycles' worth):

```bash
soroban contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- approve \
  --from <USER_ADDRESS> \
  --spender <CONTRACT_ID> \
  --amount <AMOUNT> \
  --expiry 6307200
```

2. The frontend `IncreaseAllowanceModal` component handles this automatically when the user clicks "Increase Allowance."

3. After approval, the next keeper cycle will charge successfully.

### Prevention

- Prompt users to approve a buffer (e.g., 6 billing cycles) at subscribe time.
- Monitor allowances with `scripts/check-allowances.ts` and alert before they expire.
- Display low-allowance warnings in the subscriber dashboard.

---

## 2. Grace Period Issues

### Symptoms

- `charge()` panics with `GracePeriodElapsed` (code 9).
- `batch_charge()` returns `ChargeResult::GracePeriodElapsed`.
- Subscription appears active but cannot be charged.

### Likely cause

The keeper missed the billing window. After `last_charged + interval`, the contract opens a grace period (configured by admin). If the grace period elapses before the keeper calls `charge()`, the subscription is treated as lapsed and the user must re-subscribe.

### Diagnosis steps

1. Read the subscription state:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_subscription \
  --user <USER_ADDRESS>
```

2. Check the configured grace period:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_grace_period
```

3. Compute: `next_charge_at = last_charged + interval`. If `now > next_charge_at + grace_period`, the window has closed.

4. Use the monitoring script:

```bash
cd scripts
npx tsx grace-period-monitor.ts
```

### Resolution steps

1. If the grace window is still open, charge immediately:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER_KEY> \
  --network testnet \
  -- charge \
  --user <USER_ADDRESS>
```

2. If the grace window has closed, the subscriber must re-subscribe. There is no way to recover a lapsed subscription.

3. For batch scenarios, `batch_charge()` returns `GracePeriodElapsed` for that user but continues processing others — no need to abort the batch.

### Prevention

- Run keepers more frequently than the shortest subscription interval.
- Monitor `grace-period-monitor.ts` for users approaching the grace deadline.
- Set up alerts for `GracePeriodElapsed` events (see [`scripts/alert-failed-charges.ts`](../../scripts/alert-failed-charges.ts)).

---

## 3. Merchant Pause

### Symptoms

- `subscribe()` panics with `MerchantFrozen` (code 22).
- `charge()` panics with `SubscriptionPaused` (code 17) for subscriptions to a frozen merchant.
- Frontend shows "This merchant is temporarily unavailable."

### Likely cause

The admin has frozen the merchant (`freeze_merchant`). Frozen merchants cannot accept new subscriptions, and existing subscriptions may be paused.

### Diagnosis steps

1. Check merchant freeze status:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- is_merchant_frozen \
  --merchant <MERCHANT_ADDRESS>
```

2. Check whitelist status:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- is_merchant_whitelisted \
  --merchant <MERCHANT_ADDRESS>
```

### Resolution steps

1. If you are the admin, unfreeze the merchant:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- unfreeze_merchant \
  --merchant <MERCHANT_ADDRESS>
```

2. If you are a subscriber, wait for the merchant to be unfrozen, or contact the merchant directly.

3. Existing subscribers to a frozen merchant may still have active subscriptions that can be charged, but no new subscriptions can be created.

### Prevention

- Announce maintenance windows before freezing merchants.
- Use `MerchantFrozen` events for monitoring.

---

## 4. Contract Pause

### Symptoms

- All operations panic with `ContractPaused` (code 18) or `ContractPausedError` (code 30).
- Frontend shows "Service temporarily unavailable."
- Keepers stop processing charges.

### Likely cause

The admin has activated the circuit breaker (`pause_contract`). This blocks all state-changing operations (subscribe, charge, pay_per_use, withdraw) as an emergency measure.

### Diagnosis steps

1. Check pause status:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- is_contract_paused
```

2. Check for pause expiry (if a timed pause was set):

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_pause_expiry
```

3. Use the health check script:

```bash
cd scripts
npx tsx health-check.ts
```

### Resolution steps

1. Only the admin can unpause the contract:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- unpause_contract
```

2. Keepers should stop cycling immediately and alert the on-call team.

3. After unpause, keepers can resume normal operation.

### Prevention

- Announce maintenance windows.
- Use the keeper incident response pattern from [`docs/operations/keeper_runbook.md`](keeper_runbook.md).
- Set up `ContractPause` event alerts.

---

## 5. Wrong Network

### Symptoms

- `subscribe()` or `charge()` fails with "contract not found" or "account not found."
- Frontend shows no subscription data or RPC errors.
- Wallet prompts for signing on a different network than expected.

### Likely cause

The frontend or CLI is pointing at the wrong network (e.g., testnet RPC but mainnet contract ID, or vice versa). The Stellar network passphrase and RPC URL must match the deployment target.

### Diagnosis steps

1. Check the frontend environment variables:

```bash
cat frontend/.env.local
```

Verify:
- `VITE_RPC_URL` matches the target network (testnet: `https://soroban-testnet.stellar.org`)
- `VITE_NETWORK_PASSPHRASE` matches (testnet: `Test SDF Network ; September 2015`)
- `VITE_CONTRACT_ID` is deployed on that network

2. Check the Freighter wallet network:

- Open Freighter extension → Settings → Network
- Ensure it matches `VITE_NETWORK_PASSPHRASE`

3. Verify the contract exists on the target network:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- is_contract_paused
```

If this returns a value (true or false), the contract is deployed on testnet.

### Resolution steps

1. Update `frontend/.env.local` with the correct values.
2. Ensure the wallet network matches.
3. Reload the frontend.

### Prevention

- Hard-code network passphrase validation in the frontend (`useNetworkCheck` hook).
- Display the active network badge (`NetworkBadge` component) prominently.

---

## 6. Empty CONTRACT_ID

### Symptoms

- Frontend loads but shows no data.
- Console error: "Contract call failed" or similar.
- `useContractId` hook reports `valid: false`.

### Likely cause

The `VITE_CONTRACT_ID` environment variable is empty or not set. The frontend cannot interact with the contract without a valid contract ID.

### Diagnosis steps

1. Check the environment file:

```bash
cat frontend/.env.local
```

2. Verify `VITE_CONTRACT_ID` is set to a valid contract address (starts with `C`):

```
VITE_CONTRACT_ID=CABCDEF1234567890...
```

3. Check if the contract is actually deployed:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- is_contract_paused
```

### Resolution steps

1. Set `VITE_CONTRACT_ID` in `frontend/.env.local` to the deployed contract address.
2. Restart the development server: `npm run dev`.
3. If no contract is deployed, deploy one first (see [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md)).

### Prevention

- Gate frontend startup on a valid contract ID (`useContractId` hook).
- Show a clear setup prompt when contract ID is missing.

---

## 7. RPC Failures

### Symptoms

- Frontend shows "RPC unavailable" or "Service degraded" banners.
- Transactions time out or fail to simulate.
- `useRpcHealth` hook reports `degraded` or `unreachable`.

### Likely cause

The Soroban RPC endpoint is unreachable, rate-limited, or experiencing downtime. This can happen during network congestion or when using a shared public RPC endpoint.

### Diagnosis steps

1. Test RPC reachability directly:

```bash
curl -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}'
```

A successful response returns network info; a failure indicates the endpoint is down.

2. Check the RPC health from the frontend:

```typescript
// The useRpcHealth hook polls the RPC with backoff and circuit breaker.
// After 3 failures, the circuit opens and shows "unreachable."
```

3. Check for rate limiting (HTTP 429 responses).

### Resolution steps

1. **Temporary outage:** Wait and retry. The frontend's circuit breaker will auto-recover when the RPC becomes available.

2. **Rate limiting:** Switch to a dedicated RPC endpoint. Set `VITE_RPC_URL` in `frontend/.env.local`:

```
VITE_RPC_URL=https://your-dedicated-rpc.example.com
```

3. **Persistent failure:** Use a different RPC provider. Popular options:
   - Stellar public RPC: `https://soroban-testnet.stellar.org`
   - Dedicated providers: QuickNode, Alchemy, or self-hosted `stellar-rpc`

4. **Local development:** Run a local Soroban node and point `VITE_RPC_URL` to `http://localhost:8000`.

### Prevention

- Use a dedicated RPC endpoint for production.
- Monitor RPC health with `useRpcHealth` (frontend) or `scripts/health-check.ts`.
- Implement retry logic with exponential backoff in backend integrations.

---

## 8. Wallet / ChargeResult Frontend Errors

### Symptoms

- Wallet connection fails or shows "connect" button indefinitely.
- Transaction signing succeeds but submission fails.
- `ChargeResult` variants appear as raw enum values in the UI.
- Frontend error messages are cryptic or unhelpful.

### Likely cause

Wallet integration issues (Freighter not installed, wrong network, stale session) or contract errors not being mapped to friendly messages.

### Diagnosis steps

1. **Wallet connection:**

   - Check if Freighter is installed: look for `window.freighter` in browser console.
   - Check `useFreighterAvailable` hook output.
   - Verify Freighter is on the correct network.

2. **Transaction signing/submission:**

   - Check browser console for SDK errors.
   - Verify the transaction XDR is well-formed.
   - Check if the RPC is reachable (see [§ 7](#7-rpc-failures)).

3. **ChargeResult errors:**

   The `ChargeResult` enum has 6 variants. Map them as follows:

   | Variant | Meaning | Frontend action |
   |---------|---------|-----------------|
   | `Charged` | Success | Show success toast |
   | `Skipped` | Interval not elapsed | Show "Next charge at..." |
   | `NoSubscription` | No sub found | Prompt to subscribe |
   | `Inactive` | Cancelled | Show "Subscription cancelled" |
   | `Paused` | User-paused | Show "Resume to continue" |
   | `GracePeriodElapsed` | Lapsed | Show "Re-subscribe required" |

4. **Error message mapping:**

   Check `frontend/src/utils/errors.ts` for the `CONTRACT_ERRORS` map and `friendlyError()` function. This maps raw contract error strings to user-friendly messages.

### Resolution steps

1. **Wallet not connecting:**

   - Ensure Freighter extension is installed and enabled.
   - Click the Freighter icon → check connection status.
   - Clear browser storage and reconnect.

2. **Signing fails:**

   - Ensure the wallet is unlocked.
   - Check that the transaction network matches the app network.
   - Try refreshing the page and reconnecting.

3. **Submission fails:**

   - Check RPC status (see [§ 7](#7-rpc-failures)).
   - Verify the contract ID is valid (see [§ 6](#6-empty-contract_id)).
   - Check for simulation errors in the console.

4. **ChargeResult not mapped:**

   - Add the missing error string to `CONTRACT_ERRORS` in `frontend/src/utils/errors.ts`.
   - Use `friendlyError()` in all error display paths.

### Prevention

- Always use `friendlyError()` for user-facing error messages.
- Test wallet flows on testnet before mainnet.
- Handle all `ChargeResult` variants in batch charge UIs.

---

## Related Documentation

| Document | Purpose |
| --- | --- |
| [`docs/ERROR-CODES.md`](../ERROR-CODES.md) | Full error code reference and recovery playbook |
| [`docs/TESTING.md`](../TESTING.md) | Test suite execution and CI |
| [`docs/MERCHANT-INTEGRATION.md`](../MERCHANT-INTEGRATION.md) | Merchant-specific troubleshooting |
| [`docs/KEEPER.md`](../KEEPER.md) | Keeper setup and monitoring |
| [`docs/operations/keeper_runbook.md`](keeper_runbook.md) | Keeper incident response |
| [`docs/INTEGRATION-GUIDE.md`](../INTEGRATION-GUIDE.md) | Integration troubleshooting |
