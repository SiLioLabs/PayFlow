# FlowPay Frontend Accessibility Manual Test Checklist

This checklist provides a structured guide for manual verification of accessibility (a11y), high contrast mode, reduced motion, keyboard navigation, and screen reader announcements across the FlowPay dApp.

---

## 1. High Contrast / Forced Colors Mode (`@media (forced-colors: active)`)

Test on Windows with **Contrast Themes** (Aquatic, Desert, Dusk, Night Sky) enabled, or Chromium DevTools (`Emulate CSS media feature forced-colors: active`).

### Badges
- [ ] **Status Badges (`.badge`, `.mst-status-badge`)**:
  - Outlines/borders are distinctly visible against the background (using system colors: `CanvasText`, `Highlight`, `LinkText`).
  - Active/healthy subscriptions show a distinct solid border (`Highlight`).
  - Overdue/failed/cancelled states show a distinct high-contrast border (`LinkText`).
  - Warning/grace-period states show a distinct dashed border (`Highlight`).
- [ ] **Network Badge**:
  - Testnet / Mainnet indicator text and border remain legible and clearly demarcated from surrounding container elements.
- [ ] **Allowance Health Badge**:
  - Border and indicator state clearly convey whether allowance is sufficient, low, or zero.
- [ ] **TxQueue Badge**:
  - Pending transaction count badge has visible border and text contrast.

### Buttons & Controls
- [ ] **Button Variants (`.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-info`)**:
  - Buttons render with an explicit 1px solid `ButtonText` border.
  - Hover/focus states visibly update border to `Highlight`.
  - Disabled buttons render with `GrayText` borders and text, preventing confusion with active buttons.
- [ ] **Inputs & Selects**:
  - Text fields and dropdowns have explicit visible borders (`1px solid CanvasText` / system border).
  - Selected options and placeholders maintain high contrast readability.

### Focus Indicators
- [ ] **Keyboard Focus Indicators**:
  - All interactive elements (`<button>`, `<input>`, `<select>`, `<a>`, `[tabindex]`) display a 3px solid `Highlight` outline with `2px outline-offset`.
  - Focus outlines are never clipped by `overflow: hidden` on cards or tables.

---

## 2. Motion & Transitions Audit (`@media (prefers-reduced-motion: reduce)`)

Test with system setting **Reduce Motion** enabled, or Chromium DevTools (`Emulate CSS media feature prefers-reduced-motion: reduce`).

### Sparkline (`RevenueSparkline`)
- [ ] Hover and focus point expansion (`r: 3 -> 5`) transitions are disabled or instantaneous (`transition: none`).
- [ ] Focus outlines on sparkline points do not trigger disorienting motion.

### Global Animations & Skeletons
- [ ] Shimmer gradient animation on `.skeleton` elements is disabled; elements render as static solid surface placeholders.
- [ ] Modal entrance animations (`modal-enter`, `fadeIn`) are disabled; modals open instantly without zoom or fade-in transitions.
- [ ] Button hover background/color transitions are instantaneous.
- [ ] Toast notifications appear immediately without sliding/fading animation.

---

## 3. Keyboard Navigation & Focus Management

- [ ] **Logical Tab Order**:
  - Tab order flows predictably from top to bottom, left to right.
  - Header -> Wallet Connection / Bar -> Tab Navigation -> Main Content -> Actions.
- [ ] **Modal Focus Traps**:
  - Opening any modal (`WalletSelectModal`, `DailyLimitModal`, `IncreaseAllowanceModal`, `TransferSubscriptionModal`, `AddressBook`) traps focus within the modal.
  - Pressing `Tab` cycles only through interactive elements inside the modal.
  - Pressing `Escape` closes the modal and returns focus to the trigger button that opened it.
- [ ] **Tab Bar**:
  - Keyboard arrow keys (Left/Right) or Tab allow selecting tabs (`Dashboard`, `Subscribe`, `Merchant`, `Admin`).
  - Active tab is marked with `aria-selected="true"`.

---

## 4. Screen Reader Announcements & ARIA Attributes

Test with NVDA (Windows), VoiceOver (macOS / iOS), or Orca (Linux).

- [ ] **Live Regions (`aria-live="polite"`)**:
  - Wallet connection status changes ("Connected with Freighter...", "Disconnected") are announced.
  - Network connectivity changes ("Back online...", "You are offline...") are announced.
  - Form submission status and error alerts are announced.
- [ ] **Form Labels & Error Messages**:
  - Every form input has an associated `<label>` (either via `htmlFor` or `aria-label`).
  - Validation errors link to inputs via `aria-describedby` and specify `aria-invalid="true"`.
- [ ] **Data Tables (`MerchantSubscriberTable`)**:
  - Column headers have `scope="col"` and announce sorting state (`aria-sort`).
- [ ] **Sparkline Accessible Alternative**:
  - `RevenueSparkline` includes a visually hidden table (`#revenue-data-table` with `.sr-only`) containing tabular daily revenue numbers for screen readers.

---

## 5. Automated Verification Sign-off

- [ ] `node scripts/contrast-check.mjs` exits 0 (all color pairs meet WCAG 2.1 AA 4.5:1).
- [ ] Vitest unit a11y tests (`jest-axe`) pass with zero violations on all primary components and modals.
- [ ] Playwright E2E browser flows (connect, subscribe, pause, cancel) execute without accessibility blocking issues.
