# PayFlow Integration Guide

This guide is designed for third-party applications (such as SaaS billing dashboards, merchants, and mobile apps) that want to integrate the PayFlow recurring billing and `pay_per_use` microtransaction protocol on the Stellar network.

> **Merchants:** This document focuses on the subscriber path (approve, subscribe, charge). For accepting revenue, monitoring subscribers, handling merchant events, and withdrawing balances, see the **[Merchant Integration Cookbook](./MERCHANT-INTEGRATION.md)**.

---

## 1. Prerequisites

Before writing any integration code, ensure your environment is set up.

### Dependencies

You will need the official Stellar JavaScript/TypeScript SDK:

```bash
npm install @stellar/stellar-sdk
```

### Authentication

Depending on your integration, you will authenticate transactions via:

1. **Client-side (Wallets):** Freighter, Albedo, or xBull.
2. **Server-side (Keepers/Backend):** Raw Stellar keypairs (using `Keypair.fromSecret()`).

---

## 2. Testnet Sandbox Setup

While developing, you should point your application to the Stellar Testnet.

**Testnet Configuration:**

- **RPC URL:** `https://soroban-testnet.stellar.org`
- **Network Passphrase:** `Test SDF Network ; September 2015`

**Funding Test Accounts:**
You can instantly fund testing accounts using Friendbot:

```javascript
const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
```

---

## 3. Connecting to the Contract

To interact with the PayFlow smart contract, instantiate it using the Stellar SDK.

```javascript
import { rpc, Contract, xdr, Keypair, Networks } from "@stellar/stellar-sdk";

// Initialize the RPC server
const server = new rpc.Server("https://soroban-testnet.stellar.org");

// The deployed PayFlow contract ID
const CONTRACT_ID = "C...";
const payFlowContract = new Contract(CONTRACT_ID);
```

---

## 4. Subscribing a User Programmatically

Subscribing requires two steps:

1. **Token Allowance:** The user must approve the PayFlow contract to pull funds.
2. **Subscribe:** The user calls the `subscribe` function on PayFlow.

```javascript
async function subscribeUser(
  userKeypair,
  merchantAddress,
  amountStroops,
  intervalSeconds,
  tokenAddress,
) {
  const source = await server.getAccount(userKeypair.publicKey());

  // 1. Build the Subscribe transaction
  const tx = new TransactionBuilder(source, {
    fee: "1000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      payFlowContract.call(
        "subscribe",
        xdr.ScVal.scvAddress(userKeypair.publicKey()), // user
        xdr.ScVal.scvAddress(merchantAddress), // merchant
        xdr.ScVal.scvI128(
          new xdr.Int128Parts({
            // amount
            hi: xdr.Int64.fromString("0"),
            lo: xdr.Uint64.fromString(amountStroops.toString()),
          }),
        ),
        xdr.ScVal.scvU64(xdr.Uint64.fromString(intervalSeconds.toString())), // interval
        xdr.ScVal.scvAddress(tokenAddress), // token
        xdr.ScVal.scvVoid(), // trial_period (Option<u64> -> None)
        xdr.ScVal.scvVoid(), // referrer (Option<Address> -> None)
      ),
    )
    .setTimeout(30)
    .build();

  // 2. Sign and submit
  tx.sign(userKeypair);

  // Note: Use server.prepareTransaction() in production for correct fee estimation
  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(userKeypair);

  const response = await server.sendTransaction(preparedTx);
  return response;
}
```

---

## 5. Triggering Charges

`charge()` and `batch_charge()` are permissionless. Any backend cron job (a "keeper") can call them. They do not require the user's signature.

```javascript
async function processBatchCharges(keeperKeypair, userAddresses) {
  const source = await server.getAccount(keeperKeypair.publicKey());

  // Build SCVal array of addresses
  const scvUsers = userAddresses.map((addr) => xdr.ScVal.scvAddress(addr));
  const scvVecUsers = xdr.ScVal.scvVec(scvUsers);

  const tx = new TransactionBuilder(source, {
    fee: "1000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(payFlowContract.call("batch_charge", scvVecUsers))
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keeperKeypair);

  return await server.sendTransaction(preparedTx);
}
```

