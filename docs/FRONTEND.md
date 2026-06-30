# Frontend Architecture Guide

## Overview

The PayFlow frontend is a React + TypeScript application built with Vite. It provides the user interface for interacting with the Stellar smart contract through a centralized contract wrapper while keeping UI components focused on presentation and user interaction.

The architecture separates responsibilities into:

- Components for rendering the UI
- Hooks for reusable business logic
- `stellar.ts` for all blockchain communication
- Services for utility functionality
- Local state and custom hooks for application state

---

# Technology Stack

| Technology | Purpose |
|------------|---------|
| React | Component based UI |
| TypeScript | Static typing |
| Vite | Development server and bundler |
| Stellar SDK | Building and signing Stellar transactions |
| Soroban RPC | Smart contract communication |
| Freighter Wallet | Wallet connection and transaction signing |

---

# Project Structure

```
frontend/
│
├── components/
├── hooks/
├── services/
├── types/
├── stellar.ts
├── App.tsx
└── main.tsx
```

Each directory has a dedicated responsibility.

- **components** contain reusable UI.
- **hooks** encapsulate business logic.
- **services** provide shared utilities.
- **stellar.ts** acts as the blockchain gateway.

---

# stellar.ts Architecture

`stellar.ts` is the single entry point for all smart contract interactions.

Instead of allowing components to call the Stellar SDK directly, every blockchain operation is routed through this file.

Benefits include:

- Single source of truth
- Easier maintenance
- Easier testing
- Consistent transaction handling
- Reduced duplication

## Function Categories

### Read Operations

Read functions fetch blockchain data without requiring a signed transaction.

Typical responsibilities include:

- Reading contract state
- Loading subscriptions
- Retrieving balances
- Querying events
- Reading configuration values

These operations are safe because they do not modify blockchain state.

---

### Write Operations

Write functions submit transactions that modify contract state.

Typical responsibilities include:

- Creating subscriptions
- Updating subscriptions
- Cancelling subscriptions
- Charging customers
- Administrative contract actions

Write operations generally:

1. Build the transaction
2. Request a signature from Freighter
3. Submit the signed transaction
4. Wait for confirmation
5. Return the parsed result

---

# Hook Composition Pattern

The application follows a hook composition pattern.

Rather than placing blockchain logic inside components, components compose multiple focused hooks.

For example, `App.tsx` combines hooks including:

- useWallet()
- useTheme()
- useResponsive()
- useAccessibility()
- useFreighterAvailable()
- useNetworkCheck()
- useContractId()

Each hook owns one responsibility.

Example:

```tsx
const wallet = useWallet();
const theme = useTheme();
const responsive = useResponsive();
```

This approach improves:

- readability
- reusability
- testing
- separation of concerns

---

# Wallet Connection Flow (Freighter)

Wallet connectivity is handled through the custom `useWallet` hook together with Freighter detection.

Connection flow:

1. Application loads.
2. `useFreighterAvailable()` checks whether `window.freighter` exists.
3. If available, `useWallet()` attempts to restore the previously connected wallet from local storage.
4. The cached public key is validated with Freighter.
5. The hook exposes a `ready` state once validation completes.
6. If the user is not connected, the UI presents the Connect Wallet action.
7. When the user connects:
   - Freighter returns the public key.
   - The public key is stored locally.
8. Any contract write operation requests transaction signing through Freighter.
9. The signed transaction is submitted through `stellar.ts`.
10. The UI updates after confirmation.

This design allows wallet persistence across page reloads while ensuring the cached account remains valid.

---

# Component Tree

The exact tree evolves as features are added, but the overall structure is:

```
App
│
├── Layout
│
├── Wallet Components
│   ├── Connect Wallet
│   └── Wallet Status
│
├── Dashboard
│
├── Subscription Views
│
├── Merchant Dashboard
│
├── History
│
└── Shared Components
```

Heavy views are lazy loaded where appropriate to reduce initial bundle size.

---

# State Management

The frontend primarily uses React hooks instead of a dedicated global state library.

## Local State

Component-specific state uses:

- useState
- useReducer (where appropriate)

Examples include:

- modal visibility
- form values
- loading states

---

## Custom Hooks

Reusable application logic is extracted into hooks.

Examples include:

- wallet management
- network validation
- accessibility
- responsive layout
- theme management
- local storage persistence

This keeps components lightweight.

---

## Context

Context is used only when shared application state must be accessible by multiple components.

Business logic remains inside custom hooks rather than Context itself.

---

# Why This Architecture

This architecture provides:

- Clear separation between UI and blockchain logic
- Reusable business logic through hooks
- Centralized smart contract communication
- Easier maintenance
- Better scalability
- Cleaner React components

---

# Summary

The frontend is organized around a simple principle:

- Components render the UI.
- Hooks manage application logic.
- `stellar.ts` owns blockchain communication.
- Freighter signs transactions.
- React state and hooks manage application state efficiently.
