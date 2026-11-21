# Contributing to PayFlow — Frontend

This guide covers developer setup, coding conventions, testing guidelines, styling standards, and accessibility requirements for contributing to the PayFlow web application.

> **Architecture Guide**: For application architecture, data flow, `stellar.ts` design, and provider hierarchies, see [`docs/FRONTEND.md`](FRONTEND.md).  
> **Component Reference**: For component prop signatures, types, and component-level APIs, see [`docs/FRONTEND-COMPONENTS.md`](FRONTEND-COMPONENTS.md).  
> **Component Inventory**: For the canonical vs. unmounted component map and single-source validation rules, see [`docs/frontend/COMPONENTS.md`](frontend/COMPONENTS.md).

---

## Table of Contents

- [Local Development Setup](#local-development-setup)
- [Component Authoring Guidelines](#component-authoring-guidelines)
- [Hook Authoring Conventions](#hook-authoring-conventions)
- [Testing with Vitest & React Testing Library](#testing-with-vitest--react-testing-library)
  - [What to Test](#what-to-test)
  - [Example Test Snippet](#example-test-snippet)
  - [Running Tests](#running-tests)
- [Styling & CSS Design Tokens](#styling--css-design-tokens)
- [Accessibility Requirements (a11y)](#accessibility-requirements-a11y)
- [Pull Request Checklist](#pull-request-checklist)
- [Related Documentation](#related-documentation)

---

## Local Development Setup

### Prerequisites
- Node.js 18+ (Node 20+ recommended)
- npm 9+
- A Stellar wallet browser extension for testing (Freighter recommended)

### Quick Start

```bash
# 1. Navigate to the frontend workspace
cd frontend

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your VITE_CONTRACT_ID and VITE_NETWORK_PASSPHRASE

# 4. Start the Vite development server
npm run dev

# 5. Execute test suites and typecheck
npm test
npm run typecheck
```

### Common Scripts

| Command | Action |
| --- | --- |
| `npm run dev` | Starts local dev server at `http://localhost:5173` with HMR |
| `npm run build` | Compiles TypeScript and builds production assets to `dist/` |
| `npm test` | Runs Vitest test suites |
| `npm run lint` | Runs ESLint static analysis |
| `npm run format` | Formats codebase with Prettier |
| `npm run typecheck` | Runs `tsc --noEmit` to verify type safety |

---

## Component Authoring Guidelines

All UI components live under `frontend/src/components/` (or `frontend/src/components/admin/`).

### Rules of Thumb

1. **Keep Components Presentational**: Components should focus on rendering JSX and receiving user interactions. Business logic, timers, and polling belong in hooks.
2. **Never Call Stellar SDK Directly**: Components must **never** import `@stellar/stellar-sdk`. Route all blockchain state queries and transaction building through hooks that consume `src/stellar.ts`.
3. **Use Memoization Judiciously**: Prefer derived values via `useMemo` for computationally expensive transforms or object/array prop stability.
4. **Avoid Render Side Effects**: Never trigger asynchronous network requests directly within a component's render body; use `useEffect` or hook action handlers.

### Recommended Pattern

```tsx
import { useMemo } from "react";
import type { FC } from "react";

type Props = {
  title: string;
  onAction?: () => void;
};

export const MyComponent: FC<Props> = ({ title, onAction }) => {
  const heading = useMemo(() => title.trim(), [title]);

  return (
    <section className="card" aria-label="my-component">
      <h2>{heading}</h2>
      {onAction && (
        <button type="button" className="btn-primary" onClick={onAction}>
          Execute Action
        </button>
      )}
    </section>
  );
};
```

---

## Hook Authoring Conventions

Custom hooks live under `frontend/src/hooks/` and encapsulate business logic, subscription sync, and contract mutations.

### Naming
- Use standard React hook naming (`useSomething`).
- Name hooks around the resource or workflow they manage (e.g. `useWallet`, `useSubscriptionSync`, `useDailyLimit`).

### Return Shape
Return a stable, predictable object separating state values and callable action functions:

```ts
type UseResourceReturn = {
  data: Resource | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  submit: (params: SubmitParams) => Promise<string>;
};
```

### Effect Boundaries & Cleanup
- Always clear listeners (timers, interval polls, window events, wallet subscribers) in `useEffect` cleanup callbacks.
- Prevent stale closures by including referenced state/functions in dependency arrays or wrapping returned callbacks with `useCallback`.
- Centralize network calls to prevent duplicate requests across sibling components.

---

## Testing with Vitest & React Testing Library

Frontend testing is powered by [Vitest](https://vitest.dev/) with `jsdom` and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro).

- **Config**: `frontend/vitest.config.ts`
- **Global Setup**: `frontend/src/setupTests.ts`

### What to Test
- Component rendering and state changes in response to user events.
- Error and recovery UI display.
- Form validation error messaging (e.g. invalid addresses or amount boundaries).
- Accessibility attributes (ARIA roles, keyboard operability, accessible names).

### Example Test Snippet

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MyComponent } from "../MyComponent";

describe("MyComponent", () => {
  it("renders the heading and handles clicks", async () => {
    const handleAction = vi.fn();
    const user = userEvent.setup();

    render(<MyComponent title="Subscription Manager" onAction={handleAction} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Subscription Manager"
    );

    const button = screen.getByRole("button", { name: /execute action/i });
    await user.click(button);

    expect(handleAction).toHaveBeenCalledTimes(1);
  });
});
```

### Running Tests

```bash
# Run all frontend tests
cd frontend && npm test

# Run a specific test file
cd frontend && npm test -- src/__tests__/SubscribeForm.test.tsx
```

---

## Styling & CSS Design Tokens

The application uses vanilla CSS design tokens defined in `frontend/src/index.css`.

### Guidelines
- **Use Tokens**: Always use `var(--token-name)` instead of hardcoded hex colors or pixel sizes.
- **Theme Awareness**: Styles must support both default dark mode (`:root`) and light mode (`[data-theme="light"]`).
- **Standard Tokens**:
  - Colors: `--color-primary`, `--color-success`, `--color-danger`, `--color-warning`, `--color-bg`, `--color-surface`
  - Spacing: `--space-1`, `--space-2`, `--space-4`, `--space-6`
  - Typography: `--font-family`, `--text-sm`, `--text-base`, `--text-lg`
  - Radii: `--radius-sm`, `--radius-md`, `--radius-lg`
- **Screen Reader Utility**: Use `.sr-only` for visually hidden text intended for assistive technology.

---

## Accessibility Requirements (a11y)

All frontend components must be accessible (WCAG AA compliant):

1. **Keyboard Operability**:
   - Every interactive element must be reachable and operable via keyboard.
   - Do not use clickable `<div>` elements; use `<button>` or `<a>`.
   - Never remove visible focus outlines (`:focus-visible`).
2. **Accessible Names**:
   - Every form input must have a corresponding `<label htmlFor="...">` or `aria-label`.
   - Buttons containing only icons must have an `aria-label`.
3. **Modal Focus Management**:
   - Modals must trap focus while open (via `useFocusTrap`).
   - Pressing the Escape key must dismiss the modal.
4. **Dynamic Announcements**:
   - Asynchronous status updates and network state changes must be announced through the ARIA live region (`useAccessibility().announce`).

---

## Pull Request Checklist

Before submitting a frontend PR, confirm:

- [ ] **Architecture**: Components do not import `@stellar/stellar-sdk` directly; all on-chain logic uses `src/stellar.ts`.
- [ ] **Single Source of Truth**: Validation rules and limits respect `constants.ts` and `useFormValidation.ts`.
- [ ] **Tests**: Added or updated Vitest + RTL tests covering new behavior.
- [ ] **Styling**: Styling uses CSS custom properties (`var(--*)`) and renders correctly in light and dark themes.
- [ ] **Accessibility**: Interactive elements are keyboard navigable and properly labeled for screen readers.
- [ ] **Quality Gates**: `npm run lint`, `npm run typecheck`, and `npm test` pass with zero errors.

---

## Related Documentation

| Document | Purpose |
| --- | --- |
| [`docs/FRONTEND.md`](FRONTEND.md) | High-level frontend architecture, data flow, and provider tree |
| [`docs/FRONTEND-COMPONENTS.md`](FRONTEND-COMPONENTS.md) | Component API specifications, prop types, and usage examples |
| [`docs/frontend/COMPONENTS.md`](frontend/COMPONENTS.md) | Component inventory, canonical status, and validation rule owners |
| [`docs/LIMITS.md`](LIMITS.md) | Admin batch operation caps and contract limits |