---

## 5b. Pay-Per-Use with Custom Recipient (`pay_per_use_to`)

`pay_per_use_to(user, amount, recipient)` works like `pay_per_use` but routes the net payment to `recipient` instead of the subscription's merchant. This enables scenarios like marketplace settlement, affiliate payouts, or splitting metered revenue.

### When to use `pay_per_use_to`

- The subscriber's subscription is with Merchant A, but the metered charge should go to Merchant B (or a shared treasury).
- A merchant wants fee-recipient-customized routing per microtransaction.

### Auth and validation

Like `pay_per_use`, this call requires authorization from `user`. The contract additionally validates:

1. `recipient` must not be the contract address — panics with `ContractError::InvalidRecipient` (code 32).
2. If the merchant whitelist is enabled, `recipient` must be whitelisted — panics with `ContractError::MerchantNotWhitelisted` (code 10).
3. The user's daily spending limit (shared with `pay_per_use`) is enforced.

> **Note:** `pay_per_use` (without `_to`) does **not** re-validate the whitelist at call time — it trusts the merchant was validated at `subscribe` time. Only the `pay_per_use_to` path re-checks whitelist membership for the custom recipient.

### Fee routing

Fees are calculated against the `recipient`, not the original merchant:

1. The contract checks for a **per-recipient custom fee recipient** via `get_merchant_fee_recipient(recipient)`.
2. If none is set, it falls back to the **global fee collector** (`get_fee_collector()`).
3. If no fee collector is set or fee BPS is 0, no fee is deducted.

```text
Subscriber token balance
        │
        ├─ fee ──► Fee collector (or recipient's custom fee recipient)
        │
        └─ net ──► recipient
                     │
                     └─ MerchantRevenue(recipient) += net
```

### Example (TypeScript)

```typescript
async function payPerUseToRecipient(
  userKeypair,
  recipientAddress,
  amountStroops,
  tokenAddress,
) {
  const source = await server.getAccount(userKeypair.publicKey());

  const tx = new TransactionBuilder(source, {
    fee: "1000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      payFlowContract.call(
        "pay_per_use_to",
        xdr.ScVal.scvAddress(userKeypair.publicKey()), // user
        xdr.ScVal.scvI128(
          new xdr.Int128Parts({
            hi: xdr.Int64.fromString("0"),
            lo: xdr.Uint64.fromString(amountStroops.toString()),
          }),
        ), // amount
        xdr.ScVal.scvAddress(recipientAddress), // recipient
      ),
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(userKeypair);
  return await server.sendTransaction(preparedTx);
}
```

### Events

