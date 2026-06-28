import { renderHook, act } from "@testing-library/react";
import { useAnalytics } from "../hooks/useAnalytics";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

describe("useAnalytics", () => {
  let fetchMock: any;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("flowpay_analytics_opt_in", "true");
    vi.stubEnv("VITE_ANALYTICS_URL", "https://example.com/analytics");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("should dispatch CustomEvent immediately when track is called", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.track({ type: "wallet_connected" });
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("flowpay-analytics");
    expect(event.detail.event).toBe("wallet_connected");
    expect(event.detail.payload).toEqual({});
    expect(event.detail.timestamp).toBeDefined();
  });

  it("should support and correctly serialize bigint payloads in flushes", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.track({
        type: "pay_per_use",
        payload: { amountStroops: 10000000n }
      });
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody).toHaveLength(1);
    expect(parsedBody[0].payload.amountStroops).toBe("10000000");
  });

  it("should queue events and not call fetch immediately", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.track({ type: "wallet_connected" });
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should flush when 10 events accumulate and result in exactly one fetch", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      for (let i = 0; i < 9; i++) {
        result.current.track({ type: "wallet_connected" });
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      result.current.track({ type: "wallet_connected" });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Check that the body contains the array of 10 events
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/analytics");
    expect(options.method).toBe("POST");
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody).toHaveLength(10);
    expect(parsedBody[0]).toEqual({ type: "wallet_connected" });
  });

  it("should flush after 5 seconds pass", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.track({ type: "wallet_connected" });
    });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toHaveLength(1);
  });

  it("should register visibilitychange listener and flush when hidden", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.track({ type: "wallet_connected" });
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Mock document.visibilityState
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should clean up timers and listeners on unmount", () => {
    const removeListenerSpy = vi.spyOn(document, "removeEventListener");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const { result, unmount } = renderHook(() => useAnalytics());

    act(() => {
      result.current.track({ type: "wallet_connected" });
    });

    unmount();

    expect(removeListenerSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("should not fetch when VITE_ANALYTICS_URL is unset but CustomEvents still dispatch", () => {
    vi.stubEnv("VITE_ANALYTICS_URL", "");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.track({ type: "wallet_connected" });
    });

    // 10 events
    act(() => {
      for (let i = 0; i < 9; i++) {
        result.current.track({ type: "wallet_connected" });
      }
    });

    // Advance time by 5s
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledTimes(10);
  });
});
