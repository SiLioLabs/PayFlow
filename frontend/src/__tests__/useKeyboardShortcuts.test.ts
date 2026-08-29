import { fireEvent, renderHook } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

describe("useKeyboardShortcuts", () => {
  it("calls the registered action when the matching key is pressed", () => {
    const action = vi.fn();

    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{ key: "k", description: "Test action", action }],
      })
    );

    fireEvent.keyDown(window, { key: "k" });

    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does nothing when an unregistered key is pressed", () => {
    const action = vi.fn();

    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{ key: "k", description: "Test action", action }],
      })
    );

    fireEvent.keyDown(window, { key: "x" });

    expect(action).not.toHaveBeenCalled();
  });

  it("does not trigger shortcuts when enabled is false", () => {
    const action = vi.fn();

    renderHook(() =>
      useKeyboardShortcuts({
        enabled: false,
        shortcuts: [{ key: "k", description: "Test action", action }],
      })
    );

    fireEvent.keyDown(window, { key: "k" });

    expect(action).not.toHaveBeenCalled();
  });

  it("cleans up the global key listener on unmount", () => {
    const action = vi.fn();

    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{ key: "k", description: "Test action", action }],
      })
    );

    unmount();

    fireEvent.keyDown(window, { key: "k" });

    expect(action).not.toHaveBeenCalled();
  });
});