The `pay_per_use` event is emitted with `recipient` in place of the subscription merchant. See [EVENTS.md — `pay_per_use`](EVENTS.md#pay_per_use).

### Error reference

| Error                    | Code | When                                              |
| ------------------------ | ---- | ------------------------------------------------- |
| `InvalidRecipient`       | 32   | `recipient` is the contract address               |
| `MerchantNotWhitelisted` | 10   | Whitelist enabled and `recipient` not whitelisted |
| `SubscriptionPaused`     | 17   | User's subscription is paused                     |
| `SubscriptionInactive`   | 5    | User's subscription is cancelled                  |
| `DailyLimitExceeded`     | 25   | Pay-per-use would exceed daily spending cap       |

For full error details, see [ERROR-CODES.md](ERROR-CODES.md).

---

## 6. Listening for Events

PayFlow emits structured events that you can poll using the Soroban RPC `getEvents` endpoint to index subscriber history, charge confirmations, and pauses.

```javascript
async function listenForCharges() {
  const response = await server.getEvents({
    startLedger: 1000000,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
        topics: [[xdr.ScVal.scvSymbol("charged").toXDR("base64")]],
      },
    ],
  });

  response.events.forEach((event) => {
    console.log(`Charge processed at ledger: ${event.ledger}`);
    // Decode event.value here to get amount, merchant, and timestamp
  });
}
```

---

## 7. Referral Attribution

Pass an optional `referrer` Stellar address as the last argument to `subscribe` (instead of `xdr.ScVal.scvVoid()`) to record on-chain attribution. Referral **codes and links** are resolved off-chain to that address before the call. FlowPay does not pay referrers automatically — use `referred` / `charged` events plus `get_referrer` for commissions.

Full architecture, payout models, link workflows, CLI examples, and TypeScript snippets: **[REFERRALS.md](./REFERRALS.md)**.

---

## 8. Error Handling

When calling the contract, the RPC may return specific execution errors if validations fail. You must handle these gracefully in your application.

Common errors you should catch:

- `"amount must be positive"` / `"interval must be positive"`: Ensure you are passing non-zero values.
- `"no subscription found"`: The user has not subscribed or the subscription was canceled.
- `"interval not elapsed yet"`: Your keeper tried to charge the user too early.
- `"grace period elapsed"`: The keeper failed to charge within the allowed grace period window.
- `"daily spending limit exceeded"`: A `pay_per_use` call exceeded the user's daily configured limit.
- `"invalid recipient"`: `pay_per_use_to` was called with the contract address as `recipient`, or `set_merchant_fee_recipient` was called with the contract address as `recipient`. Use a valid account address instead.
- `"merchant not whitelisted"`: `pay_per_use_to` was called with a `recipient` that is not on the merchant whitelist, and the whitelist is enabled. Ask the admin to `add_merchant` for the recipient first. Note: `pay_per_use` (without `_to`) does **not** re-check the whitelist — only `pay_per_use_to` validates it.
- **Token Allowance Failed:** If the token contract throws an error during a charge, the user likely revoked their allowance or has an insufficient balance.

**Handling Errors:**

```javascript
try {
  const preparedTx = await server.prepareTransaction(tx);
  // ...
} catch (error) {
  if (error.response?.data?.extras?.result_codes?.operations) {
    console.error(
      "Contract Execution Failed:",
      error.response.data.extras.result_codes.operations,
    );
  } else {
    console.error("RPC Error:", error);
  }
}
```

---

## 9. Paginating Charge History

`get_charge_history_page(user, offset, limit)` reads from `ChargeHistory(user)`, a `Vec<u64>` capped at the 12 most recent charge timestamps (oldest → newest, FIFO). `limit` is silently capped at 12, and an `offset` past the end of the history returns an empty array rather than an error — there is no `ascending` flag, so "most recent first" has to be computed client-side from the returned oldest-to-newest slice.

The full mechanics — ring buffer diagram, worked examples, and an offset/limit reference table — live in [API.md § `get_charge_history_page` → Pagination Guide](./API.md#pagination-guide). The `loadAllChargeHistory()` pagination-loop example there is the recommended building block for a "load all history" or infinite-scroll UI, since it keeps working even if the on-chain retention cap changes later.

```javascript
async function getChargeHistoryPage(userAddress, offset, limit) {
  const source = await server.getAccount(userAddress);

  const tx = new TransactionBuilder(source, {
    fee: "1000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      payFlowContract.call(
        "get_charge_history_page",
        xdr.ScVal.scvAddress(userAddress),
        xdr.ScVal.scvU32(offset),
        xdr.ScVal.scvU32(limit),
      ),
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) throw new Error(sim.error);

  // sim.result.retval decodes to a Vec<u64> of charge timestamps (oldest → newest).
  return sim.result.retval;
}
```

---

## 9. Event-Driven Integrations

If your app needs to react to on-chain activity (new subscriptions, successful charges, cancellations, merchant freezes) rather than only calling contract methods, do **not** invent a custom polling scheme from scratch.

Use the Event-Driven Integration Cookbook:

- Poll Soroban RPC `getEvents` with a durable cursor
- Deduplicate on `tx_hash + event_name + ledger` (plus user address when scoped)
- Choose a reaction pattern: keeper, analytics, notifications, or reconciliation

Full guide: [`docs/EVENT-DRIVEN-GUIDE.md`](./EVENT-DRIVEN-GUIDE.md). Event payload schemas: [`docs/EVENTS.md`](./EVENTS.md). Reference scripts: [`scripts/watch-events.ts`](../scripts/watch-events.ts), [`scripts/replay-events.ts`](../scripts/replay-events.ts).
