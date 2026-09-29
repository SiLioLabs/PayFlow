import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useToast, TOAST_DURATION_MS } from "../hooks/useToast";
import type { Toast } from "../hooks/useToast";
import ToastContainer from "../components/Toast";

/**
 * Renders the real store wired to the real container, so these tests exercise the
 * whole WCAG 2.2.2 path (pointer/keyboard event -> store -> countdown) rather
 * than a stubbed seam.
 */
function Harness({
  isPaused = false,
  variant = "error",
}: {
  isPaused?: boolean;
  variant?: "error" | "info";
}) {
  const { toasts, addToast, removeToast, pauseToast, resumeToast } = useToast();
  return (
    <div>
      <button onClick={() => addToast("Transfer failed", variant)}>notify</button>
      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onPause={pauseToast}
        onResume={resumeToast}
        isPaused={isPaused}
      />
    </div>
  );
}

function notify(): HTMLElement {
  fireEvent.click(screen.getByText("notify"));
  return screen.getByText("Transfer failed").closest(".toast") as HTMLElement;
}

function dismissButton(): HTMLElement {
  return screen.getByRole("button", { name: /dismiss notification/i });
}

/** Drives `document.visibilityState` and fires the event the store listens for. */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  act(() => {
    fireEvent(document, new Event("visibilitychange"));
  });
}

/**
 * Report a blur for `el` that says where focus went, so the container can tell
 * "focus left this toast" from "focus moved to a sibling control inside it".
 *
 * Two details matter here:
 *  - `bubbles: true` is required. The `FocusEvent` constructor defaults it to
 *    false, and React only ever sees a `focusout` that reaches its root
 *    listener, so a non-bubbling event would silently fire no handler at all.
 *  - Only the event is dispatched. Calling `el.blur()` as well would emit a
 *    second `focusout` with a null relatedTarget, which the container correctly
 *    reads as focus having left the toast.
 */
function fireOut(el: HTMLElement, relatedTarget: HTMLElement | null) {
  act(() => {
    fireEvent(el, new FocusEvent("focusout", { relatedTarget, bubbles: true }));
  });
}

