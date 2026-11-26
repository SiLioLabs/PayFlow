# Frontend Component Reference

This document provides the component-by-component API reference for PayFlow's React UI, including props, types, states, hooks, and usage examples.

> **Component Inventory & Status**: For the complete inventory of canonical vs. unmounted status and validation-rule ownership, see [`docs/frontend/COMPONENTS.md`](frontend/COMPONENTS.md).  
> **Architecture Guide**: For application architecture, data flow, and provider hierarchies, see [`docs/FRONTEND.md`](FRONTEND.md).  
> **Contributing Guide**: For coding guidelines, testing conventions, styling tokens, and PR requirements, see [`docs/CONTRIBUTING-FRONTEND.md`](CONTRIBUTING-FRONTEND.md).  
> **Component Catalogue**: Run `npm run catalogue` inside `frontend/` to browse all component states interactively. Stories live in `frontend/src/stories/`.

---

## Table of Contents

- [Components Reference](#components-reference)
  - [AddressBook](#addressbook)
  - [AddressInput](#addressinput)
  - [AllowanceDisplay](#allowancedisplay)
  - [AmountUnitToggle](#amountunittoggle)
  - [BalanceDisplay](#balancedisplay)
  - [ChargeReceipt](#chargereceipt)
  - [ConfirmModal](#confirmmodal)
  - [ConnectWallet](#connectwallet)
  - [ContractPauseBanner](#contractpausebanner)
  - [CopyButton](#copybutton)
  - [DailyLimitCard](#dailylimitcard)
  - [DailyLimitModal](#dailylimitmodal)
  - [Dashboard](#dashboard)
  - [ErrorBoundary](#errorboundary)
  - [ErrorRecovery](#errorrecovery)
  - [EventFeed](#eventfeed)
  - [IncreaseAllowanceModal](#increaseallowancemodal)
  - [IntervalSelector](#intervalselector)
  - [LastUpdated](#lastupdated)
  - [MerchantDashboard](#merchantdashboard)
  - [MerchantSubscriberTable](#merchantsubscribertable)
  - [NetworkBadge](#networkbadge)
  - [NextChargeCountdown](#nextchargecountdown)
  - [NotificationCenter](#notificationcenter)
  - [OfflineBanner](#offlinebanner)
  - [PayPerUseForm](#payperuseform)
  - [ReferralPanel](#referralpanel)
  - [RevenueSparkline](#revenuesparkline)
  - [RevenueExport](#revenueexport)
  - [RpcSettings](#rpcsettings)
  - [ShortcutHelpOverlay](#shortcuthelpoverlay)
  - [Skeleton](#skeleton)
  - [Spinner](#spinner)
  - [StroopInput](#stroopinput)
  - [SubscribeForm](#subscribeform)
  - [SubscriberRecoveryPanel](#subscriberrecoverypanel)
  - [SubscriptionCard](#subscriptioncard)
  - [SubscriptionExport](#subscriptionexport)
  - [SubscriptionHealthWidget](#subscriptionhealthwidget)
  - [SubscriptionHistory](#subscriptionhistory)
  - [TabBar](#tabbar)
  - [ThemeToggle](#themetoggle)
  - [Toast](#toast)
  - [TransferSubscriptionModal](#transfersubscriptionmodal)
  - [TxQueuePanel](#txqueuepanel)
  - [WalletBar](#walletbar)
  - [WalletSelectModal](#walletselectmodal)
- [Admin Components Reference](#admin-components-reference)
  - [AddressListInput](#addresslistinput)
  - [AdminRepairPanel](#adminrepairpanel)
  - [BatchPausePanel](#batchpausepanel)
  - [BatchWhitelistPanel](#batchwhitelistpanel)
  - [FeeAdminPanel](#feeadminpanel)
  - [ProtocolStatsPanel](#protocolstatspanel)
- [Hooks Reference](#hooks-reference)
- [Services Reference](#services-reference)
- [Extending Common Surfaces](#extending-common-surfaces)
- [Related Documentation](#related-documentation)

---

## Components Reference

### AddressBook

**File:** `frontend/src/components/AddressBook.tsx`

Modal-based address book allowing subscribers to save, search, select, import, and export frequently used Stellar addresses.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `onSelect` | `(address: string) => void` | yes | Callback invoked when an address is chosen. |
| `onClose` | `() => void` | yes | Callback invoked when the modal is closed without selection. |

- **State**: `entries`, `query`, `newName`, `newAddress`, `addError`, `pendingDelete`, `importError`
- **Hooks**: `useLocalStorage(STORAGE_KEY, [])`, `useFocusTrap(modalRef, true, onClose)`
- **Edge cases**: Enforces `MAX_ADDRESS_BOOK_ENTRIES` (default 50); validates Ed25519 format before adding; prevents duplicate entries.

---

### AddressInput

**File:** `frontend/src/components/AddressInput.tsx`

Debounced Stellar address text input with inline Ed25519 checksum validation and accessible error feedback.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `label` | `string` | yes | Form field label copy. |
| `value` | `string` | yes | Current address string value. |
| `onChange` | `(value: string) => void` | yes | Change handler invoked on input mutations. |
| `id` | `string` | no | Optional HTML id attribute (defaults to generated id). |

- **State**: `error`
- **Hooks**: `useDebounce(value, 300)`
- **Edge cases**: Empty input clears error state; blur event triggers instant validation; mid-typing validation waits for the 300ms debounce.

---

### AllowanceDisplay

**File:** `frontend/src/components/AllowanceDisplay.tsx`

Displays current SAC token allowance compared to the subscription recurring amount with contextual health badges (Healthy, Warning, Critical).

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Subscriber's public key (G…). |
| `subscriptionAmount` | `bigint` | yes | Periodic billing amount in stroops. |
| `refreshTrigger` | `number` | yes | Numeric counter incremented to trigger allowance re-fetch. |

- **State**: `allowance`, `loading`
- **Edge cases**: Critical badge when `allowance < amount`; Warning badge when `allowance < 3 * amount`; returns "Unavailable" on RPC failure.

---

### AmountUnitToggle

**File:** `frontend/src/components/AmountUnitToggle.tsx`

Accessible switch button that toggles global amount formatting between "XLM" and "STROOP".

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `className` | `string` | no | Optional additional CSS classes. |

- **Hooks**: `useAmountDisplay()`
- **Accessibility**: Rendered as `role="switch"` with `aria-checked` reflecting XLM unit state.

---

### BalanceDisplay

**File:** `frontend/src/components/BalanceDisplay.tsx`

Compact XLM balance indicator designed for header bars and form headers.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `address` | `string` | yes | Stellar public key whose balance is rendered. |

- **Hooks**: `useStellarBalance(address)`
- **Edge cases**: Renders a skeleton loader only when initial load is in progress and no stale cached balance exists.

---

### ChargeReceipt

**File:** `frontend/src/components/ChargeReceipt.tsx`

Printable / PDF-friendly receipt for a single charge event. Opened from `SubscriptionHistory` via the "Receipt" button on each charge row. Renders in an accessible modal overlay by default; set `modal={false}` for inline embedding.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `event` | `ChargeEvent` | yes | The charge event to display (date, amount, txHash, merchant). |
| `merchantName` | `string` | no | Optional display name for the merchant. When provided, the raw address is shown as a secondary row. |
| `onClose` | `() => void` | no | Called when the user clicks "Close" or the modal backdrop. |
| `modal` | `boolean` | no | When `true` (default) wraps the receipt in a `modal-overlay`. Pass `false` to embed inline. |

- **Explorer link**: Uses `explorerTxUrl()` from `stellar.ts` — always points at the configured network (Testnet/Mainnet).
- **Protocol fee**: When `VITE_PROTOCOL_FEE_BPS` is set, an additional fee and net-to-merchant row are shown.
- **Print styles**: `window.print()` is triggered by the "Print / Save PDF" button. `@media print` rules in `index.css` hide all other page content and reveal the letterhead and footer that are hidden on screen.
- **Accessibility**: `role="document"` on the receipt body; modal dialog has `role="dialog"` with `aria-modal="true"`.

---

### ConfirmModal

**File:** `frontend/src/components/ConfirmModal.tsx`

Accessible confirmation modal with backdrop and keyboard focus trap.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `message` | `string` | yes | Confirmation message copy displayed to the user. |
| `onConfirm` | `() => void` | yes | Handler called when the confirm action button is clicked. |
| `onCancel` | `() => void` | yes | Handler called when cancelled, dismissed, or Escape key pressed. |

- **Hooks**: `useFocusTrap(modalRef, true, onCancel)`

---

### ConnectWallet

**File:** `frontend/src/components/ConnectWallet.tsx`

Wallet connection call-to-action button rendered when no wallet is currently connected.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `onConnect` | `() => void` | yes | Opens the multi-wallet selection modal. |
| `error` | `string \| null` | yes | Error message from wallet provider, or null. |
| `loading` | `boolean` | no | Shows button loading spinner while connecting. |

---

### ContractPauseBanner

**File:** `frontend/src/components/ContractPauseBanner.tsx`

Full-width banner rendered at the top of the application when the contract circuit breaker is engaged.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `paused` | `boolean` | yes | Whether the contract is currently paused. |
| `contractStatus` | `string` | no | Optional detail string from contract health check. |

---

### CopyButton

**File:** `frontend/src/components/CopyButton.tsx`

Accessible clipboard copy button with transient "Copied!" visual and ARIA feedback.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | `string` | yes | Text to copy to system clipboard. |
| `ariaLabel` | `string` | no | Accessible label (default: `"Copy to clipboard"`). |
| `title` | `string` | no | Tooltip title attribute. |

- **Hooks**: `useClipboard()`

---

### DailyLimitCard

**File:** `frontend/src/components/DailyLimitCard.tsx`

Dashboard card displaying the subscriber's daily spending limit, current day's spend, and window reset timer.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Subscriber public key. |
| `refreshTrigger` | `number` | yes | Counter to trigger limit re-fetch. |
| `onConfigure` | `() => void` | yes | Opens `DailyLimitModal`. |

- **State**: `dailyLimit`, `dailySpent`, `loading`

---

### DailyLimitModal

**File:** `frontend/src/components/DailyLimitModal.tsx`

Modal dialog allowing subscribers to configure or clear their 24-hour spending limit.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Subscriber public key. |
| `currentLimit` | `bigint \| null` | yes | Active daily limit in stroops, or null. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `onClose` | `() => void` | yes | Modal dismissal handler. |
| `onSuccess` | `() => void` | yes | Callback invoked after successful limit update. |

---

### Dashboard

**File:** `frontend/src/components/Dashboard.tsx`

Subscriber dashboard view rendering active subscription status, health, daily limits, and action modals.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Connected subscriber public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `refreshTrigger` | `number` | yes | Counter triggering data re-fetches. |
| `announce` | `(msg: string) => void` | yes | Screen reader announcement callback. |
| `isPaused` | `boolean` | no | Disables mutating actions when contract/network is gated. |
| `isOffline` | `boolean` | no | Disables mutating actions when browser is offline. |

---

### ErrorBoundary

**File:** `frontend/src/components/ErrorBoundary.tsx`

Class-based React error boundary catching render crashes in subtrees and presenting a recovery button.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | yes | Child components to wrap. |
| `fallback` | `ReactNode` | no | Optional custom fallback UI. |

---

### ErrorRecovery

**File:** `frontend/src/components/ErrorRecovery.tsx`

Inline retry component displaying user-friendly error messages with an actionable retry button.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `error` | `string \| Error \| null` | yes | Error details to display. |
| `onRetry` | `() => void` | yes | Callback invoked when the user clicks Retry. |
| `title` | `string` | no | Optional card title. |

---

### EventFeed

**File:** `frontend/src/components/EventFeed.tsx`

Real-time activity stream displaying contract events (charges, subscriptions, pauses, cancellations).

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | no | Filter events by user address (optional). |
| `limit` | `number` | no | Maximum events to fetch (default: 20). |

- **Hooks**: `useContractEvents(eventName, userKey)`

---

### IncreaseAllowanceModal

**File:** `frontend/src/components/IncreaseAllowanceModal.tsx`

Modal for approving token allowances to the FlowPay contract using SAC `approve`.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Subscriber public key. |
| `currentAllowance` | `bigint` | yes | Current allowance in stroops. |
| `suggestedAmount` | `bigint` | yes | Recommended allowance amount in stroops. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `onClose` | `() => void` | yes | Modal dismissal callback. |
| `onSuccess` | `() => void` | yes | Callback invoked upon successful approval. |

---

### IntervalSelector

**File:** `frontend/src/components/IntervalSelector.tsx`

Billing interval preset picker (Daily, Weekly, Monthly, Annual) based on `BILLING_INTERVALS`.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `value` | `number` | yes | Currently selected interval in seconds. |
| `onChange` | `(seconds: number) => void` | yes | Selection change callback. |
| `disabled` | `boolean` | no | Disables option selection. |

---

### LastUpdated

**File:** `frontend/src/components/LastUpdated.tsx`

Displays cache timestamp and relative freshness with a manual refresh button.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `timestamp` | `number \| null` | yes | Unix timestamp of the last successful cache fetch. |
| `onRefresh` | `() => void` | yes | Callback invoked when the user clicks refresh. |
| `loading` | `boolean` | no | Indicates active refresh in progress. |

---

### MerchantDashboard

**File:** `frontend/src/components/MerchantDashboard.tsx`

Merchant portal for inspecting subscriber metrics, revenue history, batch charging, and data export.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `merchantKey` | `string` | yes | Merchant's Stellar public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper for batch charging. |
| `refreshTrigger` | `number` | yes | Counter to trigger merchant data re-fetch. |
| `isPaused` | `boolean` | no | Disables batch charge actions when contract is paused. |

---

### RevenueExport

**File:** `frontend/src/components/RevenueExport.tsx`

Exports the merchant's retained daily revenue buckets as CSV, including the cumulative dashboard total and exact stroops/XLM amounts. Daily rows are loaded through paginated contract queries.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `merchantKey` | `string` | yes | Merchant's Stellar public key. |
| `totalRevenue` | `bigint` | yes | Cumulative revenue shown in the dashboard. |

---

### MerchantSubscriberTable

**File:** `frontend/src/components/MerchantSubscriberTable.tsx`

Sortable, filterable table for viewing merchant subscribers with status badges and merchant-funded prorated refunds.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `subscribers` | `MerchantSubscriber[]` | yes | Array of subscriber records. |
| `merchantKey` | `string \| null` | no | Connected merchant wallet; refund actions are disabled on mismatch. |
| `onSign` | `(xdr: string) => Promise<string>` | no | Signing helper used for `cancel_and_refund_prorated`. |
| `onRefunded` | `(sub: MerchantSubscriber, hash: string) => void` | no | Called after a successful refund. |
| `isPaused` | `boolean` | no | Disables refund actions during maintenance. |
| `debounceMs` | `number` | no | Filter debounce delay in ms (default: 150). |

- Refund preview uses the contract's saturating, truncating `(amount × remaining) / interval` rule. Error 38 blocks a mismatched merchant wallet, 39 blocks a zero refund, and 40 is surfaced with a friendly underfunded-merchant message.
- **Status**: Unmounted in production (covered by Vitest unit tests; `MerchantDashboard` renders its own virtualized row list).

---

### NetworkBadge

**File:** `frontend/src/components/NetworkBadge.tsx`

Persistent badge displaying the active Stellar network (Testnet, Mainnet, Futurenet, Custom).

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `className` | `string` | no | Optional extra CSS classes. |

- **Hooks**: `useNetworkStatus()`

---

### NextChargeCountdown

**File:** `frontend/src/components/NextChargeCountdown.tsx`

Live countdown timer indicating time remaining until the next scheduled recurring charge.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `nextChargeAt` | `number` | yes | Unix timestamp (in seconds) of next charge. |
| `isPaused` | `boolean` | no | Renders "Paused" instead of countdown when true. |

---

### NotificationCenter

**File:** `frontend/src/components/NotificationCenter.tsx`

Notification bell icon with badge count, a dropdown drawer showing transient toast history, and persisted success/error/general-update category controls.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `notifications` | `Notification[]` | yes | Array of recorded notification objects. |
| `unreadCount` | `number` | yes | Count of unread notifications. |
| `onMarkAllRead` | `() => void` | yes | Handler to mark all notifications as read. |
| `onClearAll` | `() => void` | yes | Handler to clear notification history. |
| `explorerBase` | `string` | no | Explorer URL prefix for transaction links. |

---

### OfflineBanner

**File:** `frontend/src/components/OfflineBanner.tsx`

Accessible alert banner displayed when the browser loses network connectivity.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `visible` | `boolean` | yes | Whether to render the offline notification. |

---

### PayPerUseForm

**File:** `frontend/src/components/PayPerUseForm.tsx`

Instant metered payment form allowing one-off microtransactions against an active subscription.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Subscriber public key. |
| `merchantKey` | `string` | yes | Merchant public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `onSuccess` | `() => void` | yes | Callback invoked upon payment success. |
| `disabled` | `boolean` | no | Disables submission during loading or pause. |

---

### ReferralPanel

**File:** `frontend/src/components/ReferralPanel.tsx`

Referral program interface displaying a shareable `?ref=<ADDRESS>&merchant=<ADDRESS>` link, referred count, and self-referral warning.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `publicKey` | `string \| null` | no | Connected wallet public key used as the referral code. |
| `merchant` | `string \| null` | no | Merchant address pre-filled into the share link. |

---

### RevenueSparkline

**File:** `frontend/src/components/RevenueSparkline.tsx`

Lightweight SVG sparkline chart visualizing 7-day revenue trends.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `data` | `bigint[]` | yes | Array of daily revenue numbers in stroops. |
| `height` | `number` | no | Chart height in pixels (default: 40). |
| `width` | `number` | no | Chart width in pixels (default: 160). |

---

### RpcSettings

**File:** `frontend/src/components/RpcSettings.tsx`

Modal allowing users to configure custom Soroban RPC endpoints and test network connectivity.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `onClose` | `() => void` | yes | Modal dismissal callback. |

- **Hooks**: `useRpcHealthContext()`

---

### ShortcutHelpOverlay

**File:** `frontend/src/components/ShortcutHelpOverlay.tsx`

Modal overlay displaying registered keyboard shortcuts, triggered by pressing `?`.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `shortcuts` | `KeyboardShortcut[]` | yes | List of registered keyboard shortcuts. |
| `onClose` | `() => void` | yes | Modal dismissal callback. |

---

### Skeleton

**File:** `frontend/src/components/Skeleton.tsx`

Loading placeholder skeletons for cards, tables, and rows with animated pulse effects.

- **Exports**: `SubscriptionCardSkeleton`, `MerchantSubscriberSkeleton`, `AdminAddressListSkeleton`, `AdminRepairSkeleton`, `ChargeHistorySkeleton`

---

### Spinner

**File:** `frontend/src/components/Spinner.tsx`

Accessible CSS activity spinner.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `size` | `"sm" \| "md" \| "lg"` | no | Spinner size dimension (default: `"md"`). |
| `className` | `string` | no | Extra CSS classes. |

---

### StroopInput

**File:** `frontend/src/components/StroopInput.tsx`

Dual-unit amount input allowing users to enter amounts in XLM with real-time conversion to stroops.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `label` | `string` | yes | Input label text. |
| `value` | `bigint` | yes | Amount value in stroops. |
| `onChange` | `(val: bigint) => void`| yes | Mutation callback returning stroops. |
| `maxAmount` | `bigint` | no | Maximum permissible value in stroops. |
| `error` | `string` | no | Validation error string to display. |

---

### SubscribeForm

**File:** `frontend/src/components/SubscribeForm.tsx`

Checkout form for creating a new recurring subscription. It opens the Subscribe tab for share links, pre-fills `?ref=` / `?merchant=` params, shows the referrer, ignores invalid link addresses with a notice, and blocks self-referral (error 11) before signing.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Connected subscriber's public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `onSuccess` | `() => void` | yes | Callback invoked upon successful subscription. |
| `isPaused` | `boolean` | no | Disables form submission when contract is paused. |
| `isOffline` | `boolean` | no | Disables form submission when browser is offline. |

---

### SubscriberRecoveryPanel

**File:** `frontend/src/components/SubscriberRecoveryPanel.tsx`

Subscriber self-service data integrity diagnostic panel to detect orphaned states and trigger repairs.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Subscriber's public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `refreshTrigger` | `number` | yes | Re-fetch counter. |

---

### SubscriptionCard

**File:** `frontend/src/components/SubscriptionCard.tsx`

Detailed subscription display composed from focused status badges, action controls, and modal containers. `useSubscriptionCardState` owns allowance/trial/pause data and transaction state; `SubscriptionActions` owns pause/cancel confirmation UI; `SubscriptionStatusBadge` renders subscription, trial, and allowance status.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `subscription` | `Subscription` | yes | Subscription record object. |
| `userKey` | `string` | yes | Subscriber public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `onCancelled` | `() => void` | yes | Callback invoked when subscription is cancelled. |
| `refreshTrigger` | `number` | yes | Counter to trigger card data re-fetch. |
| `isPaused` | `boolean` | no | Disables mutation actions when protocol paused. |

---

### SubscriptionExport

**File:** `frontend/src/components/SubscriptionExport.tsx`

Export component generating CSV and JSON files of subscriber records with spreadsheet formula injection protection.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `subscribers` | `MerchantSubscriber[]` | yes | Array of subscriber records to export. |
| `filenamePrefix` | `string` | no | Custom filename prefix (default: `"subscriptions"`). |

---

### SubscriptionHealthWidget

**File:** `frontend/src/components/SubscriptionHealthWidget.tsx`

Visual indicator displaying on-chain subscription health score and risk level.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Subscriber public key. |
| `refreshTrigger` | `number` | no | Refresh counter. |

---

### SubscriptionHistory

**File:** `frontend/src/components/SubscriptionHistory.tsx`

Lazy-loaded historical ledger table showing past recurring charges, dates, amounts, and transaction links.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Subscriber public key. |
| `limit` | `number` | no | Max charges to render (default: 10). |

---

### TabBar

**File:** `frontend/src/components/TabBar.tsx`

Main application navigation tab bar with keyboard arrow key navigation and ARIA role="tablist" support.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `tabs` | `readonly Tab[]` | yes | Array of visible tab identifiers. |
| `activeTab` | `Tab` | yes | Currently active tab identifier. |
| `onTabChange` | `(tab: Tab) => void` | yes | Tab selection change handler. |

---

### ThemeToggle

**File:** `frontend/src/components/ThemeToggle.tsx`

Dark / light mode toggle button persisted via `localStorage` and applied via `[data-theme]` on the root HTML element.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `className` | `string` | no | Optional extra CSS classes. |

- **Hooks**: `useTheme()`

---

### Toast

**File:** `frontend/src/components/Toast.tsx`

Container displaying transient toast alerts (success, error, info) with auto-dismissal.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `toasts` | `ToastMessage[]` | yes | Array of active toast messages. |
| `onDismiss` | `(id: string) => void` | yes | Callback to dismiss an individual toast. |

---

### TransferSubscriptionModal

**File:** `frontend/src/components/TransferSubscriptionModal.tsx`

Modal dialog allowing a subscriber to transfer subscription ownership to another Stellar address.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `userKey` | `string` | yes | Current subscriber's public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `onClose` | `() => void` | yes | Modal dismissal callback. |
| `onSuccess` | `() => void` | yes | Callback invoked upon successful ownership transfer. |

---

### TxQueuePanel

**File:** `frontend/src/components/TxQueuePanel.tsx`

Collapsible drawer displaying recent in-flight and completed transactions from `txQueue`.

- **Hooks**: Subscribes to the `txQueue` singleton service.

---

### WalletBar

**File:** `frontend/src/components/WalletBar.tsx`

Top account chrome displaying connected wallet adapter, address, balance, network badge, notification center, and disconnect action.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `publicKey` | `string` | yes | Connected account public key. |
| `activeAdapter` | `WalletAdapter \| null` | yes | Active wallet adapter instance. |
| `onDisconnect` | `() => void` | yes | Disconnection handler. |
| `notifications` | `Notification[]` | no | Active toast notifications. |
| `unreadCount` | `number` | no | Unread notifications count. |
| `onMarkAllRead` | `() => void` | no | Mark notifications read handler. |
| `onClearNotifications` | `() => void` | no | Clear notifications handler. |

---

### WalletSelectModal

**File:** `frontend/src/components/WalletSelectModal.tsx`

Modal dialog presenting installed and supported wallet providers (Freighter, xBull, Lobstr, Hana, Albedo, Rabet, WalletConnect), with install guidance for unavailable wallets.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `adapters` | `WalletAdapter[]` | yes | Array of supported wallet adapters. |
| `onSelect` | `(adapter: WalletAdapter) => void` | yes | Selection callback. |
| `onClose` | `() => void` | yes | Modal dismissal callback. |
| `connectionStatus` | `string` | no | Connection status message. |
| `error` | `string \| null` | no | Connection error string. |

---

## Admin Components Reference

### AddressListInput

**File:** `frontend/src/components/admin/AddressListInput.tsx`

Multiline textarea for pasting and validating multiple Stellar addresses for batch operations.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `value` | `string` | yes | Raw textarea string value. |
| `onChange` | `(val: string) => void` | yes | Change handler. |
| `maxBatch` | `number` | yes | Maximum permissible batch size. |
| `label` | `string` | no | Form field label. |

---

### AdminRepairPanel

**File:** `frontend/src/components/admin/AdminRepairPanel.tsx`

Diagnostics panel for contract administrators to validate and repair on-chain subscription integrity violations.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `adminKey` | `string` | yes | Connected wallet address (must be contract admin). |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `gatePassed` | `boolean` | no | Network and configuration gate status. |

---

### BatchPausePanel

**File:** `frontend/src/components/admin/BatchPausePanel.tsx`

Admin tool for pasting multiple subscriber addresses and executing `batch_pause_subscriptions`.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `adminKey` | `string` | yes | Admin's public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `isAdmin` | `boolean` | yes | Whether connected wallet is authorized admin. |
| `onInit` | `(signal: AbortSignal) => Promise<void>` | no | Async initialization hook. |

---

### BatchWhitelistPanel

**File:** `frontend/src/components/admin/BatchWhitelistPanel.tsx`

Admin tool for adding or removing multiple merchant addresses from the contract whitelist in batches.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `adminKey` | `string` | yes | Admin's public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `isAdmin` | `boolean` | yes | Whether connected wallet is authorized admin. |
| `onInit` | `(signal: AbortSignal) => Promise<void>` | no | Async initialization hook. |

---

### FeeAdminPanel

**File:** `frontend/src/components/admin/FeeAdminPanel.tsx`

Admin UI for the two-step protocol fee change. Shows the live fee (`get_fee`), the configured bounds (`get_fee_bounds`) and any proposal made in the current session, and signs `propose_fee`, `commit_fee`, `clear_fee` and `set_fee_bounds`. Collector, bps and bounds are validated client-side with the contract's own error wording before the wallet prompt; proposals outside the bounds are blocked with `FeeOutOfBoundsAtCommit` (35). The contract has no pending-fee getter, so proposals staged in another session are not displayed (committing them still works).

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `adminKey` | `string` | yes | Admin's public key. |
| `onSign` | `(xdr: string) => Promise<string>` | yes | Transaction signing helper. |
| `isAdmin` | `boolean` | yes | Whether connected wallet is authorized admin. |

---

### ProtocolStatsPanel

**File:** `frontend/src/components/admin/ProtocolStatsPanel.tsx`

Read-only aggregate metrics panel displaying protocol volume, subscriber counts, fee recipient, and health status.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `callerKey` | `string` | yes | Caller's Stellar public key. |

---

## Hooks Reference

| Hook | Purpose | Signature |
| --- | --- | --- |
| `useAccessibility` | ARIA live-region screen reader announcer | `() => { announcement, announce }` |
| `useAdmin` | Verifies whether an address is contract administrator | `(publicKey: string \| null) => { isAdmin, adminAddress, loading }` |
| `useAmountDisplay` | Global Stroop vs XLM formatting preferences | `() => { unit, toggleUnit, formatAmount }` |
| `useClipboard` | Copies text to clipboard with feedback | `(timeout?: number) => { copied, error, copy }` |
| `useContractEvents` | Polls and paginates Soroban contract events | `(eventName, address?, maxEvents?) => { events, loading, error, refresh }` |
| `useDebounce` | Debounces any value across a specified delay | `<T>(value: T, delay?: number) => T` |
| `useFocusTrap` | Traps keyboard Tab navigation inside modals | `(ref, active, onEscape?) => void` |
| `useFormValidation` | Validates subscription amounts, intervals, and addresses | `() => { errors, validate, isValid, validating, validateAsync }` |
| `useNetworkStatus` | Validates wallet network against contract configuration | `() => { isOnline, networkMatch, walletNetwork, isMainnet, ... }` |
| `usePauseResume` | Handles subscription pause and resume transactions | `(userKey, onSign, onRefresh) => { pause, resume, isPending }` |
| `usePolling` | Runs periodic callbacks with automatic cleanup | `({ callback, interval, enabled }) => void` |
| `useResponsive` | Responsive breakpoints matching CSS media queries | `() => { isMobile, isTablet, isDesktop }` |
| `useRpcHealth` | Tracks RPC endpoint availability and circuit breaker | `() => { healthy, circuitOpen, latencyMs, ... }` |
| `useStellarBalance` | Fetches and caches XLM account balance | `(address: string) => { balance, loading, stale, refresh }` |
| `useSubscriptionSync` | Synchronizes on-chain subscription state with cache | `(userKey, refreshTrigger?) => { subscription, loading, refresh }` |
| `useToast` | Enqueues and manages transient toast notifications | `() => { notifications, unreadCount, markAllRead, clearNotifications }` |
| `useTransaction` | Submits transactions through queue and polls status | `() => { status, hash, error, submit }` |
| `useVirtualList` | Windowed virtualization for long subscriber tables | `<T>(items, rowHeight, containerHeight) => { visibleItems, ... }` |
| `useWallet` | Connects, persists, and signs via wallet adapters | `() => { publicKey, connect, disconnect, signAndSubmit, ... }` |

---

## Services Reference

### rpcCache.ts
**File:** `frontend/src/services/rpcCache.ts`  
In-flight deduplication and TTL LRU cache for RPC read operations (capacity 100 entries, default TTL 5000ms). Concurrent identical queries share a single active Promise.

### scval.ts
**File:** `frontend/src/services/scval.ts`  
Type-safe Soroban `xdr.ScVal` decoders (`decodeI128`, `decodeU64`, `decodeAddress`, `decodeStruct`, etc.). Throws descriptive `ScValDecodeError` instances when wire data types diverge from expected schemas.

### txQueue.ts
**File:** `frontend/src/services/txQueue.ts`  
Serialized transaction queue ensuring wallet signing requests do not collide. Tracks transaction states (`pending`, `submitted`, `confirmed`, `failed`) and powers `TxQueuePanel`.

---

## Extending Common Surfaces

### Adding a Field to `SubscriptionCard`
1. Update `Subscription` interface in `frontend/src/types.ts` if adding an on-chain property.
2. In `frontend/src/components/SubscriptionCard.tsx`, extract the field from `subscription`.
3. Wrap values in formatting helpers (`formatAmount`, `formatAddress`) and provide accessible labels.

### Adding a Widget to `Dashboard`
1. Create the widget in `frontend/src/components/`.
2. Import the widget in `frontend/src/components/Dashboard.tsx`.
3. Pass required context props (`userKey`, `onSign`, `refreshTrigger`).
4. Wrap in `ErrorBoundary` if the widget performs independent asynchronous network fetching.

### Extending `MerchantDashboard`
1. Use `getMerchantSubscribers` or add new query helpers in `frontend/src/stellar.ts`.
2. Follow virtual list guidelines if rendering collections exceeding 50 items.
3. Batch operations must enforce limits from `frontend/src/constants.ts` (`CONTRACT_LIMITS`).

---

## Related Documentation

| Document | Purpose |
| --- | --- |
| [`docs/FRONTEND.md`](FRONTEND.md) | High-level frontend architecture, data flow, and provider tree |
| [`docs/frontend/COMPONENTS.md`](frontend/COMPONENTS.md) | Component inventory, canonical status, and validation rule owners |
| [`docs/CONTRIBUTING-FRONTEND.md`](CONTRIBUTING-FRONTEND.md) | Contributor workflows, testing conventions, and accessibility |
| [`docs/LIMITS.md`](LIMITS.md) | Admin batch operation caps and contract limits |
