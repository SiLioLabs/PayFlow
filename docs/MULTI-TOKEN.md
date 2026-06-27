# Multi-Token Subscriptions Guide

This guide explains how to use custom Stellar Asset Contract (SAC) tokens with PayFlow for recurring payments and pay-per-use billing.

---

## Table of Contents

- [What is a SAC Token?](#what-is-a-sac-token)
- [Creating a SAC Token](#creating-a-sac-token)
- [Subscribing with Custom Tokens](#subscribing-with-custom-tokens)
- [Allowance Setup](#allowance-setup)
- [Pay-Per-Use with Custom Tokens](#pay-per-use-with-custom-tokens)
- [Full CLI Example](#full-cli-example)

---

## What is a SAC Token?

A Stellar Asset Contract (SAC) is a Soroban smart contract that implements the [Soroban Token Interface](https://developers.stellar.org/docs/build/sdks-and-libraries/soroban-token-interface/), the standard for tokens on Stellar. SAC tokens are used for:
- Custom stablecoins
- Reward points
- Utility tokens
- Any tokenized asset on Stellar

For more information on SAC tokens, see the [official Stellar documentation](https://developers.stellar.org/docs/build/sdks-and-libraries/soroban-token-interface/).

---

## Creating a SAC Token

You can create a SAC token using several tools:

### Using Soroban CLI

The easiest way to create a SAC token is using the `soroban` CLI:

```bash
# First, create a new keypair for your token admin
soroban config identity generate token-admin

# Deploy the SAC token contract
soroban contract deploy \
  --wasm path/to/soroban_token_contract.wasm \
  --source token-admin \
  --network testnet
```

### Using Existing Token

If you already have an existing Stellar asset (classic Stellar asset), you can wrap it as a SAC token using the Stellar Asset Contract Wrapper.

---

## Subscribing with Custom Tokens

PayFlow supports custom SAC tokens natively. When creating a subscription, you simply specify the token address in the `token` parameter:

### Key Points:
- Each subscription uses its own token (stored in the `Subscription` struct)
- The `initialize()` function sets a default token, but you can use any valid SAC token for individual subscriptions
- The token must be a valid SAC contract address (not a classic Stellar asset issuer/asset code pair)

---

## Allowance Setup

Before subscribing with a custom token, the user must first approve an allowance for the PayFlow contract on the token. This allows PayFlow to transfer tokens from the user's account to the merchant and fee collector.

### Approving Allowance via CLI:

```bash
soroban contract invoke \
  --id YOUR_TOKEN_ADDRESS \
  --source YOUR_USER_KEY \
  --network testnet \
  -- approve \
  --from YOUR_USER_ADDRESS \
  --spender PAYFLOW_CONTRACT_ADDRESS \
  --amount YOUR_SUBSCRIPTION_AMOUNT
```

---

## Pay-Per-Use with Custom Tokens

Pay-per-use charges automatically use the **same token** as the user's active subscription. You don't need to specify the token again - PayFlow retrieves it from the subscription storage.

---

## Full CLI Example

Here's a complete end-to-end example of using a custom SAC token with PayFlow:

### 1. Deploy PayFlow Contract (if not already deployed)

```bash
soroban contract deploy \
  --wasm path/to/payflow.wasm \
  --source deployer \
  --network testnet
```

### 2. Initialize PayFlow

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source deployer \
  --network testnet \
  -- initialize \
  --token DEFAULT_SAC_TOKEN_ADDRESS \
  --admin ADMIN_ADDRESS
```

### 3. Deploy Custom SAC Token

```bash
# Deploy token contract
TOKEN_ADDRESS=$(soroban contract deploy \
  --wasm path/to/soroban_token_contract.wasm \
  --source token-admin \
  --network testnet)
```

### 4. Mint Tokens to User

```bash
soroban contract invoke \
  --id $TOKEN_ADDRESS \
  --source token-admin \
  --network testnet \
  -- mint \
  --to USER_ADDRESS \
  --amount 1000000000  # 1000 tokens (assuming 7 decimals)
```

### 5. Approve Allowance

```bash
soroban contract invoke \
  --id $TOKEN_ADDRESS \
  --source user \
  --network testnet \
  -- approve \
  --from USER_ADDRESS \
  --spender PAYFLOW_CONTRACT_ADDRESS \
  --amount 50000000  # 50 tokens
```

### 6. Add Merchant to Whitelist (if enabled)

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source admin \
  --network testnet \
  -- add_merchant \
  --merchant MERCHANT_ADDRESS
```

### 7. Subscribe with Custom Token

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source user \
  --network testnet \
  -- subscribe \
  --user USER_ADDRESS \
  --merchant MERCHANT_ADDRESS \
  --amount 5000000  # 5 tokens per period
  --interval 2592000  # 30 days
  --token $TOKEN_ADDRESS \
  --trial-period 0 \
  --referrer null
```

### 8. Charge the Subscription

```bash
soroban contract invoke \
  --id PAYFLOW_CONTRACT_ADDRESS \
  --source keeper \
  --network testnet \
  -- charge \
  --user USER_ADDRESS
```

---

## Notes

- All amounts are in stroops (smallest unit of the token)
- The protocol fee (if enabled) is charged in the same token as the subscription
- You can have multiple subscriptions for the same user with different tokens
- The token address must be a valid SAC contract (not a classic Stellar asset)
