import { fireEvent, renderHook } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

// ── useKeyboardShortcuts ──────────────────────────────────────────────────────

describe("useKeyboardShortcuts", () => {
  it("calls the registered action when the matching key is pressed", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "k", description: "Test action", action }] })
    );
    fireEvent.keyDown(window, { key: "k" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does nothing when an unregistered key is pressed", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "k", description: "Test action", action }] })
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
      useKeyboardShortcuts({ shortcuts: [{ key: "k", description: "Test action", action }] })
    );
    unmount();
    fireEvent.keyDown(window, { key: "k" });
    expect(action).not.toHaveBeenCalled();
  });

  // ── Disabled in input / textarea / contentEditable ───────────────────────

  it("does not fire shortcut when target is an INPUT element", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "n", description: "New", action }] })
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "n" });
    document.body.removeChild(input);
    expect(action).not.toHaveBeenCalled();
  });

  it("does not fire shortcut when target is a TEXTAREA element", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "r", description: "Refresh", action }] })
    );
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(ta, { key: "r" });
    document.body.removeChild(ta);
    expect(action).not.toHaveBeenCalled();
  });

  // ── Each key fires its action ─────────────────────────────────────────────

  it("fires ? shortcut action", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "?", description: "Help", action }] })
    );
    fireEvent.keyDown(window, { key: "?" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("fires n shortcut action", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "n", description: "New Subscription", action }] })
    );
    fireEvent.keyDown(window, { key: "n" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("fires r shortcut action", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "r", description: "Refresh", action }] })
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("fires 1 shortcut action (Subscriber tab)", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "1", description: "Subscriber tab", action }] })
    );
    fireEvent.keyDown(window, { key: "1" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("fires 2 shortcut action (Merchant tab)", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "2", description: "Merchant tab", action }] })
    );
    fireEvent.keyDown(window, { key: "2" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("fires 3 shortcut action (Admin tab)", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "3", description: "Admin tab", action }] })
    );
    fireEvent.keyDown(window, { key: "3" });
    expect(action).toHaveBeenCalledTimes(1);
  });
});
