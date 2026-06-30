# Contributing to FlowPay — Frontend

This guide helps contributors add new React components/hooks and ship changes safely.

---

## Component file structure

Frontend code lives under `frontend/src/`.

### Folder conventions

- `frontend/src/components/`
  - UI components (rendering + user interactions)
  - Typically **no** direct blockchain calls (see `stellar.ts` rule below)
- `frontend/src/hooks/`
  - Reusable logic: state, effects, formatting of contract data, calling hooks/services
  - Components compose hooks
- `frontend/src/services/`
  - Shared non-React utilities (RPC caching, request queues, etc.)
- `frontend/src/stellar.ts`
  - **Single entry point** for all contract interactions

### Recommended component pattern

Keep components focused: receive data via props, call hooks for logic, and render markup.

**Example**: `frontend/src/components/MyComponent.tsx`

```tsx
import { useMemo } from "react";
import type { FC } from "react";

type Props = {
  title: string;
};

export const MyComponent: FC<Props> = ({ title }) => {
  const heading = useMemo(() => title.trim(), [title]);

  return (
    <section aria-label="my-component">
      <h2>{heading}</h2>
    </section>
  );
};
```

**Rules of thumb**
- Prefer small components (one responsibility).
- Prefer derived values via `useMemo`.
- Avoid side effects in render (no async calls directly in the component body).
- Do not import `@stellar/stellar-sdk` directly from components.
- If you need contract data or tx submission, add/extend a hook that uses `stellar.ts`.

---

## Hook conventions

Hooks under `frontend/src/hooks/` should follow consistent conventions so contributors can compose them confidently.

### Naming
- Use the React hook naming convention: `useSomething`.
- If a hook manages a resource, name it around the resource: `useWallet`, `useSubscriptions`, `useContractEvents`.

### Return shape
Prefer a clear, stable return object containing:

- state values (e.g. `loading`, `error`, `data`)
- action functions (e.g. `refresh`, `submit`, `cancel`)

Example shape:

```ts
type UseXReturn = {
  data: X | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};
```

Guidelines:
- Keep return keys stable; avoid reordering or conditional return types.
- For async actions, either:
  - return a Promise directly from the action function, or
  - expose `loading`/`error` updated by the action.

### Cleanup & effects
- If you attach listeners (window events, timers, subscriptions), always remove them in `useEffect` cleanup.
- Avoid stale closures: put functions in dependency arrays or use `useCallback` when returning callbacks.
- Do not start network requests in multiple places; centralize in hooks and expose `refresh`/`sync` actions.

### Side-effect boundary
- Components should be mostly presentational.
- Hooks should own side effects:
  - `useEffect` for subscriptions/polling
  - calling `stellar.ts` via service functions

---

## Testing with Vitest + React Testing Library (RTL)

Frontend tests use Vitest configured with `jsdom` and RTL helpers.

- Vitest config: `frontend/vitest.config.ts`
- RTL setup: `frontend/src/setupTests.ts`

### What to test
- Component behavior that depends on props/state
- Hook behavior that exposes actions/state (prefer testing the resulting UI)
- Accessibility-critical UI: buttons/inputs have labels and interactive elements are reachable

### Example test snippet

**Component test**: `frontend/src/components/__tests__/MyComponent.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";

import { MyComponent } from "../MyComponent";

describe("MyComponent", () => {
  it("renders the title", () => {
    render(<MyComponent title="  Hello  " />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Hello");
  });

  it("is keyboard operable (example)", async () => {
    // If your component includes buttons/links, prefer testing keyboard interaction.
    const user = userEvent.setup();

    render(<button aria-label="example">Click</button>);
    await user.tab();
    await user.keyboard("{Enter}");
  });
});
```

Notes:
- Prefer queries by role/label/text (`getByRole`, `getByLabelText`) rather than `getByTestId`.
- For async UI, use `await screen.findBy*` or `await waitFor(...)`.

### Running tests

From repo root:

```bash
cd frontend
npm test
```

---

## CSS custom properties usage

The app uses CSS custom properties (design tokens) defined in `frontend/src/index.css`.

### Required conventions
- Use tokens via `var(--token-name)` instead of hard-coded colors/sizes.
- Prefer existing tokens (`--color-*`, `--space-*`, `--text-*`, `--radius-*`, `--transition-*`).
- For theme-aware styling, ensure your CSS works with:
  - `:root` (default)
  - `[data-theme="light"]` overrides

### Styling components
- Use existing utility classes/util patterns where possible.
- If you introduce new styles, keep them token-based (no hard-coded theme-dependent values).

### Accessibility-related CSS utilities
- Use the `.sr-only` utility class for non-visual text when necessary (e.g., describing status changes).

---

## Accessibility requirements (ARIA, keyboard nav)

Frontend changes must remain accessible.

### Interaction & keyboard navigation
- Every interactive element must be reachable and operable via keyboard:
  - Buttons should be `<button>` (not clickable `<div>`).
  - Links should be `<a href=...>`.
- Visible focus is required for keyboard users. If you style focus, do not remove it.

### Labels & ARIA
- Form controls must have accessible names:
  - `label` + `htmlFor` (preferred)
  - or `aria-label` / `aria-labelledby`
- Use ARIA only when native semantics are insufficient.
- For dynamic status updates, prefer:
  - `role="status"` / `aria-live="polite"`
  - and/or existing patterns such as the accessibility announcement hook.

### Modal/dialog requirements
- Ensure modal content is:
  - labeled (e.g., `aria-labelledby`)
  - keyboard dismissible per existing behavior
  - does not trap focus incorrectly (follow existing modal component patterns)

### Practical checklist
Before merging, verify:
- [ ] Interactive controls have accessible names
- [ ] Keyboard users can reach all actions
- [ ] Images/icons have appropriate `aria-label` or are marked decorative
- [ ] Screen reader users get meaningful announcements for important state changes

---

## PR checklist for frontend changes

Before opening a PR, confirm:

### Code & architecture
- [ ] Components do not import `@stellar/stellar-sdk` directly
- [ ] Contract interactions go through `src/stellar.ts` (via hooks/services)
- [ ] New hooks follow conventions (stable return shape, cleanup of side effects)

### Tests
- [ ] Added/updated Vitest + RTL tests for new or changed behavior
- [ ] Queries in tests prefer role/label/text

### Styling
- [ ] New styles use CSS custom properties (`var(--*)`)
- [ ] Theme-aware styling works with `[data-theme="light"]`

### Accessibility
- [ ] Keyboard navigation works for all new interactive UI
- [ ] ARIA/labels are correct (no unlabeled controls)

### CI / quality gates
- [ ] `npm run lint` passes
- [ ] `npm run format` (Prettier) has been applied
- [ ] `npm run build` passes

---

## Reference: Frontend architecture

For architectural background (hook composition, `stellar.ts` responsibilities), see:
- `docs/FRONTEND.md`

