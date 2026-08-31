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

| Technology       | Purpose                                   |
| ---------------- | ----------------------------------------- |
| React            | Component based UI                        |
| TypeScript       | Static typing                             |
| Vite             | Development server and bundler            |
| Stellar SDK      | Building and signing Stellar transactions |
| Soroban RPC      | Smart contract communication              |
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
React.StrictMode
└── RpcHealthProvider                    (context/RpcHealthContext.tsx)
    └── ShortcutRegistryProvider         (context/ShortcutRegistry.tsx)
        └── ErrorBoundary                (components/ErrorBoundary.tsx)
            └── App                      (App.tsx)
                ├── [ARIA live region]    (role="status", aria-live="polite")
                ├── Header               (<h1>FlowPay</h1>)
                ├── Wallet connect prompt (inline; shown when !publicKey)
                │   └── Connect Wallet button → connect(AVAILABLE_WALLETS[0])
                ├── Connected bar         (inline; truncated public key)
                ├── Tab buttons           (inline; "Dashboard" | "Subscribe")
                │
                ├── [Tab: "dashboard"]
                │   └── Dashboard         (components/Dashboard.tsx)
                │       ├── SubscriptionCard
                │       ├── SubscriptionCardSkeleton (loading)
                │       ├── ErrorBoundary
                │       ├── ErrorRecovery
                │       ├── AllowanceDisplay
                │       ├── IncreaseAllowanceModal
                │       ├── DailyLimitCard
                │       ├── DailyLimitModal
                │       ├── PayPerUseForm
                │       ├── ReferralPanel
                │       ├── SubscriptionHistory (lazy-loaded)
                │       ├── EventFeed
                │       ├── SubscriptionExport
                │       └── ToastContainer
                │
                └── [Tab: "subscribe"]
                    └── SubscribeForm     (components/SubscribeForm.tsx)
                        ├── IntervalSelector
                        ├── BalanceDisplay
                        ├── AllowanceDisplay
                        ├── AddressBook
                        └── ToastContainer
```

Heavy views are lazy loaded where appropriate to reduce initial bundle size.

## Provider Hierarchy

The provider tree in `main.tsx` wraps the entire application:

| Provider                   | Source                         | Purpose                                           |
| -------------------------- | ------------------------------ | ------------------------------------------------- |
| `React.StrictMode`         | React built-in                 | Development warnings and double-render checks     |
| `RpcHealthProvider`        | `context/RpcHealthContext.tsx` | Polls RPC with backoff / circuit breaker          |
| `ShortcutRegistryProvider` | `context/ShortcutRegistry.tsx` | Keyboard shortcut registration and dispatch       |
| `ErrorBoundary`            | `components/ErrorBoundary.tsx` | Catches render errors in subtree with fallback UI |

## Tab Routing

There is no router library. `App.tsx` uses a `useState<"subscribe" | "dashboard">` with inline tab buttons. To add a new tab:

1. Add the tab value to the `useState` union type.
2. Add a new tab button in the tab button group.
3. Add a conditional render block for the new tab content.
4. Import and render the component (or page) for that tab.

## Orphaned / Ready-to-Wire Components

The following components exist in `frontend/src/components/` but are **not** currently mounted in the application tree. They are built and ready for use but need to be wired into `App.tsx` or a parent component:

| Component                      | Purpose                                                  | How to wire                                                                                                          |
| ------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `MerchantDashboard.tsx`        | Merchant revenue & subscribers view                      | Add a "merchant" tab in App.tsx and render `<MerchantDashboard merchantKey={pk} onSign={sign} refreshTrigger={t} />` |
| `MerchantSubscriberTable.tsx`  | Sortable/filterable subscriber table                     | Used inside `MerchantDashboard` — auto-wired when MerchantDashboard is added                                         |
| `ConnectWallet.tsx`            | Freighter connect CTA with install link                  | Replace the inline connect button in App.tsx                                                                         |
| `WalletBar.tsx`                | Connected wallet strip with balance, network, disconnect | Replace the inline connected bar in App.tsx                                                                          |
| `WalletSelectModal.tsx`        | Multi-wallet selection modal                             | Wire into `WalletBar` or as a standalone wallet picker                                                               |
| `TabBar.tsx`                   | Main nav tabs (dashboard/subscribe/merchant/admin)       | Replace the inline tab buttons in App.tsx                                                                            |
| `ThemeToggle.tsx`              | Dark/light mode toggle                                   | Add to the header or connected bar                                                                                   |
| `NetworkBadge.tsx`             | Testnet/Mainnet badge                                    | Add to the header or `WalletBar`                                                                                     |
| `ContractPauseBanner.tsx`      | Maintenance banner when contract paused                  | Add near the top of `App.tsx`                                                                                        |
| `OfflineBanner.tsx`            | Full-width offline warning                               | Add near the top of `App.tsx`                                                                                        |
| `SystemHealthCard.tsx`         | Contract health status card                              | Add to a merchant or admin dashboard tab                                                                             |
| `SubscriptionHealthWidget.tsx` | Health indicator widget                                  | Add to `Dashboard` or `SubscriptionCard`                                                                             |
| `TxQueuePanel.tsx`             | Transaction queue panel                                  | Add to `WalletBar` or as a sidebar widget                                                                            |
| `NotificationCenter.tsx`       | Bell icon + notification dropdown                        | Add to `WalletBar` or header                                                                                         |
| `StroopInput.tsx`              | XLM amount input debounced to stroops                    | Use in forms that need XLM input (alternative to PayPerUseForm)                                                      |
| `AmountUnitToggle.tsx`         | Toggle XLM/STROOP display                                | Add to forms displaying amounts                                                                                      |
| `ShortcutHelpOverlay.tsx`      | Keyboard shortcuts overlay                               | Already available via ShortcutRegistry context — trigger with `?` key                                                |

### Admin components (in `components/admin/`)

These are wired into `pages/AdminDashboard.tsx` which is not currently mounted:

| Component                     | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `SubscriptionRepairPanel.tsx` | Admin subscription validation and repair |
| `BatchPausePanel.tsx`         | Batch pause subscriptions                |
| `BatchWhitelistPanel.tsx`     | Batch whitelist add/remove               |

To wire admin features, add an "admin" tab in `App.tsx` and render `<AdminDashboard />` (from `pages/AdminDashboard.tsx`).

## How to Add a New Tab

1. **Choose the component** from the orphaned list above (or create a new one).
2. **Update `App.tsx`:**
   - Extend the tab state type: `useState<"dashboard" | "subscribe" | "merchant">("dashboard")`
   - Add a tab button in the tab group.
   - Add a conditional render: `{activeTab === "merchant" && <MerchantDashboard ... />}`.
3. **Pass required props** (typically `userKey`, `onSign`, `refreshTrigger`).
4. **Test** that the component renders and interacts correctly.

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
