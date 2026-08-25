# Frontend Component Reference

Component-by-component reference for PayFlow’s React UI. For architecture and contribution workflow, see [FRONTEND.md](./FRONTEND.md) and [CONTRIBUTING-FRONTEND.md](./CONTRIBUTING-FRONTEND.md).

Props and signatures below are taken from TypeScript sources under `frontend/src/`. Amounts are generally in **stroops** unless noted.

---

## Table of contents

- [Components](#components)
- [Hooks](#hooks)
- [Services](#services)
- [Extending common surfaces](#extending-common-surfaces)

---

## Components

### AddressInput

**File:** `frontend/src/components/AddressInput.tsx`

Debounced Stellar address field with Ed25519 validation and valid/error CSS states.

| Prop       | Type                      | Required | Description             |
| ---------- | ------------------------- | -------- | ----------------------- |
| `label`    | `string`                  | yes      | Form label              |
| `value`    | `string`                  | yes      | Current address         |
| `onChange` | `(value: string) => void` | yes      | Fires on each keystroke |

**State:** `error`  
**Hooks:** `useDebounce(value, 300)`  
**Edge cases:** Empty clears error; blur validates immediately; mid-typing errors wait for debounce.

```tsx
<AddressInput label="Merchant" value={addr} onChange={setAddr} />
```

---

### AllowanceDisplay

**File:** `frontend/src/components/AllowanceDisplay.tsx`

Shows SAC allowance vs subscription amount with Healthy / Warning / Critical badges.

| Prop                 | Type     | Required | Description             |
| -------------------- | -------- | -------- | ----------------------- |
| `userKey`            | `string` | yes      | Subscriber public key   |
| `subscriptionAmount` | `bigint` | yes      | Period amount (stroops) |
| `refreshTrigger`     | `number` | yes      | Bump to re-fetch        |

**State:** `allowance`, `loading`  
**Edge cases:** Fetch failure → “Unavailable”; Critical if `allowance < amount`; Warning if `< 3× amount`.

---

### BalanceDisplay

**File:** `frontend/src/components/BalanceDisplay.tsx`

Compact XLM balance for the wallet bar; skeleton while first load.

| Prop      | Type     | Required | Description        |
| --------- | -------- | -------- | ------------------ |
| `address` | `string` | yes      | Account public key |

**Hooks:** `useStellarBalance(address)`  
**Edge cases:** Skeleton only when `loading && !stale`.

---

### ConfirmModal

**File:** `frontend/src/components/ConfirmModal.tsx`

Accessible confirm/cancel dialog with focus trap.

| Prop        | Type         | Required | Description       |
| ----------- | ------------ | -------- | ----------------- |
| `message`   | `string`     | yes      | Confirmation copy |
| `onConfirm` | `() => void` | yes      | Confirm           |
| `onCancel`  | `() => void` | yes      | Cancel / dismiss  |

**Hooks:** `useFocusTrap`  
**Edge cases:** Overlay click cancels; Esc via focus trap.

---

### ConnectWallet

**File:** `frontend/src/components/ConnectWallet.tsx`

Freighter connect CTA, or install link when the extension is missing.

| Prop        | Type             | Required             | Description                    |
| ----------- | ---------------- | -------------------- | ------------------------------ |
| `onConnect` | `() => void`     | yes                  | Connect handler                |
| `error`     | `string \| null` | yes                  | Error to display               |
| `loading`   | `boolean`        | no (default `false`) | Disables button; shows spinner |

**Hooks:** `useFreighterAvailable`

---

### CopyButton

**File:** `frontend/src/components/CopyButton.tsx`

Copies text with short-lived success/error icon feedback.

| Prop        | Type     | Required                      | Description       |
| ----------- | -------- | ----------------------------- | ----------------- |
| `text`      | `string` | yes                           | Clipboard payload |
| `ariaLabel` | `string` | no (default `"Copy address"`) | Accessible name   |

**Hooks:** `useClipboard`

---

### DailyLimitCard

**File:** `frontend/src/components/DailyLimitCard.tsx`

Displays daily PPU limit, today’s spend, and remaining; opens the limit modal via `onOpen`.

| Prop             | Type         | Required | Description       |
| ---------------- | ------------ | -------- | ----------------- |
| `userKey`        | `string`     | yes      | Subscriber key    |
| `refreshTrigger` | `number`     | yes      | Re-fetch trigger  |
| `onOpen`         | `() => void` | yes      | “Set limit” click |

**State:** `dailyLimit`, `dailySpent`, `loading`, `error`  
**Edge cases:** Remaining `"Exceeded"` if negative; null limit → “Not set”.

---

### DailyLimitModal

**File:** `frontend/src/components/DailyLimitModal.tsx`

Modal to set the daily PPU spending cap (`buildSetDailyLimitTx` + wallet sign).

| Prop        | Type                               | Required | Description      |
| ----------- | ---------------------------------- | -------- | ---------------- |
| `userKey`   | `string`                           | yes      | Subscriber key   |
| `onSign`    | `(xdr: string) => Promise<string>` | yes      | Sign & submit    |
| `onClose`   | `() => void`                       | yes      | Dismiss          |
| `onSuccess` | `() => void`                       | yes      | After success    |
| `announce`  | `(message: string) => void`        | yes      | A11y live region |

**State:** `currentLimit`, `amount`, `submitting`, `error`  
**Hooks:** `useToast`, `useFocusTrap`

---

### Dashboard

**File:** `frontend/src/components/Dashboard.tsx`

Subscriber hub: subscription card, allowance/daily limit, charge history, pay-per-use, RPC warnings, and related modals.

| Prop             | Type                               | Required | Description            |
| ---------------- | ---------------------------------- | -------- | ---------------------- |
| `userKey`        | `string`                           | yes      | Connected subscriber   |
| `onSign`         | `(xdr: string) => Promise<string>` | yes      | Wallet sign helper     |
| `refreshTrigger` | `number`                           | yes      | External re-fetch bump |
| `announce`       | `(message: string) => void`        | yes      | Screen-reader announce |
| `onCancelled`    | `() => void`                       | no       | After cancel           |
| `onPayPerUse`    | `(amount: bigint) => void`         | no       | After PPU success      |

**State:** `showDailyLimit`, `showIncreaseAllowance`, `allowanceRefresh`, `dailyLimitRefresh`, `ppuInputRef`  
**Hooks:** `useSubscriptionSync`, `usePolling` (30s if active), `useToast`, `useRpcHealth`, `useTransaction`, `useRegisterShortcuts`  
**Edge cases:** Lazy-loads `SubscriptionHistory`; skeleton while loading; PPU shortcut `p` only if active; degraded/unreachable RPC banners.

```tsx
<Dashboard userKey={pk} onSign={sign} refreshTrigger={t} announce={announce} />
```

---

### ErrorBoundary

**File:** `frontend/src/components/ErrorBoundary.tsx` (class component)

Catches render errors in a subtree; optional custom fallback.

| Prop       | Type        | Required | Description     |
| ---------- | ----------- | -------- | --------------- |
| `children` | `ReactNode` | yes      | Wrapped tree    |
| `fallback` | `ReactNode` | no       | Custom error UI |

**State:** `error` (+ `reset()`)  
**Edge cases:** Logs `componentStack` in development; default UI reloads the page.

---

### IncreaseAllowanceModal

**File:** `frontend/src/components/IncreaseAllowanceModal.tsx`

Approves SAC allowance for the FlowPay contract (recommended ≈ 6 billing cycles).

| Prop                 | Type                               | Required | Description   |
| -------------------- | ---------------------------------- | -------- | ------------- |
| `userKey`            | `string`                           | yes      | Owner key     |
| `subscriptionAmount` | `bigint`                           | yes      | Period amount |
| `onSign`             | `(xdr: string) => Promise<string>` | yes      | Sign helper   |
| `onClose`            | `() => void`                       | yes      | Dismiss       |
| `onSuccess`          | `() => void`                       | yes      | After approve |
| `announce`           | `(message: string) => void`        | yes      | A11y announce |

**Edge cases:** Errors if `VITE_TOKEN_CONTRACT_ID` / `VITE_CONTRACT_ID` unset; failed fetch treats allowance as `0n`.

---

### IntervalSelector

**File:** `frontend/src/components/IntervalSelector.tsx`

Billing interval select from `BILLING_INTERVALS`, plus custom days → seconds.

| Prop       | Type                        | Required | Description         |
| ---------- | --------------------------- | -------- | ------------------- |
| `value`    | `number`                    | yes      | Interval in seconds |
| `onChange` | `(seconds: number) => void` | yes      | New interval        |

**State:** `isCustom`, `customDays`  
**Edge cases:** Non-preset `value` starts in custom mode; custom only emits when `seconds > 0`.

---

### MerchantDashboard

**File:** `frontend/src/components/MerchantDashboard.tsx`

Merchant view: revenue, 7-day sparkline, virtualized subscribers, batch charge of due subs.

| Prop             | Type                               | Required | Description         |
| ---------------- | ---------------------------------- | -------- | ------------------- |
| `merchantKey`    | `string`                           | yes      | Merchant public key |
| `onSign`         | `(xdr: string) => Promise<string>` | yes      | Sign helper         |
| `refreshTrigger` | `number`                           | yes      | External refresh    |

**State:** `subscribers`, `revenue`, `revenueHistory`, `loading`, `error`, `outcomes`  
**Hooks:** `useTransaction`, `useVirtualList`, `usePolling` (30s)  
**Edge cases:** Due = `nextChargeAt <= now`; simulates before submit; refreshes ~2s after success; list height 400px / row 72px.

```tsx
<MerchantDashboard merchantKey={pk} onSign={sign} refreshTrigger={t} />
```

---

### NetworkBadge

**File:** `frontend/src/components/NetworkBadge.tsx`

Testnet vs Mainnet badge from `NETWORK_PASSPHRASE` (“Public Global” → Mainnet). No props.

---

### NextChargeCountdown

**File:** `frontend/src/components/NextChargeCountdown.tsx`

Live countdown to next charge; “Overdue” when past.

| Prop                  | Type     | Required | Description  |
| --------------------- | -------- | -------- | ------------ |
| `nextChargeTimestamp` | `number` | yes      | Unix seconds |

**State:** `countdown` (`days`, `hours`, `minutes`, `overdue`)  
**Edge cases:** Updates every 60s; minute precision only.

---

### PayPerUseForm

**File:** `frontend/src/components/PayPerUseForm.tsx` (`forwardRef`, `React.memo`)

PPU amount input with local + contract max validation.

| Prop      | Type                                | Required | Description       |
| --------- | ----------------------------------- | -------- | ----------------- |
| `onPay`   | `(amount: bigint) => Promise<void>` | yes      | Submit handler    |
| `loading` | `boolean`                           | yes      | Disables controls |

**State:** `amount`, `error`, `lastValue`, `convertedStroops`  
**Hooks:** `useDebounce(300)`  
**Edge cases:** Max 7 decimals; min/max stroops; clears input after pay; ref focuses the amount field.

---

### RevenueSparkline

**File:** `frontend/src/components/RevenueSparkline.tsx` (`React.memo`)

Accessible SVG sparkline for 7-day revenue `bigint[]` with a hidden data table.

| Prop      | Type       | Required | Description          |
| --------- | ---------- | -------- | -------------------- |
| `history` | `bigint[]` | yes      | Daily revenue points |

**Edge cases:** Empty → “No data”; `maxVal === 0` uses `1n` to avoid division by zero.

---

### ShortcutHelpOverlay

**File:** `frontend/src/components/ShortcutHelpOverlay.tsx`

Modal listing registered shortcuts (+ Esc); focus-trapped.

| Prop        | Type                 | Required | Description                    |
| ----------- | -------------------- | -------- | ------------------------------ |
| `shortcuts` | `KeyboardShortcut[]` | yes      | `{ key, description, action }` |
| `onClose`   | `() => void`         | yes      | Dismiss                        |

---

### Skeleton (`SubscriptionCardSkeleton`)

**File:** `frontend/src/components/Skeleton.tsx`

Loading placeholder mirroring `SubscriptionCard` (`aria-busy`). Default export is `SubscriptionCardSkeleton` (no props).

---

### Spinner

**File:** `frontend/src/components/Spinner.tsx`

CSS spinner.

| Prop        | Type                   | Required            | Description   |
| ----------- | ---------------------- | ------------------- | ------------- |
| `size`      | `"sm" \| "md" \| "lg"` | no (default `"md"`) | Size class    |
| `className` | `string`               | no                  | Extra classes |

---

### StroopInput

**File:** `frontend/src/components/StroopInput.tsx`

XLM amount input debounced to stroops via `onChange`.

| Prop       | Type                                | Required | Description            |
| ---------- | ----------------------------------- | -------- | ---------------------- |
| `label`    | `string`                            | yes      | Label                  |
| `onChange` | `(stroops: bigint \| null) => void` | yes      | Parsed stroops or null |
| `disabled` | `boolean`                           | no       | Disable input          |

**Hooks:** `useDebounce(300)`  
**Edge cases:** Same min/max/decimal rules as PPU; blur validates immediately.

---

### SubscribeForm

**File:** `frontend/src/components/SubscribeForm.tsx`

New subscription form: merchant, amount, interval; builds and signs subscribe tx.

| Prop           | Type                               | Required | Description            |
| -------------- | ---------------------------------- | -------- | ---------------------- |
| `userKey`      | `string`                           | yes      | Subscriber             |
| `onSign`       | `(xdr: string) => Promise<string>` | yes      | Sign helper            |
| `onSuccess`    | `() => void`                       | yes      | After subscribe        |
| `announce`     | `(message: string) => void`        | yes      | A11y                   |
| `onSubscribed` | `() => void`                       | no       | Extra success callback |

**State:** `merchant`, `amount`, `interval`  
**Hooks:** `useFormValidation`, `useDebounce(merchant, 500)`, `useToast`, `useTransaction`  
**Edge cases:** Async merchant account check; disabled while `pending || validating || !isValid`.

---

### SubscriptionCard

**File:** `frontend/src/components/SubscriptionCard.tsx`

Active subscription summary with pause/resume/cancel, countdown, trial badge, and copy merchant.

Declared `SubscriptionCardProps` plus required `userKey` at the call site:

| Prop           | Type                               | Required | Description                                                    |
| -------------- | ---------------------------------- | -------- | -------------------------------------------------------------- |
| `subscription` | `Subscription`                     | yes      | On-chain subscription                                          |
| `userKey`      | `string`                           | yes      | Subscriber key (`SubscriptionCardProps & { userKey: string }`) |
| `onSign`       | `(xdr: string) => Promise<string>` | yes      | Sign helper                                                    |
| `onRefresh`    | `() => void`                       | yes      | Refresh after mutations                                        |
| `onCancelled`  | `() => void`                       | no       | After cancel                                                   |

**State:** `showPauseConfirm`, `showCancelConfirm`, `cancelLoading`, `cancelStatus`  
**Hooks:** `useSubscriptionSync`, `usePauseResume`, `useRegisterShortcuts`  
**Edge cases:** Trial badge when `now < last_charged + trial_duration`; next charge `"—"` if inactive/paused; cancel uses optimistic `mutate`; shortcut `x` opens cancel.

```tsx
<SubscriptionCard
  subscription={sub}
  userKey={pk}
  onSign={sign}
  onRefresh={refresh}
/>
```

---

### SubscriptionHistory

**File:** `frontend/src/components/SubscriptionHistory.tsx`

Paginated charge history from `charged` events; CSV export; stale-while-revalidate UI.

| Prop      | Type     | Required | Description    |
| --------- | -------- | -------- | -------------- |
| `userKey` | `string` | yes      | Filter address |

**Hooks:** `useContractEvents("charged", userKey)`  
**Edge cases:** Parses nested `_value`; `PAGE_SIZE=20`; explorer links hardcode **testnet**.

---

### SystemHealthCard

**File:** `frontend/src/components/SystemHealthCard.tsx`

Contract health: RPC, pause, token config, active subscription count.

| Prop        | Type     | Required | Description                    |
| ----------- | -------- | -------- | ------------------------------ |
| `callerKey` | `string` | yes      | Caller for `getContractHealth` |

**Edge cases:** Token not configured → yellow; pause → red; retry on error.

---

### TabBar

**File:** `frontend/src/components/TabBar.tsx`

Main nav among dashboard / subscribe / merchant / admin.

| Prop          | Type                 | Required | Description                                           |
| ------------- | -------------------- | -------- | ----------------------------------------------------- |
| `tabs`        | `readonly Tab[]`     | yes      | `"dashboard" \| "subscribe" \| "merchant" \| "admin"` |
| `activeTab`   | `Tab`                | yes      | Current tab                                           |
| `onTabChange` | `(tab: Tab) => void` | yes      | Tab change                                            |

---

### Toast (`ToastContainer`)

**File:** `frontend/src/components/Toast.tsx`

Renders the toast queue; optional explorer link for `txHash`.

| Prop       | Type                   | Required | Description     |
| ---------- | ---------------------- | -------- | --------------- |
| `toasts`   | `Toast[]`              | yes      | From `useToast` |
| `onRemove` | `(id: number) => void` | yes      | Dismiss         |

**Edge cases:** Returns `null` if empty.

---

### WalletBar

**File:** `frontend/src/components/WalletBar.tsx`

Connected wallet strip: address, copy, balance, network, disconnect, tx queue depth.

| Prop           | Type         | Required | Description   |
| -------------- | ------------ | -------- | ------------- |
| `publicKey`    | `string`     | yes      | Connected key |
| `onDisconnect` | `() => void` | yes      | Disconnect    |

**Hooks:** `useTxQueue`  
**Edge cases:** Queue badge only if `queueDepth > 0`.

---

### SubscriptionRepairPanel (admin)

**File:** `frontend/src/components/admin/SubscriptionRepairPanel.tsx`

Admin tool to validate subscription integrity and submit repair transactions.

| Prop       | Type                               | Required | Description                               |
| ---------- | ---------------------------------- | -------- | ----------------------------------------- |
| `adminKey` | `string`                           | yes      | Connected wallet (must be contract admin) |
| `onSign`   | `(xdr: string) => Promise<string>` | yes      | Sign helper                               |

**State:** `userAddress`, `validatedAddress`, `report`, `validationPhase`, `validationError`, `showRepairConfirm`, `repairResultCount`, `subscriptionRefresh`  
**Hooks:** `useAdmin`, `useToast`, `useTransaction`, `useSubscription`  
**Edge cases:** Repair gated by `isAdmin && hasFailures`; phases `idle|loading|success|error`; non-admin warning.

---

## Hooks

| Hook                    | Purpose                                       | Signature (summary)                                                                           | Edge cases                                                     |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `useAccessibility`      | ARIA live-region announcer                    | `() => { announcement, announce }`                                                            | Clears then re-sets via `rAF` so the same message re-announces |
| `useKeyboardShortcuts`  | Global key handlers                           | `(options?) => KeyboardShortcut[]`                                                            | Ignores events in inputs / contentEditable                     |
| `useFocusTrap`          | Trap Tab focus; Esc → `onEscape`              | `(ref, active, onEscape?) => void`                                                            | No-op if inactive or no focusables                             |
| `useErrorBoundary`      | Manual error state for async handlers         | `() => { error, captureError, reset }`                                                        | Does **not** catch render errors                               |
| `useResponsive`         | Breakpoints via `matchMedia`                  | `() => { isMobile, isTablet, isDesktop }`                                                     | Mobile ≤639, tablet 640–1023, desktop ≥1024                    |
| `useContractId`         | Validate `VITE_CONTRACT_ID`                   | `() => { contractId, valid, error }`                                                          | Missing/invalid → empty id, `valid: false`                     |
| `useRpcHealth`          | Poll RPC with backoff / circuit breaker       | `() => UseRpcHealthResult`                                                                    | 3 failures open circuit; latency >2s → `degraded`              |
| `useSubscription`       | Fetch one subscription                        | `(userKey, refreshTrigger?) => { subscription, loading, error, refresh }`                     | Circuit open → `"RPC unavailable"`                             |
| `usePolling`            | Interval callback with fresh ref              | `({ callback, interval, enabled? }) => void`                                                  | Disabled clears interval; no immediate call on mount           |
| `useFormValidation`     | Subscribe-form sync + async validation        | `() => { errors, validate, isValid, validating, validateAsync }`                              | Aborts prior async with `AbortController`                      |
| `useTheme`              | Dark/light via localStorage                   | `() => { theme, toggle }`                                                                     | Default `"dark"`; sets `data-theme` on `<html>`                |
| `useToast`              | Toast queue (auto-dismiss 5s)                 | `() => { toasts, addToast, removeToast }`                                                     | Duplicate messages allowed; default variant `"info"`           |
| `useTransaction`        | Queue + submit signed tx; poll confirmation   | `() => { status, hash, error, submit }`                                                       | Circuit open rejects; 30s poll timeout                         |
| `useWallet`             | Freighter connect / persist / sign            | `() => { publicKey, connect, signAndSubmit, disconnect, error, connecting, ready }`           | Polls Freighter 3×300ms on restore                             |
| `useVirtualList`        | Windowed list (3-row overscan)                | `<T>(items, itemHeight, containerHeight) => { visibleItems, totalHeight, offsetY, onScroll }` | Empty / non-positive heights → empty visible set               |
| `useAnalytics`          | Opt-in event track + batch flush              | `() => { isOptedIn, setOptIn, track }`                                                        | No-op if opted out; flush at 10 events / 5s / hidden           |
| `useNetworkCheck`       | Compare Freighter vs app passphrase           | `() => { networkMatch, walletNetwork }`                                                       | Optimistic `true` before check                                 |
| `usePauseResume`        | Pause/resume txs                              | `(userKey, onSign, onRefresh) => { pause, resume, pauseTx, resumeTx }`                        | Calls `onRefresh` after success                                |
| `useSubscriberCount`    | Active count from subscribed−cancelled events | `() => { count, loading, stale }`                                                             | Caps pages (`MAX_PAGES=50`)                                    |
| `useSubscriptionSync`   | Fetch + optimistic `mutate` with rollback     | `(userKey, refreshTrigger?) => { subscription, loading, status, error, mutate, refresh }`     | Failed cancel rolls optimistic `active: false` back            |
| `useStellarBalance`     | Cached/deduped XLM balance                    | `(address, staleAfterMs?) => UseStellarBalanceResult`                                         | Min fetch interval 5s; module cache                            |
| `useAdmin`              | Compare wallet to on-chain admin              | `(publicKey \| null) => UseAdminResult`                                                       | Null key clears state                                          |
| `useLocalStorage`       | `useState` synced to `localStorage` JSON      | `<T>(key, initial) => [value, setValue]`                                                      | Parse errors → initial                                         |
| `useFreighterAvailable` | Detect `window.freighter` after mount         | `() => { available, installUrl }`                                                             | Starts `false` until effect                                    |
| `useClipboard`          | `navigator.clipboard.writeText`               | `(timeout?) => { copied, error, copy }`                                                       | Failure sets boolean `error`                                   |
| `useContractEvents`     | Fetch/paginate contract events                | `(eventName, address?, maxEvents?) => { events, loading, error, refresh, loadMore, hasMore }` | Keeps last `maxEvents` (default 50)                            |
| `useDebounce`           | Debounce any value                            | `<T>(value, delay?) => T`                                                                     | Clears timer on change/unmount                                 |

Also related: `useRegisterShortcuts` from `frontend/src/context/ShortcutRegistry` (used by Dashboard / SubscriptionCard; not under `hooks/`).

---

## Services

### rpcCache.ts

**File:** `frontend/src/services/rpcCache.ts`

In-flight dedupe + TTL LRU cache for RPC reads (cap 100; default TTL 5s).

| Export                  | Signature                            | Notes                                       |
| ----------------------- | ------------------------------------ | ------------------------------------------- |
| `DEFAULT_TTL_MS`        | `number` (= `5000`)                  | Default cache window                        |
| `dedupedCall`           | `<T>(key, fn, ttlMs?) => Promise<T>` | Concurrent same-key calls share one Promise |
| `_clearCacheForTesting` | `() => void`                         | Tests only                                  |

Failures are not cached. Encode all args in the key (e.g. `"getSubscription:G…"`).

---

### scval.ts

**File:** `frontend/src/services/scval.ts`

Typed Soroban `xdr.ScVal` decoders; throws `ScValDecodeError` on mismatch.

| Export                                                                                                     | Notes                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ScValDecodeError`                                                                                         | Fields `expectedType`, `actualType`                                    |
| `ScValDecoder.decodeI128` / `decodeU64` / `decodeBool` / `decodeAddress` / `decodeString` / `decodeSymbol` | Primitive decoders                                                     |
| `decodeOption` / `decodeVec` / `decodeStruct`                                                              | Composite; `scvVoid` → `null` for options; unknown struct keys skipped |

Prefer for contract read decoding; struct schema keys must match on-chain field names.

---

### txQueue.ts

**File:** `frontend/src/services/txQueue.ts`

Serialize wallet/tx submissions so only one build/sign runs at a time.

| Export               | Signature                                | Notes                          |
| -------------------- | ---------------------------------------- | ------------------------------ |
| `enqueueTransaction` | `<T>(buildAndSign, label) => Promise<T>` | Queue continues after failures |
| `useTxQueue`         | `() => { pendingLabel, queueDepth }`     | Used by `WalletBar`            |

`useTransaction` wraps submits with label `"Transaction"`.

---

## Extending common surfaces

Complexity ranking for the surfaces contributors change most often:

| Rank | Component             | Why                                                                                 |
| ---: | --------------------- | ----------------------------------------------------------------------------------- |
|    1 | **MerchantDashboard** | Virtualized list, multi-source refresh, batch-charge simulation + outcomes, polling |
|    2 | **Dashboard**         | Orchestrates many children, RPC banners, shortcuts, lazy history, refresh counters  |
|    3 | **SubscriptionCard**  | Pause/resume/cancel confirm flow, optimistic mutate, trial badge, shortcut `x`      |

### Adding a field to SubscriptionCard

1. Extend the `Subscription` type in `frontend/src/types` if the value comes from the contract.
2. Ensure `stellar.ts` / `ScValDecoder` decode the new field.
3. Add a `Row` (or badge) in `SubscriptionCard.tsx`; keep formatting helpers next to existing `formatInterval` / trial helpers.
4. Update unit tests under `frontend/src/**/*.test.*` that assert card copy.

### Adding a widget to Dashboard

1. Prefer a child component that takes `userKey`, `onSign`, and a `refreshTrigger` (or its own fetch).
2. Wire state in `Dashboard.tsx` (modal open flags / refresh counters) the same way `DailyLimitCard` and `IncreaseAllowanceModal` are wired.
3. Register any new shortcut via `useRegisterShortcuts` and document it in `ShortcutHelpOverlay` consumers.
4. Keep blockchain builds in `stellar.ts` — do not import the SDK in the new component.

### Extending MerchantDashboard

1. New merchant metrics: fetch beside existing revenue/history effects; bump the shared refresh path used by `usePolling`.
2. Subscriber row fields: adjust `SUBSCRIBER_ROW_HEIGHT` if row layout grows (virtual list assumes fixed height).
3. Batch actions: follow the simulate-then-submit pattern already used for batch charge; surface per-user outcomes in the `outcomes` map.
4. Prefer `useVirtualList` for large subscriber lists rather than rendering the full array.

---

## Related docs

- [FRONTEND.md](./FRONTEND.md) — architecture overview
- [CONTRIBUTING-FRONTEND.md](./CONTRIBUTING-FRONTEND.md) — contribution patterns
- [API.md](./API.md) — contract entry points the UI calls through `stellar.ts`