/** Advance the clock without leaving React's act() scope. */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("ToastContainer WCAG 2.2.2 timing controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    // Restore the jsdom default so ordering between suites cannot leak.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("auto-dismisses after the duration when untouched", () => {
    render(<Harness />);
    notify();

    tick(TOAST_DURATION_MS - 1);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    tick(1);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("pauses the countdown on pointer hover", () => {
    render(<Harness />);
    const toast = notify();

    fireEvent.mouseOver(toast);
    tick(TOAST_DURATION_MS * 4);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    fireEvent.mouseOut(toast);
    tick(TOAST_DURATION_MS);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("keeps the remaining time across a hover pause instead of restarting it", () => {
    render(<Harness />);
    const toast = notify();

    // Burn 2s of the budget, then park the pointer on the toast.
    tick(2000);
    fireEvent.mouseOver(toast);

    // Paused for far longer than the original duration.
    tick(TOAST_DURATION_MS * 10);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    fireEvent.mouseOut(toast);

    // Only the untouched 3s of budget should remain, not a fresh 5s.
    tick(2999);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    tick(1);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("pauses the countdown while the toast holds keyboard focus", () => {
    render(<Harness />);
    notify();

    const dismiss = dismissButton();
    dismiss.focus();
    expect(dismiss).toHaveFocus();

    tick(TOAST_DURATION_MS * 4);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    // Focus leaves the toast -> countdown resumes.
    fireOut(dismiss, document.body);
    tick(TOAST_DURATION_MS);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("pauses when any control inside the toast takes focus", () => {
    render(<Harness />);
    notify();

    dismissButton().focus();
    tick(TOAST_DURATION_MS * 3);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();
  });

  it("does not resume when focus moves between controls inside the same toast", () => {
    render(<Harness />);
    notify();

    const dismiss = dismissButton();
    dismiss.focus();
    tick(1000);

    // A blur/focus round trip whose focus stays inside the same toast must not
    // restart the clock.
    fireOut(dismiss, dismiss);
    dismiss.focus();

    tick(TOAST_DURATION_MS * 3);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();
  });

  it("dismisses manually with a pointer click", () => {
    render(<Harness />);
    notify();

    fireEvent.click(dismissButton());

    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("dismisses manually from the keyboard", () => {
    // jsdom does not synthesise a click from Enter/Space on a <button>; browsers
    // do. So the guarantees are asserted structurally: the control is a real
    // focusable <button> (hence Enter/Space operable) with an accessible name,
    // it can hold focus, and its activation removes the toast.
    render(<Harness />);
    notify();

    const dismiss = dismissButton();
    expect(dismiss.tagName).toBe("BUTTON");
    expect(dismiss).toHaveAttribute("type", "button");
    expect(dismiss).toHaveAccessibleName("Dismiss notification");

    // Reachable by keyboard: not tabindex=-1, not aria-hidden, not disabled.
    expect(dismiss).not.toHaveAttribute("tabindex", "-1");
    expect(dismiss).not.toHaveAttribute("aria-hidden");
    expect(dismiss).not.toBeDisabled();

    dismiss.focus();
    expect(dismiss).toHaveFocus();

    // Activation while focused (what Enter/Space performs in a browser).
    fireEvent.click(dismiss);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("dismisses each toast independently", () => {
    render(<Harness />);
    const first = notify();
    fireEvent.click(screen.getByText("notify"));
    expect(screen.getAllByText("Transfer failed")).toHaveLength(2);

    fireEvent.click(first.querySelector("button") as HTMLElement);

    expect(screen.getAllByText("Transfer failed")).toHaveLength(1);
  });

  it("announces messages in a polite live region", () => {
    render(<Harness />);
    notify();

    const container = screen.getByTestId("toast-container");
    expect(container).toHaveAttribute("role", "status");
    expect(container).toHaveAttribute("aria-live", "polite");
  });

  it("keeps messages when the tab is backgrounded and dismisses them after return", () => {
    render(<Harness />);
    notify();

    tick(2000);
    setVisibility("hidden");

    // Time passes while the user is elsewhere, well past the full duration.
    tick(TOAST_DURATION_MS * 10);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    setVisibility("visible");

    tick(TOAST_DURATION_MS);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("preserves the remaining time across a backgrounded tab", () => {
    render(<Harness />);
    notify();

    tick(2000);
    setVisibility("hidden");
    tick(TOAST_DURATION_MS * 10);
    setVisibility("visible");

    // 3s of untouched budget, not a fresh 5s.
    tick(2999);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    tick(1);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("queues a toast that arrives while the tab is already hidden", () => {
    render(<Harness />);
    setVisibility("hidden");

    notify();
    tick(TOAST_DURATION_MS * 3);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    setVisibility("visible");
    tick(TOAST_DURATION_MS);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("stays suspended while hidden, overriding pointer and focus resumes", () => {
    render(<Harness />);
    const toast = notify();

    setVisibility("hidden");
    // Leaving the pointer on a backgrounded toast must not resume anything.
    fireEvent.mouseOut(toast);
    fireOut(dismissButton(), document.body);

    tick(TOAST_DURATION_MS * 2);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();
  });

  it("suspends the countdown while the window is unfocused", () => {
    render(<Harness />);
    notify();

    fireEvent(window, new Event("blur"));
    tick(TOAST_DURATION_MS * 3);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();

    fireEvent(window, new Event("focus"));
    tick(TOAST_DURATION_MS);
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("stops the pending timer when a toast is dismissed by hand", () => {
    render(<Harness />);
    notify();

    fireEvent.click(dismissButton());
    tick(TOAST_DURATION_MS * 3);

    // No late timer should resurrect state or throw after unmount.
    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });

  it("keeps error toasts rendered while the contract is paused", () => {
    // The contract-pause filter only suppresses informational toasts, so an
    // error must still surface (and stay dismissible) while paused.
    render(<Harness isPaused />);
    notify();

    expect(screen.getByText("Transfer failed")).toBeInTheDocument();
    expect(dismissButton()).toBeInTheDocument();
  });

  it("suppresses informational toasts while the contract is paused", () => {
    render(<Harness isPaused variant="info" />);
    fireEvent.click(screen.getByText("notify"));

    expect(screen.queryByText("Transfer failed")).not.toBeInTheDocument();
  });
});

/**
 * The container's own pause/resume contract, asserted against spy props.
 * These pin *which* lifecycle events map to which store call — the integrated
 * suite above cannot distinguish a resume-then-immediate-repause from a correct
 * pause, but here the exact call sequence is observable.
 */
describe("ToastContainer pause/resume contract", () => {
  function toasts(): Toast[] {
    return [
      { id: 7, message: "Transfer failed", variant: "error", txHash: "b".repeat(64) },
      { id: 9, message: "Subscribed", variant: "success", txHash: "a".repeat(64) },
    ];
  }

  function renderContainer() {
    const onRemove = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    render(
      <ToastContainer toasts={toasts()} onRemove={onRemove} onPause={onPause} onResume={onResume} />
    );
    return { onRemove, onPause, onResume };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when the queue is empty", () => {
    const { container } = render(
      <ToastContainer toasts={[]} onRemove={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one labelled dismiss control per toast", () => {
    renderContainer();
    expect(screen.getAllByRole("button", { name: /dismiss notification/i })).toHaveLength(2);
  });

  it("removes the toast matching the pressed dismiss control", () => {
    const { onRemove } = renderContainer();

    fireEvent.click(screen.getAllByRole("button", { name: /dismiss notification/i })[1]);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(9);
  });

  it("maps pointer hover to pause and resume", () => {
    const { onPause, onResume } = renderContainer();
    const toast = screen.getByText("Transfer failed").closest(".toast") as HTMLElement;

    fireEvent.mouseOver(toast);
    expect(onPause).toHaveBeenCalledWith(7);

    fireEvent.mouseOut(toast);
    expect(onResume).toHaveBeenCalledWith(7);
  });

  it("pauses when focus enters a toast and resumes when focus leaves it", () => {
    const { onPause, onResume } = renderContainer();
    const dismiss = screen.getAllByRole("button", { name: /dismiss notification/i })[0];

    dismiss.focus();
    expect(onPause).toHaveBeenCalledWith(7);

    fireOut(dismiss, document.body);
    expect(onResume).toHaveBeenCalledWith(7);
  });

  it("does not resume when focus moves to a sibling control inside the same toast", () => {
    const { onPause, onResume } = renderContainer();
    const firstToast = screen.getByText("Transfer failed").closest(".toast") as HTMLElement;
    // Scoped to the same toast: the dismiss button and the transaction link are
    // siblings, which is the only case the guard is about.
    const dismiss = within(firstToast).getByRole("button", { name: /dismiss notification/i });
    const txLink = within(firstToast).getByRole("link");

    dismiss.focus();
    onPause.mockClear();

    // Tab from the dismiss button onto the transaction link in the same toast:
    // a blur is reported, but the toast never stopped being read, so the clock
    // must not be released. (onPause *is* re-asserted on the way in, which is
    // harmless - pausing an already-paused timer is a no-op.)
    fireOut(dismiss, txLink);
    txLink.focus();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("does not fire pause or resume for a toast that was only rendered", () => {
    const { onPause, onResume } = renderContainer();

    tick(1);

    expect(onPause).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("leaves no countdown running once a toast is dismissed by hand", () => {
    // A dismissed toast must not keep a live timer: when it eventually fires it
    // would run a state update against an id that no longer exists, which shows
    // up here as a spurious re-render of the queue owner.
    let renders = 0;
    function CountingHarness() {
      renders += 1;
      const { toasts, addToast, removeToast, pauseToast, resumeToast } = useToast();
      return (
        <div>
          <button onClick={() => addToast("Transfer failed", "error")}>notify</button>
          <ToastContainer
            toasts={toasts}
            onRemove={removeToast}
            onPause={pauseToast}
            onResume={resumeToast}
          />
        </div>
      );
    }
    render(<CountingHarness />);
    notify();

    fireEvent.click(dismissButton());
    const rendersAfterDismiss = renders;

    tick(TOAST_DURATION_MS * 4);

    expect(renders).toBe(rendersAfterDismiss);
  });

  it("clears pending countdowns when the queue owner unmounts", () => {
    const { unmount } = render(<Harness />);
    notify();

    unmount();

    // Nothing is left to render into, and nothing should throw.
    expect(() => tick(TOAST_DURATION_MS * 4)).not.toThrow();
  });
});
