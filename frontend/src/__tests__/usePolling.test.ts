import { renderHook } from "@testing-library/react";
import { usePolling } from "../hooks/usePolling";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call the callback after the specified interval when enabled is true", () => {
    const callback = vi.fn();
    const interval = 1000;

    renderHook(() => usePolling({ callback, interval, enabled: true }));

    // Callback should not be called immediately
    expect(callback).not.toHaveBeenCalled();

    // Advance time by the interval
    vi.advanceTimersByTime(interval);

    // Callback should be called once
    expect(callback).toHaveBeenCalledTimes(1);

    // Advance time by the interval again
    vi.advanceTimersByTime(interval);

    // Callback should be called a second time
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("should not call the callback when enabled is false", () => {
    const callback = vi.fn();
    const interval = 1000;

    renderHook(() => usePolling({ callback, interval, enabled: false }));

    // Advance time by multiple intervals
    vi.advanceTimersByTime(interval * 5);

    // Callback should never be called
    expect(callback).not.toHaveBeenCalled();
  });

  it("should clear the interval cleanly when the hook unmounts", () => {
    const callback = vi.fn();
    const interval = 1000;

    const { unmount } = renderHook(() => usePolling({ callback, interval, enabled: true }));

    // Advance time by the interval
    vi.advanceTimersByTime(interval);

    // Callback should be called once
    expect(callback).toHaveBeenCalledTimes(1);

    // Unmount the hook
    unmount();

    // Clear any remaining timers to ensure cleanup
    vi.clearAllTimers();

    // Advance time by the interval again
    vi.advanceTimersByTime(interval);

    // Callback should still only have been called once (not called after unmount)
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
