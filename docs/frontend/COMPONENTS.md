# Frontend Component Inventory

This document provides the maintainer map and status classification for all components located in `frontend/src/components/` and `frontend/src/components/admin/`. It also establishes the single-source ownership of validation rules across the frontend.

> **Component Prop Reference**: For prop interfaces, types, and component-level code examples, see [`docs/FRONTEND-COMPONENTS.md`](../FRONTEND-COMPONENTS.md).  
> **Architecture Guide**: For application architecture, data flow, and provider hierarchies, see [`docs/FRONTEND.md`](../FRONTEND.md).  
> **Contributing Guide**: For coding guidelines, testing conventions, styling tokens, and PR requirements, see [`docs/CONTRIBUTING-FRONTEND.md`](../CONTRIBUTING-FRONTEND.md).

---

## Table of Contents

- [Status Classifications](#status-classifications)
- [Directory Map](#directory-map)
- [Component Inventory (`frontend/src/components/`)](#component-inventory-frontendsrccomponents)
- [Admin Component Inventory (`frontend/src/components/admin/`)](#admin-component-inventory-frontendsrccomponentsadmin)
- [Page Shells (`frontend/src/pages/`)](#page-shells-frontendsrcpages)
- [Single-Source Validation Rule Ownership](#single-source-validation-rule-ownership)
- [Related Documentation](#related-documentation)

---

## Status Classifications

Every component in the repository is categorized under one of two statuses:

| Status | Meaning |
| --- | --- |
| **Canonical** | Actively mounted in the production application tree via `src/App.tsx`, `src/main.tsx`, or imported by a canonical parent component. Safe to extend and maintain. |
| **Unmounted** | Present on disk and covered by unit/component tests, but not currently imported in the production application graph. |

> [!NOTE]
> All 50 component files currently located under `frontend/src/components/` and `frontend/src/components/admin/` have been audited against production import graphs. 49 components are **Canonical**; 1 component (`MerchantSubscriberTable.tsx`) is currently **Unmounted** (covered by Vitest test suites while `MerchantDashboard` uses virtualized list rendering).

---

## Directory Map

| Directory | Purpose | Domain / Scope | Status |
| --- | --- | --- | --- |
| `frontend/src/components/` | Subscriber, merchant, and shared UI | Core application features | Canonical + 1 unmounted component |
| `frontend/src/components/admin/` | Protocol administration panels | Admin operations | Canonical (via `pages/AdminDashboard.tsx`) |
| `frontend/src/pages/` | Route-level page shells | Admin | Canonical (`AdminDashboard.tsx` in `App.tsx`) |
| `frontend/src/context/` | Application-wide React contexts | RPC health, shortcuts, toasts | Canonical (`main.tsx` and `App.tsx`) |
| `frontend/src/hooks/` | Reusable state and contract workflows | Shared business logic | Canonical |
| `frontend/src/services/` | Shared non-React utilities and adapters | Network, wallet adapters, txQueue | Canonical |
| `frontend/src/utils/` | Formatting, validation, and error helpers | Shared | Canonical |
| `frontend/src/stellar.ts` | Central Soroban contract and RPC gateway | Blockchain communication | Canonical |
| `frontend/src/constants.ts` | Numeric contract limits, interval presets | Shared configuration | Canonical single source |

---

## Component Inventory (`frontend/src/components/`)

The table below lists all 45 components in the root `components/` directory:

| Component | Location | Purpose | Mounted By | Status |
| --- | --- | --- | --- | --- |
| **AddressBook** | `components/AddressBook.tsx` | Saved recipient address book | `SubscribeForm`, `TransferSubscriptionModal` | Canonical |
| **AddressInput** | `components/AddressInput.tsx` | Debounced G… address input with Ed25519 validation | `admin/AdminRepairPanel.tsx` | Canonical |
| **AllowanceDisplay** | `components/AllowanceDisplay.tsx` | SAC allowance vs subscription amount badge | `Dashboard`, `SubscribeForm` | Canonical |
| **AmountUnitToggle** | `components/AmountUnitToggle.tsx` | XLM vs Stroop display unit toggle | `WalletBar` | Canonical |
| **BalanceDisplay** | `components/BalanceDisplay.tsx` | Native XLM account balance display | `WalletBar`, `SubscribeForm` | Canonical |
| **ConfirmModal** | `components/ConfirmModal.tsx` | Accessible confirmation dialog with focus trap and configurable confirm label | `AddressBook`, `SubscriberRecoveryPanel`, `SubscribeForm` | Canonical |
| **ConnectWallet** | `components/ConnectWallet.tsx` | Connect wallet CTA button | `App` (when `!publicKey`) | Canonical |
| **ContractPauseBanner** | `components/ContractPauseBanner.tsx` | Emergency maintenance circuit-breaker banner | `App` | Canonical |
| **CopyButton** | `components/CopyButton.tsx` | Clipboard copy helper with feedback | `WalletBar`, `SubscriptionCard`, `TxQueuePanel`, `MerchantDashboard` | Canonical |
| **DailyLimitCard** | `components/DailyLimitCard.tsx` | Daily spending cap summary card | `Dashboard` | Canonical |
| **DailyLimitModal** | `components/DailyLimitModal.tsx` | Modal to configure or clear daily limits | `Dashboard` | Canonical |
| **Dashboard** | `components/Dashboard.tsx` | Subscriber dashboard view | `App` (tab: `"dashboard"`) | Canonical |
| **ErrorBoundary** | `components/ErrorBoundary.tsx` | React error boundary with fallback recovery UI | `main.tsx`, `Dashboard` | Canonical |
| **ErrorRecovery** | `components/ErrorRecovery.tsx` | Inline retry and friendly error display | `Dashboard`, `MerchantDashboard`, `SubscriptionCard` | Canonical |
| **EventFeed** | `components/EventFeed.tsx` | Real-time contract event activity stream | `Dashboard`, `MerchantDashboard` | Canonical |
| **IncreaseAllowanceModal** | `components/IncreaseAllowanceModal.tsx` | SAC token allowance approval modal | `Dashboard`, `SubscriptionCard` | Canonical |
| **IntervalSelector** | `components/IntervalSelector.tsx` | Billing frequency selector presets | `SubscribeForm` | Canonical |
| **LastUpdated** | `components/LastUpdated.tsx` | Cache freshness and timestamp indicator | `Dashboard`, `MerchantDashboard` | Canonical |
| **MerchantDashboard** | `components/MerchantDashboard.tsx` | Merchant revenue tracking and batch charging | `App` (tab: `"merchant"`) | Canonical |
| **MerchantSubscriberTable** | `components/MerchantSubscriberTable.tsx` | Sortable/filterable subscriber table with prorated refund preview and row action | Tests only (`MerchantSubscriberTable.test.tsx`) | Unmounted |
| **NetworkBadge** | `components/NetworkBadge.tsx` | Persistent Testnet / Mainnet status badge | `App` header, `WalletBar` | Canonical |
| **NextChargeCountdown** | `components/NextChargeCountdown.tsx` | Countdown timer to next scheduled billing cycle | `SubscriptionCard` | Canonical |
| **NotificationCenter** | `components/NotificationCenter.tsx` | Toast notification bell and history drawer | `WalletBar` | Canonical |
| **OfflineBanner** | `components/OfflineBanner.tsx` | Full-width network connectivity banner | `App` | Canonical |
| **PayPerUseForm** | `components/PayPerUseForm.tsx` | Instant metered micro-payment form | `Dashboard` | Canonical |
| **ReferralPanel** | `components/ReferralPanel.tsx` | Shareable `?ref=&merchant=` link, referred count, self-referral warning | `Dashboard`, `SubscribeForm` | Canonical |
| **RevenueSparkline** | `components/RevenueSparkline.tsx` | 7-day revenue trend SVG visualization | `MerchantDashboard` | Canonical |
| **RpcSettings** | `components/RpcSettings.tsx` | RPC endpoint configuration modal | `App` (via RPC failure banner) | Canonical |
| **ShortcutHelpOverlay** | `components/ShortcutHelpOverlay.tsx` | Keyboard shortcuts cheat sheet ('?' key) | `App` | Canonical |
| **Skeleton** | `components/Skeleton.tsx` | Skeleton loading state placeholders | `Dashboard`, `MerchantDashboard`, `SubscriptionHistory` | Canonical |
| **Spinner** | `components/Spinner.tsx` | CSS loading spinner | `ConnectWallet`, `DailyLimitCard`, `PayPerUseForm`, `SubscriptionExport`, etc. | Canonical |
| **StroopInput** | `components/StroopInput.tsx` | Dual-unit amount input field (XLM / Stroops) | `SubscribeForm`, `DailyLimitModal`, `IncreaseAllowanceModal` | Canonical |
| **SubscribeForm** | `components/SubscribeForm.tsx` | Checkout form with fee/allowance summary, trial length, and referral link pre-fill | `App` (tab: `"subscribe"`) | Canonical |
| **SubscriberRecoveryPanel** | `components/SubscriberRecoveryPanel.tsx` | Subscription data integrity diagnostic panel | `Dashboard` | Canonical |
| **SubscriptionCard** | `components/SubscriptionCard.tsx` | Active subscription details, health, and actions | `Dashboard` | Canonical |
| **SubscriptionExport** | `components/SubscriptionExport.tsx` | CSV and JSON export utility for subscriptions | `Dashboard`, `MerchantDashboard` | Canonical |
| **SubscriptionHealthWidget** | `components/SubscriptionHealthWidget.tsx` | Subscription health status indicator | `SubscriptionCard` | Canonical |
| **SubscriptionHistory** | `components/SubscriptionHistory.tsx` | Lazy-loaded historical charge ledger | `Dashboard` | Canonical |
| **TabBar** | `components/TabBar.tsx` | Navigation tab bar with keyboard support | `App` | Canonical |
| **ThemeToggle** | `components/ThemeToggle.tsx` | Dark / light theme toggle switch | `WalletBar`, `ConnectWallet` | Canonical |
| **Toast** | `components/Toast.tsx` | Floating toast notifications container | `Dashboard`, `SubscribeForm`, `DailyLimitModal`, `IncreaseAllowanceModal` | Canonical |
| **TransferSubscriptionModal** | `components/TransferSubscriptionModal.tsx` | Subscription ownership transfer modal | `SubscriptionCard` | Canonical |
| **TxQueuePanel** | `components/TxQueuePanel.tsx` | Pending background transaction drawer | `WalletBar` | Canonical |
| **WalletBar** | `components/WalletBar.tsx` | Connected wallet bar with balance and utilities | `App` (when `publicKey` connected) | Canonical |
| **WalletSelectModal** | `components/WalletSelectModal.tsx` | Multi-wallet provider selection modal | `App` | Canonical |

---

## Admin Component Inventory (`frontend/src/components/admin/`)

The table below lists the components in `frontend/src/components/admin/`:

| Component | Location | Purpose | Mounted By | Status |
| --- | --- | --- | --- | --- |
| **AddressListInput** | `admin/AddressListInput.tsx` | Multiline address input with validation and chunking | `admin/BatchPausePanel`, `admin/BatchWhitelistPanel` | Canonical |
| **AdminRepairPanel** | `admin/AdminRepairPanel.tsx` | On-chain contract subscription repair tool | `pages/AdminDashboard.tsx` | Canonical |
| **BatchPausePanel** | `admin/BatchPausePanel.tsx` | Admin batch subscription pause interface | `pages/AdminDashboard.tsx` | Canonical |
| **BatchWhitelistPanel** | `admin/BatchWhitelistPanel.tsx` | Admin batch merchant whitelist management | `pages/AdminDashboard.tsx` | Canonical |
| **FeeAdminPanel** | `admin/FeeAdminPanel.tsx` | Two-step protocol fee propose/commit, clear fee and fee bounds | `pages/AdminDashboard.tsx` | Canonical |
| **ProtocolStatsPanel** | `admin/ProtocolStatsPanel.tsx` | Protocol volume, fee, and merchant statistics | `pages/AdminDashboard.tsx` | Canonical |

---

## Page Shells (`frontend/src/pages/`)

| Page | Location | Purpose | Mounted By | Status |
| --- | --- | --- | --- | --- |
| **AdminDashboard** | `pages/AdminDashboard.tsx` | Top-level admin tab containing repair and batch tools | `App.tsx` (tab: `"admin"`, visible to contract admin) | Canonical |

---

## Single-Source Validation Rule Ownership

To prevent contradictory validation logic between forms, components, and the contract, validation rules must always be modified in their authoritative owner files:

| Rule Domain | Authoritative Owner File | Consumers | Invariant / Boundary |
| --- | --- | --- | --- |
| **Contract Limits** (Max subscription amount, max pay-per-use, min interval) | [`frontend/src/constants.ts`](../../frontend/src/constants.ts) (`CONTRACT_LIMITS`) | `useFormValidation`, `SubscribeForm`, `PayPerUseForm` | Kept in lockstep with contract constants in `contract/src/caps.rs`. |
| **Checkout & Subscribe Validation** (Merchant address, amount, interval, token) | [`frontend/src/hooks/useFormValidation.ts`](../../frontend/src/hooks/useFormValidation.ts) | `SubscribeForm`, `SubscribeForm.test.tsx` | Owns `validateStroopAmount`, `validateInterval`, and account balance checks. |
| **Pay-Per-Use Amount Validation** | [`frontend/src/hooks/useFormValidation.ts`](../../frontend/src/hooks/useFormValidation.ts) (`validateStroopAmount`) | `PayPerUseForm` | Reuses canonical stroop amount validation against `CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT`. |
| **Stroop / XLM Text Field Formatting** | [`frontend/src/components/StroopInput.tsx`](../../frontend/src/components/StroopInput.tsx) | `DailyLimitModal`, `IncreaseAllowanceModal`, `SubscribeForm` | Parses decimal fractions up to 7 decimal places and prevents numeric overflow. |
| **Single Stellar Ed25519 Address** | [`frontend/src/components/AddressInput.tsx`](../../frontend/src/components/AddressInput.tsx) | `admin/AdminRepairPanel.tsx`, tests | Validates base32 public keys using `StrKey.isValidEd25519PublicKey`. |
| **Multi-Address Lists & Chunking** | [`frontend/src/utils/addressValidation.ts`](../../frontend/src/utils/addressValidation.ts) | `admin/AddressListInput.tsx`, `admin/BatchPausePanel.tsx` | Splits line breaks/commas, removes duplicates, and chunks arrays to batch caps (`LIMITS.md`). |
| **Admin Repair Report Mappings** | [`frontend/src/utils/subscriptionValidation.ts`](../../frontend/src/utils/subscriptionValidation.ts) | `admin/AdminRepairPanel.tsx` | Translates smart contract data integrity violation codes into operator explanations. |
| **Billing Interval Presets** | [`frontend/src/constants.ts`](../../frontend/src/constants.ts) (`BILLING_INTERVALS`) | `SubscribeForm`, `SubscriptionCard` | Defines UI interval labels and seconds (Daily, Weekly, Monthly, Annual). |

---

## Related Documentation

| Document | Purpose |
| --- | --- |
| [`docs/FRONTEND.md`](../FRONTEND.md) | High-level frontend architecture, data flow, and provider tree |
| [`docs/FRONTEND-COMPONENTS.md`](../FRONTEND-COMPONENTS.md) | Component API specifications, prop types, and usage examples |
| [`docs/CONTRIBUTING-FRONTEND.md`](../CONTRIBUTING-FRONTEND.md) | Contributor workflows, testing conventions, and accessibility |
| [`docs/LIMITS.md`](../LIMITS.md) | Admin batch operation caps and contract limits |
