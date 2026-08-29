import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../stellar", () => ({
  CONTRACT_ID: "CTEST",
  server: {
    getEvents: vi.fn(),
  },
}));

import { useSubscriberCount } from "../hooks/useSubscriberCount";
import { server } from "../stellar";

const mockedGetEvents = vi.mocked(server.getEvents);

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEvent(type: "subscribed" | "cancelled", user: string, id: string) {
  return {
    topic: [{ toString: () => type }, { toString: () => user }],
    id,
    cursor: id,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("useSubscriberCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns count 0 and loading false when no events", async () => {
    mockedGetEvents.mockResolvedValue({ events: [] } as any);

    const { result } = renderHook(() => useSubscriberCount());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBe(0);
    expect(result.current.stale).toBe(false);
  });

  it("counts subscribed minus cancelled addresses from a single page", async () => {
    const events = [
      makeEvent("subscribed", "GUSER1", "e1"),
      makeEvent("subscribed", "GUSER2", "e2"),
      makeEvent("cancelled", "GUSER1", "e3"),
    ];
    mockedGetEvents.mockResolvedValue({ events } as any);

    const { result } = renderHook(() => useSubscriberCount());

    await waitFor(() => expect(result.current.loading).toBe(false));
    // GUSER1 subscribed then cancelled → net 0; GUSER2 subscribed → net 1
    expect(result.current.count).toBe(1);
  });

  it("paginates across 3 full pages of 1000 events each", async () => {
    // Build 3000 unique users across 3 pages (1000 each).
    const buildPage = (start: number) => {
      const events = [];
      for (let i = start; i < start + 1000; i++) {
        events.push(makeEvent("subscribed", `GUSER${i}`, `evt${i}`));
      }
      return events;
    };

    const page1 = buildPage(0);
    const page2 = buildPage(1000);
    // Last event on page3 has only 50 events to signal end of data.
    const page3Small = buildPage(2000).slice(0, 50);

    mockedGetEvents
      .mockResolvedValueOnce({ events: page1 } as any)
      .mockResolvedValueOnce({ events: page2 } as any)
      .mockResolvedValueOnce({ events: page3Small } as any);

    const { result } = renderHook(() => useSubscriberCount());

    await waitFor(() => expect(result.current.loading).toBe(false));
    // page1: 1000, page2: 1000, page3: 50 unique users
    expect(result.current.count).toBe(2050);
    expect(mockedGetEvents).toHaveBeenCalledTimes(3);
  });

  it("stops pagination after 50 pages (safety cap)", async () => {
    let callCount = 0;
    mockedGetEvents.mockImplementation(() => {
      callCount++;
      const events = Array.from({ length: 1000 }, (_, i) =>
        makeEvent("subscribed", `GUSER${i}`, `evt-page-${callCount}-${i}`)
      );
      return Promise.resolve({ events } as any);
    });

    const { result } = renderHook(() => useSubscriberCount());

    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 });
    // Should have been called exactly 50 times (the cap).
    expect(mockedGetEvents).toHaveBeenCalledTimes(50);
  });

  it("stale is false when not refreshing and loading is false", async () => {
    mockedGetEvents.mockResolvedValue({ events: [] } as any);

    const { result } = renderHook(() => useSubscriberCount());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stale).toBe(false);
  });

  it("returns count 0 and does not throw on fetch error", async () => {
    mockedGetEvents.mockRejectedValue(new Error("RPC error"));

    const { result } = renderHook(() => useSubscriberCount());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBe(0);
    expect(result.current.stale).toBe(false);
  });

  it("does not count a user twice if they subscribed multiple times", async () => {
    const events = [
      makeEvent("subscribed", "GUSER1", "e1"),
      makeEvent("subscribed", "GUSER1", "e2"), // re-subscribe
    ];
    mockedGetEvents.mockResolvedValue({ events } as any);

    const { result } = renderHook(() => useSubscriberCount());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBe(1);
  });
});
