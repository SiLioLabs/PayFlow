import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useToast, TOAST_DURATION_MS } from "../hooks/useToast";

describe("useToast hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a toast and auto-dismisses after 5s", () => {
    function Test() {
      const { toasts, addToast } = useToast();
      return (
        <div>
          <button onClick={() => addToast("hello", "info")}>add</button>
          <div data-testid="list">
            {toasts.map((t) => (
              <div key={t.id} data-testid={`toast-${t.id}`}>
                {t.message}
              </div>
            ))}
          </div>
        </div>
      );
    }

    render(<Test />);

    const btn = screen.getByText("add");
    fireEvent.click(btn);

    expect(screen.getByTestId(/toast-/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId(/toast-/)).toBeNull();
  });

  it("allows duplicate messages (unique ids)", () => {
    function Test() {
      const { toasts, addToast } = useToast();
      return (
        <div>
          <button onClick={() => addToast("dup", "info")}>add</button>
          <div data-testid="list">
            {toasts.map((t) => (
              <div key={t.id} data-testid={`toast-${t.id}`}>
                {t.message}
              </div>
            ))}
          </div>
        </div>
      );
    }

    render(<Test />);
    const btn = screen.getByText("add");
    fireEvent.click(btn);
    fireEvent.click(btn);

    const items = screen.getAllByTestId(/toast-/);
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("dup");
    expect(items[1].textContent).toBe("dup");
  });
});

/**
 * Store-level coverage for the WCAG 2.2.2 pause/resume controls, driven
 * directly through the hook API. `Toast.test.tsx` covers the same controls
 * end-to-end through the container; this suite pins the store contract itself,
 * including the defensive paths the container never reaches.
 */
describe("useToast pause/resume controls", () => {
  /** Renders the hook and exposes its controls plus the live toast ids. */
  function renderHookHarness() {
    const api: { current: ReturnType<typeof useToast> } = { current: null! };
    function Test() {
      api.current = useToast();
      return (
        <div>
          <button onClick={() => api.current.addToast("hi", "info")}>add</button>
          <div data-testid="list">
            {api.current.toasts.map((t) => (
              <div key={t.id} data-testid={`toast-${t.id}`}>
                {t.message}
              </div>
            ))}
          </div>
        </div>
      );
    }
    const { unmount } = render(<Test />);
    return { api, unmount };
  }

  const toastCount = () => screen.queryAllByTestId(/toast-/).length;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes pause and resume alongside the existing controls", () => {
    const { api } = renderHookHarness();

    expect(typeof api.current.pauseToast).toBe("function");
    expect(typeof api.current.resumeToast).toBe("function");
  });

  it("holds the countdown while paused and releases the exact remainder", () => {
    const { api } = renderHookHarness();
    fireEvent.click(screen.getByText("add"));
    const id = api.current.toasts[0].id;

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    api.current.pauseToast(id);

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 12);
    });
    expect(toastCount()).toBe(1);

    api.current.resumeToast(id);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(toastCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toastCount()).toBe(0);
  });

  it("treats repeated pauses and resumes as no-ops", () => {
    const { api } = renderHookHarness();
    fireEvent.click(screen.getByText("add"));
    const id = api.current.toasts[0].id;

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Pausing twice must not restart the budget; resuming twice must not
    // schedule a second timer that would dismiss the toast early.
    api.current.pauseToast(id);
    api.current.pauseToast(id);
    api.current.resumeToast(id);
    api.current.resumeToast(id);

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(toastCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toastCount()).toBe(0);
  });

  it("ignores pause and resume for an id that is not showing", () => {
    const { api } = renderHookHarness();

    expect(() => {
      api.current.pauseToast(9999);
      api.current.resumeToast(9999);
    }).not.toThrow();
  });

  it("stops the countdown for a toast removed by hand", () => {
    const { api } = renderHookHarness();
    fireEvent.click(screen.getByText("add"));
    const id = api.current.toasts[0].id;

    act(() => {
      api.current.removeToast(id);
    });
    expect(toastCount()).toBe(0);

    // A leftover timer would try to remove the same id again; nothing should
    // throw and the already-removed toast must not reappear.
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    });
    expect(toastCount()).toBe(0);
  });

  it("does not throw when unmounted with a countdown still running", () => {
    const { unmount } = renderHookHarness();
    fireEvent.click(screen.getByText("add"));

    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(10000);
      });
    }).not.toThrow();
  });
});
