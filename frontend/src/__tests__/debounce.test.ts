import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "../utils/debounce";

describe("debounce utility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays execution until the wait time has elapsed", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("test");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("test");
  });

  it("coalesces burst calls into a single invocation with the latest arguments", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);

    debounced(1);
    vi.advanceTimersByTime(50);
    debounced(2);
    vi.advanceTimersByTime(50);
    debounced(3);
    vi.advanceTimersByTime(50);
    debounced(4);

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(4);
  });

  it("cancels pending executions when cancel() is invoked", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("cancel-me");
    vi.advanceTimersByTime(100);
    debounced.cancel();

    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it("executes immediately and clears timer when flush() is invoked", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("flush-me");
    expect(fn).not.toHaveBeenCalled();

    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("flush-me");

    // Advancing timers should not cause a second execution
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush() is a no-op if no invocation is pending", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
