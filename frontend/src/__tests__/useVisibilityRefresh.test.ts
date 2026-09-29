import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useVisibilityRefresh,
  DEFAULT_VISIBILITY_COOLDOWN_MS,
} from "../hooks/useVisibilityRefresh";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useVisibilityRefresh", () => {
  it("calls the callback on visibilitychange to visible", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityRefresh(cb));
    setVisibility("hidden");
    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("calls the callback on window focus", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityRefresh(cb));
    window.dispatchEvent(new Event("focus"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("suppresses events within the cooldown window", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityRefresh(cb));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    setVisibility("visible");
    window.dispatchEvent(new Event("focus"));
    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fires again after the cooldown elapses", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityRefresh(cb));
    window.dispatchEvent(new Event("focus"));
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DEFAULT_VISIBILITY_COOLDOWN_MS + 1);
    window.dispatchEvent(new Event("focus"));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("respects a custom cooldownMs", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityRefresh(cb, { cooldownMs: 1000 }));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event("focus"));
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600);
    window.dispatchEvent(new Event("focus"));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not attach listeners when enabled is false", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityRefresh(cb, { enabled: false }));
    window.dispatchEvent(new Event("focus"));
    setVisibility("visible");
    expect(cb).not.toHaveBeenCalled();
  });

  it("removes listeners on unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useVisibilityRefresh(cb));
    unmount();
    window.dispatchEvent(new Event("focus"));
    expect(cb).not.toHaveBeenCalled();
  });
});
