# PayFlow Integration Guide

This guide is designed for third-party applications (such as SaaS billing dashboards, merchants, and mobile apps) that want to integrate the PayFlow recurring billing and `pay_per_use` microtransaction protocol on the Stellar network.

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
import { rpc, Contract, xdr, Keypair, Networks } from '@stellar/stellar-sdk';

// Initialize the RPC server
const server = new rpc.Server('https://soroban-testnet.stellar.org');

// The deployed PayFlow contract ID
const CONTRACT_ID = 'C...'; 
const payFlowContract = new Contract(CONTRACT_ID);
```

---

## 4. Subscribing a User Programmatically

Subscribing requires two steps: 
1. **Token Allowance:** The user must approve the PayFlow contract to pull funds.
2. **Subscribe:** The user calls the `subscribe` function on PayFlow.

```javascript
async function subscribeUser(userKeypair, merchantAddress, amountStroops, intervalSeconds, tokenAddress) {
  const source = await server.getAccount(userKeypair.publicKey());
  
  // 1. Build the Subscribe transaction
  const tx = new TransactionBuilder(source, { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(
      payFlowContract.call('subscribe',
        xdr.ScVal.scvAddress(userKeypair.publicKey()),   // user
        xdr.ScVal.scvAddress(merchantAddress),           // merchant
        xdr.ScVal.scvI128(new xdr.Int128Parts({          // amount
            hi: xdr.Int64.fromString("0"),
            lo: xdr.Uint64.fromString(amountStroops.toString())
        })), 
        xdr.ScVal.scvU64(xdr.Uint64.fromString(intervalSeconds.toString())), // interval
        xdr.ScVal.scvAddress(tokenAddress),              // token
        xdr.ScVal.scvVoid(),                             // trial_period (Option<u64> -> None)
        xdr.ScVal.scvVoid()                              // referrer (Option<Address> -> None)
      )
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
  const scvUsers = userAddresses.map(addr => xdr.ScVal.scvAddress(addr));
  const scvVecUsers = xdr.ScVal.scvVec(scvUsers);

  const tx = new TransactionBuilder(source, { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(payFlowContract.call('batch_charge', scvVecUsers))
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keeperKeypair);
  
  return await server.sendTransaction(preparedTx);
}
```

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
        topics: [
          [xdr.ScVal.scvSymbol("charged").toXDR("base64")]
        ]
      }
    ]
  });

  response.events.forEach(event => {
    console.log(`Charge processed at ledger: ${event.ledger}`);
    // Decode event.value here to get amount, merchant, and timestamp
  });
}
```

---

## 7. Error Handling

When calling the contract, the RPC may return specific execution errors if validations fail. You must handle these gracefully in your application.

Common errors you should catch:

- `"amount must be positive"` / `"interval must be positive"`: Ensure you are passing non-zero values.
- `"no subscription found"`: The user has not subscribed or the subscription was canceled.
- `"interval not elapsed yet"`: Your keeper tried to charge the user too early.
- `"grace period elapsed"`: The keeper failed to charge within the allowed grace period window.
- `"daily spending limit exceeded"`: A `pay_per_use` call exceeded the user's daily configured limit.
- **Token Allowance Failed:** If the token contract throws an error during a charge, the user likely revoked their allowance or has an insufficient balance.

**Handling Errors:**
```javascript
try {
    const preparedTx = await server.prepareTransaction(tx);
    // ...
} catch (error) {
    if (error.response?.data?.extras?.result_codes?.operations) {
        console.error("Contract Execution Failed:", error.response.data.extras.result_codes.operations);
    } else {
        console.error("RPC Error:", error);
    }
}
```
