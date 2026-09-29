# Frontend component inventory

Maintainer map of `frontend/src/components` (and the related modules named in #1123). Use this to decide **what to wire into the app** versus what is a known orphan. Prop-level API details remain in [`FRONTEND-COMPONENTS.md`](../FRONTEND-COMPONENTS.md). Architecture: [`FRONTEND.md`](../FRONTEND.md).

**Do not resurrect orphans by importing them “to restore a missing feature” without checking this file.** Deletion of dead code is tracked separately as [SiLioLabs/PayFlow#1053](https://github.com/SiLioLabs/PayFlow/issues/1053) (tooling is **not** in the repo yet).

---

## How status is decided

| Status | Meaning |
| ------ | ------- |
| **Canonical** | Imported from production `App.tsx` / `main.tsx` or from a canonical parent (Dashboard, MerchantDashboard, AdminDashboard, WalletBar, SubscriptionCard, SubscribeForm). Safe to extend. |
| **Orphan (known)** | Present on disk, **not** imported from production sources. Flagged below with evidence. Tests may still import the file. |
| **Unmounted / check #1053** | No production import found at documentation time, but not named in the issue as a required orphan flag. Confirm with dead-code tooling once #1053 lands rather than treating this list as a deletion license. |

Production import graph was checked against `frontend/src/**/*.ts(x)` excluding `__tests__`.

---

## Known orphans (explicit)

| Module | Location | Domain | Evidence | Canonical replacement |
| ------ | -------- | ------ | -------- | --------------------- |
| **stellarBatchCharge.ts** | `frontend/src/stellarBatchCharge.ts` | Merchant / charge | File body is only `// Batch charge UI helper (unused).` Zero production or test imports. | Live batch charge is `simulateBatchCharge` / `buildBatchChargeTx` in [`stellar.ts`](../../frontend/src/stellar.ts), used by [`MerchantDashboard.tsx`](../../frontend/src/components/MerchantDashboard.tsx). |
| **SubscriptionRepairPanel (root)** | `frontend/src/components/SubscriptionRepairPanel.tsx` | Subscriber TTL restore | Duplicate name. **Not** imported by `App`, `Dashboard`, or `AdminDashboard`. Covered only by `SubscriptionRepairPanel.ttl.test.tsx`. | **Canonical:** [`components/admin/SubscriptionRepairPanel.tsx`](../../frontend/src/components/admin/SubscriptionRepairPanel.tsx), mounted from [`pages/AdminDashboard.tsx`](../../frontend/src/pages/AdminDashboard.tsx) (`validate_subscription` / `repair_subscription`). |

The root panel is a TTL/`extend_subscription_ttl` UI. The admin panel is on-chain **integrity repair**. They are not interchangeable. Do not import the root file into AdminDashboard.

---

## Dead-code tooling

There is **no** knip / unimported / ts-prune / CI dead-code job in this repository today. The planned mechanism is issue **#1053** (“Remove orphaned frontend modules and add dead-code detection”). Until that ships:

- Treat the **Known orphans** table as the only modules this issue requires you to flag.
- For other unmounted files, re-grep production imports or wait for #1053 rather than deleting by guesswork.

---

## Directories

| Path | Purpose | Owner / domain | Status |
| ---- | ------- | -------------- | ------ |
| `frontend/src/components/` | Subscriber, merchant, and shared UI | Product UI | Mix of canonical + orphans (see tables) |
| `frontend/src/components/admin/` | Admin-only panels | Protocol admin | Canonical via `pages/AdminDashboard.tsx` |
| `frontend/src/pages/` | Route-level shells | Admin | `AdminDashboard.tsx` canonical (`App` admin tab) |
| `frontend/src/hooks/` | Wallet, forms, network, toasts | Shared | Canonical; form rules in `useFormValidation.ts` |
| `frontend/src/utils/` | Address lists, repair messages, format | Shared | Canonical |
| `frontend/src/stellar.ts` | Contract SDK wrappers | Chain I/O | Canonical (do not add a second SDK layer) |
| `frontend/src/constants.ts` | Amount/interval numeric limits for the UI | Shared | Canonical for **numeric** subscribe/PPU rules |

---

## `components/` files

| Component | Location | Purpose | Owner | Status |
| --------- | -------- | ------- | ----- | ------ |
| AddressBook | `components/AddressBook.tsx` | Saved addresses | Subscriber | Canonical (imported from production graph) |
| AddressInput | `components/AddressInput.tsx` | G… field + Ed25519 check | Shared / admin | Canonical; **local** address validity (see validation) |
| AllowanceDisplay | `components/AllowanceDisplay.tsx` | SAC allowance vs amount | Subscriber | Canonical (`Dashboard`) |
| AmountUnitToggle | `components/AmountUnitToggle.tsx` | XLM/stroop display toggle | Shared | Unmounted — tests only (`useAmountDisplay.test.tsx`). Use `useAmountDisplay` / `StroopInput` instead. Confirm via #1053. |
| BalanceDisplay | `components/BalanceDisplay.tsx` | XLM balance | Wallet | Canonical (`WalletBar`) |
| ConfirmModal | `components/ConfirmModal.tsx` | Confirm dialog | Shared | Canonical |
| ConnectWallet | `components/ConnectWallet.tsx` | Alternate connect button | Wallet | Unmounted — `App` uses inline connect + `WalletSelectModal`. Confirm via #1053. |
| ContractPauseBanner | `components/ContractPauseBanner.tsx` | Protocol pause banner | Shell | Canonical (`App`) |
| CopyButton | `components/CopyButton.tsx` | Clipboard | Shared | Canonical |
| DailyLimitCard | `components/DailyLimitCard.tsx` | Daily cap summary | Subscriber | Canonical (`Dashboard`) |
| DailyLimitModal | `components/DailyLimitModal.tsx` | Set/clear daily cap | Subscriber | Canonical (`Dashboard`) |
| Dashboard | `components/Dashboard.tsx` | Subscriber home | Subscriber | Canonical (`App`) |
| ErrorBoundary | `components/ErrorBoundary.tsx` | React error boundary | Shell | Canonical (`main.tsx`, `Dashboard`) |
| ErrorRecovery | `components/ErrorRecovery.tsx` | Retry/error UI | Shared | Canonical |
| EventFeed | `components/EventFeed.tsx` | Contract events | Shared | Canonical |
| IncreaseAllowanceModal | `components/IncreaseAllowanceModal.tsx` | Token approve | Subscriber | Canonical |
| IntervalSelector | `components/IntervalSelector.tsx` | Billing interval picker | Subscribe | Canonical (`SubscribeForm`) |
| MerchantDashboard | `components/MerchantDashboard.tsx` | Merchant home + batch charge | Merchant | Canonical (`App`) |
| MerchantSubscriberTable | `components/MerchantSubscriberTable.tsx` | Sortable subscriber table | Merchant | Unmounted — `MerchantDashboard` renders its own list. Tests only. Confirm via #1053. |
| NetworkBadge | `components/NetworkBadge.tsx` | Testnet/Mainnet badge | Shell | Canonical |
| NextChargeCountdown | `components/NextChargeCountdown.tsx` | Next charge timer | Subscriber | Canonical (`SubscriptionCard`) |
| NotificationCenter | `components/NotificationCenter.tsx` | Toasts/notifications | Shell | Canonical (`WalletBar`) |
| OfflineBanner | `components/OfflineBanner.tsx` | Offline warning | Shell | Canonical (`App`) |
| PayPerUseForm | `components/PayPerUseForm.tsx` | Metered payment | Subscriber | Canonical (`Dashboard`) |
| ReferralPanel | `components/ReferralPanel.tsx` | Referrer | Subscriber | Canonical (`Dashboard`) |
| RevenueSparkline | `components/RevenueSparkline.tsx` | Revenue sparkline | Merchant | Canonical (`MerchantDashboard`) |
| RpcSettings | `components/RpcSettings.tsx` | RPC endpoint UI | Shell | Canonical (`App`) |
| ShortcutHelpOverlay | `components/ShortcutHelpOverlay.tsx` | Shortcut help modal | Shell | Unmounted (registry exists in `context/ShortcutRegistry.tsx`). Confirm via #1053. |
| Skeleton | `components/Skeleton.tsx` | Loading placeholders | Shared | Canonical |
| Spinner | `components/Spinner.tsx` | Spinner | Shared | Canonical |
| StroopInput | `components/StroopInput.tsx` | Amount field (XLM/stroops) | Shared | Canonical where used; has **its own** amount parse rules |
| SubscribeForm | `components/SubscribeForm.tsx` | Create subscription | Subscriber | Canonical (`App`) |
| SubscriptionCard | `components/SubscriptionCard.tsx` | Active sub card | Subscriber | Canonical (`Dashboard`) |
| SubscriptionExport | `components/SubscriptionExport.tsx` | CSV/JSON export; formula-like CSV text is apostrophe-prefixed for spreadsheet safety | Shared | Canonical |
| SubscriptionHealthWidget | `components/SubscriptionHealthWidget.tsx` | Health badge | Subscriber | Canonical (`SubscriptionCard`) |
| SubscriptionHistory | `components/SubscriptionHistory.tsx` | Charge history | Subscriber | Canonical (lazy from `Dashboard`) |
| **SubscriptionRepairPanel** | `components/SubscriptionRepairPanel.tsx` | TTL restore UI | Subscriber | **Orphan (duplicate)** — see above |
| SystemHealthCard | `components/SystemHealthCard.tsx` | `contract_health_check` card | Ops / UI | Unmounted. Confirm via #1053. |
| TabBar | `components/TabBar.tsx` | App tabs | Shell | Canonical (`App`) |
| ThemeToggle | `components/ThemeToggle.tsx` | Dark/light toggle | Shell | Unmounted (doc comment only). Confirm via #1053. |
| Toast | `components/Toast.tsx` | Toast container | Shared | Canonical |
| TransferSubscriptionModal | `components/TransferSubscriptionModal.tsx` | Transfer sub | Subscriber | Canonical (`SubscriptionCard`) |
| TxQueuePanel | `components/TxQueuePanel.tsx` | Tx queue drawer | Wallet | Unmounted — `WalletBar` uses `useTxQueue` directly. Confirm via #1053. |
| WalletBar | `components/WalletBar.tsx` | Connected wallet chrome | Shell | Canonical (`App`) |
| WalletSelectModal | `components/WalletSelectModal.tsx` | Wallet picker | Shell | Canonical (`App`) |

---

## `components/admin/`

| Component | Location | Purpose | Owner | Status |
| --------- | -------- | ------- | ----- | ------ |
| AddressListInput | `admin/AddressListInput.tsx` | Multiline address textarea | Admin | Canonical (pause/whitelist panels) |
| BatchPausePanel | `admin/BatchPausePanel.tsx` | `batch_pause_subscriptions` | Admin | Canonical (`AdminDashboard`) |
| BatchWhitelistPanel | `admin/BatchWhitelistPanel.tsx` | `whitelist_batch_add` / `remove` | Admin | Canonical (`AdminDashboard`) |
| ProtocolStatsPanel | `admin/ProtocolStatsPanel.tsx` | Protocol stats | Admin | Canonical (`AdminDashboard`) |
| **SubscriptionRepairPanel** | `admin/SubscriptionRepairPanel.tsx` | `validate_subscription` / `repair_subscription` | Admin | **Canonical** |

---

## Pages

| Module | Location | Purpose | Status |
| ------ | -------- | ------- | ------ |
| AdminDashboard | `pages/AdminDashboard.tsx` | Admin tab shell | Canonical (`App` when `useAdmin` is true) |

---

## Validation-rule ownership (single sources)

Change rules in the **owner** file, not in a one-off copy inside a screen.

| Rule | Owner (edit here) | Consumers | Notes |
| ---- | ----------------- | --------- | ----- |
| Max subscription amount, max pay-per-use amount, min interval (UI numbers) | [`frontend/src/constants.ts`](../../frontend/src/constants.ts) `CONTRACT_LIMITS` | `useFormValidation`, `SubscribeForm`, `PayPerUseForm` | Must stay consistent with contract `MAX_AMOUNT` / `MAX_SUBSCRIPTION_AMOUNT` / min interval. |
| Subscribe / checkout field validation (merchant, amount, interval, token) | [`frontend/src/hooks/useFormValidation.ts`](../../frontend/src/hooks/useFormValidation.ts) (`validateStroopAmount`, `validateInterval`, `useFormValidation`) | `SubscribeForm`, tests | Async account checks live in this hook. |
| Pay-per-use amount | `validateStroopAmount` + `CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT` | `PayPerUseForm` | Do not fork a third amount parser here. |
| Generic stroop text field (decimals, MAX_STROOPS) | [`StroopInput.tsx`](../../frontend/src/components/StroopInput.tsx) local `validate` | Direct StroopInput users | Separate from `validateStroopAmount` (known duplication; consolidation is #1059, not this doc). |
| Single G-address (Ed25519) in AddressInput | [`AddressInput.tsx`](../../frontend/src/components/AddressInput.tsx) (`StrKey.isValidEd25519PublicKey`) | Admin repair + others | Does **not** accept federated `user*domain` addresses. |
| Address lists (parse, duplicate, federated OR G…) | [`frontend/src/utils/addressValidation.ts`](../../frontend/src/utils/addressValidation.ts) | Admin batch panels, `AddressListInput` | Includes `chunkAddresses` for batch caps. |
| Repair-report violation copy | [`frontend/src/utils/subscriptionValidation.ts`](../../frontend/src/utils/subscriptionValidation.ts) | **Canonical** admin `SubscriptionRepairPanel` only | Maps contract violation codes to operator text. |
| Billing interval presets (labels) | `BILLING_INTERVALS` in `constants.ts` | `SubscribeForm`, `SubscriptionCard` | Preset list, not the min-interval rule. |

If you need a new subscribe rule, add it to `useFormValidation` + `CONTRACT_LIMITS`, then call it from `SubscribeForm`. Do not add a parallel validator on the form.

---

## Related

- Props and examples: [`docs/FRONTEND-COMPONENTS.md`](../FRONTEND-COMPONENTS.md)
- Architecture: [`docs/FRONTEND.md`](../FRONTEND.md)
- Contribution: [`docs/CONTRIBUTING-FRONTEND.md`](../CONTRIBUTING-FRONTEND.md)
- Dead-code deletion + CI: [issue #1053](https://github.com/SiLioLabs/PayFlow/issues/1053)
