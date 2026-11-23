import React from "react";
import { render, renderHook, screen, act, within } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useContractEvents, contractEventKey } from "../hooks/useContractEvents";
import EventFeed from "../components/EventFeed";
import { fetchEvents, type ContractEvent } from "../stellar";

/**
 * A fake event source standing in for PollingManager. It reproduces the two
 * behaviours that matter for this hook's lifecycle: it notifies the listener
 * immediately on subscribe, and it hands back the real unsubscribe so a rebind
 * would be observable as a subscribe/unsubscribe pair.
 */
const source = vi.hoisted(() => {
  const listeners = new Set<(state: unknown) => void>();
  return {
    listeners,
    subscribe: vi.fn(),
    retry: vi.fn(),
    subscribeCount: 0,
    unsubscribeCount: 0,
  };
});

vi.mock("../services/PollingManager", () => ({
  PollingManager: { subscribe: source.subscribe, retry: source.retry },
}));

vi.mock("../stellar", () => ({
  fetchEvents: vi.fn(),
  explorerTxUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
}));

interface PollState {
  events: ContractEvent[];
  error: string | null;
  loading: boolean;
  nextCursor: string | undefined;
}

const IDLE: PollState = { events: [], error: null, loading: false, nextCursor: undefined };

/** Build a distinct event per ledger. txHash is unique, so the key is unique. */
function ev(eventName: string, ledger: number): ContractEvent {
  return {
    eventName,
    address: "GUSER",
    data: null,
    ledger,
    timestamp: `2024-01-01T00:00:00.000Z`,
    txHash: `tx${ledger}`,
  };
}

/** Deliver a poll tick to every currently bound listener. */
function emit(state: Partial<PollState>) {
  act(() => {
    source.listeners.forEach((l) => l({ ...IDLE, ...state }));
  });
}

const fetchEventsMock = vi.mocked(fetchEvents);

beforeEach(() => {
  source.listeners.clear();
  source.subscribeCount = 0;
  source.unsubscribeCount = 0;
  source.subscribe.mockReset();
  source.retry.mockReset();
  source.subscribe.mockImplementation(
    (_name: string, _address: string | undefined, listener: (s: unknown) => void) => {
      source.subscribeCount += 1;
      source.listeners.add(listener);
      // The real manager notifies immediately with its current state.
      listener({ ...IDLE });
      return () => {
        source.unsubscribeCount += 1;
        source.listeners.delete(listener);
      };
    }
  );
  fetchEventsMock.mockReset();
});

afterEach(() => {
  source.listeners.clear();
});

function renderEvents(eventName = "charged", address?: string, maxEvents = 50) {
  return renderHook(
    ({ name, addr, max }: { name: string; addr?: string; max: number }) =>
      useContractEvents(name, addr, max),
    { initialProps: { name: eventName, addr: address, max: maxEvents } }
  );
}

describe("useContractEvents subscription lifecycle", () => {
  it("binds the subscription once per stream", () => {
    renderEvents();

    expect(source.subscribeCount).toBe(1);
    expect(source.subscribe).toHaveBeenCalledWith("charged", undefined, expect.any(Function));
  });

  it("does not restart the subscription when a page is loaded", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 3), ev("charged", 2)], nextCursor: "cursor-1" });

    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 1)], nextCursor: "cursor-2" });
    await act(async () => {
      await result.current.loadMore();
    });

    // The whole point: paging re-queries, it does not rebind.
    expect(source.subscribeCount).toBe(1);
    expect(source.unsubscribeCount).toBe(0);

    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 0)], nextCursor: undefined });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(source.subscribeCount).toBe(1);
    expect(source.unsubscribeCount).toBe(0);
  });

  it("does not restart the subscription when maxEvents changes", () => {
    const { rerender } = renderEvents("charged", undefined, 5);

    rerender({ name: "charged", addr: undefined, max: 50 });

    expect(source.subscribeCount).toBe(1);
    expect(source.unsubscribeCount).toBe(0);
  });

  it("rebinds when the stream identity changes", () => {
    const { rerender } = renderEvents("charged", "GOLD");

    rerender({ name: "charged", addr: "GNEW", max: 50 });

    expect(source.subscribeCount).toBe(2);
    expect(source.unsubscribeCount).toBe(1);
  });

  it("rebinds when the event name changes", () => {
    const { rerender } = renderEvents("charged");

    rerender({ name: "cancelled", addr: undefined, max: 50 });

    expect(source.subscribeCount).toBe(2);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderEvents();

    unmount();

    expect(source.unsubscribeCount).toBe(1);
  });

  it("delivers poll ticks after unmount without touching state", () => {
    const { unmount } = renderEvents();
    const listener = source.subscribe.mock.calls[0][2];
    unmount();

    expect(source.listeners.size).toBe(0);
    expect(() => listener({ ...IDLE, events: [ev("charged", 9)] })).not.toThrow();
  });
});

describe("useContractEvents pagination window", () => {
  it("merges a loaded page under the polled events without duplicating", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 3), ev("charged", 2), ev("charged", 1)], nextCursor: "c1" });

    // The second page overlaps the first at the page boundary, as a real
    // cursor-based fetch would.
    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 2), ev("charged", 1)], nextCursor: "c2" });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx3", "tx2", "tx1"]);
  });

  it("keeps paginated history when a later poll advances the window", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 3), ev("charged", 2)], nextCursor: "c1" });

    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 1), ev("charged", 0)], nextCursor: "c2" });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx3", "tx2", "tx1", "tx0"]);

    // A new poll arrives whose window now also covers events we already paged
    // in. The page must neither be dropped nor listed twice.
    emit({ events: [ev("charged", 4), ev("charged", 3), ev("charged", 2)] });

    expect(result.current.events.map((e) => e.txHash)).toEqual([
      "tx4",
      "tx3",
      "tx2",
      "tx1",
      "tx0",
    ]);
  });

  it("keeps polling while a page is being fetched", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 2)], nextCursor: "c1" });

    let release: (v: { events: ContractEvent[] }) => void = () => {};
    fetchEventsMock.mockImplementation(
      () => new Promise<{ events: ContractEvent[] }>((resolve) => (release = resolve))
    );

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.loadMore();
    });
    // Mid-flight the hook reports loading...
    expect(result.current.loading).toBe(true);

    // ...and a poll landing during the fetch is still delivered.
    emit({ events: [ev("charged", 3), ev("charged", 2)] });
    expect(source.subscribeCount).toBe(1);
    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx3", "tx2"]);

    await act(async () => {
      release({ events: [ev("charged", 1)] });
      await pending;
    });

    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx3", "tx2", "tx1"]);
    expect(result.current.loading).toBe(false);
  });

  it("ignores a second load while one is already in flight", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 2)], nextCursor: "c1" });

    let release: (v: { events: ContractEvent[] }) => void = () => {};
    fetchEventsMock.mockImplementation(
      () => new Promise<{ events: ContractEvent[] }>((resolve) => (release = resolve))
    );

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.loadMore();
      second = result.current.loadMore();
    });

    expect(fetchEventsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ events: [ev("charged", 1)] });
      await Promise.all([first, second]);
    });

    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx2", "tx1"]);
  });

  it("requests the next page from the pagination cursor, not the poll cursor", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 2)], nextCursor: "poll-cursor" });

    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 1)], nextCursor: "page-cursor" });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(fetchEventsMock).toHaveBeenLastCalledWith("charged", undefined, "poll-cursor");

    // Once paginated the hook owns the cursor; a later poll must not rewind it.
    emit({ events: [ev("charged", 3), ev("charged", 2)], nextCursor: "poll-cursor-2" });
    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 0)], nextCursor: undefined });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetchEventsMock).toHaveBeenLastCalledWith("charged", undefined, "page-cursor");
  });

  it("clears hasMore when the final page has no cursor", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 2)], nextCursor: "c1" });
    expect(result.current.hasMore).toBe(true);

    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 1)], nextCursor: undefined });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.hasMore).toBe(false);
  });

  it("does not fetch when there is no cursor to follow", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 2)], nextCursor: undefined });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetchEventsMock).not.toHaveBeenCalled();
  });

  it("surfaces a pagination failure and keeps the pages already loaded", async () => {
    const { result } = renderEvents();
    emit({ events: [ev("charged", 2)], nextCursor: "c1" });

    fetchEventsMock.mockResolvedValueOnce({ events: [ev("charged", 1)], nextCursor: "c2" });
    await act(async () => {
      await result.current.loadMore();
    });

    fetchEventsMock.mockRejectedValueOnce(new Error("cursor expired"));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe("cursor expired");
    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx2", "tx1"]);
  });

  it("caps the merged window at maxEvents, keeping the newest", async () => {
    const { result } = renderEvents("charged", undefined, 2);
    emit({ events: [ev("charged", 3), ev("charged", 2), ev("charged", 1)], nextCursor: "c1" });

    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx3", "tx2"]);

    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 0)], nextCursor: undefined });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx3", "tx2"]);
  });

  it("resets pagination when the stream identity changes", async () => {
    const { result, rerender } = renderEvents("charged", "GOLD");
    emit({ events: [ev("charged", 2)], nextCursor: "c1" });
    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 1)], nextCursor: "c2" });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.events).toHaveLength(2);

    rerender({ name: "charged", addr: "GNEW", max: 50 });

    // Fresh stream: no stale page carried over, and the cursor is re-primed
    // from the new stream's own poll.
    expect(result.current.events).toHaveLength(0);
    emit({ events: [ev("charged", 7)], nextCursor: "new-c1" });
    expect(result.current.events.map((e) => e.txHash)).toEqual(["tx7"]);
    expect(result.current.hasMore).toBe(true);
  });

  it("reports poll loading and error state", () => {
    const { result } = renderEvents();

    emit({ loading: true });
    expect(result.current.loading).toBe(true);

    emit({ loading: false, error: "rpc unavailable" });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("rpc unavailable");

    emit({ loading: false, error: null });
    expect(result.current.error).toBeNull();
  });

  it("delegates refresh to the polling manager", () => {
    const { result } = renderEvents("charged", "GOLD");

    act(() => {
      result.current.refresh();
    });

    expect(source.retry).toHaveBeenCalledWith("charged", "GOLD");
  });
});

describe("contractEventKey", () => {
  it("is stable across identical events from different sources", () => {
    expect(contractEventKey(ev("charged", 5))).toBe(contractEventKey(ev("charged", 5)));
  });

  it("distinguishes events that share a ledger", () => {
    expect(contractEventKey(ev("charged", 5))).not.toBe(contractEventKey(ev("cancelled", 5)));
  });
});

describe("EventFeed pagination", () => {
  it("keeps one row per event across a poll and a page transition", async () => {
    render(<EventFeed eventName="charged" address="GOLD" />);

    emit({ events: [ev("charged", 3), ev("charged", 2)], nextCursor: "c1" });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 1)], nextCursor: undefined });
    await act(async () => {
      await screen.getByRole("button", { name: /load more/i }).click();
    });

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // Each ledger appears exactly once, newest first.
    expect(rows.map((r) => within(r).getByText(/Ledger \d+/).textContent)).toEqual([
      "Ledger 3",
      "Ledger 2",
      "Ledger 1",
    ]);

    // A poll arriving after paging adds exactly one row and keeps the pages.
    emit({ events: [ev("charged", 4), ev("charged", 3), ev("charged", 2)] });
    const after = screen.getAllByRole("listitem");
    expect(after).toHaveLength(4);
    expect(after.map((r) => within(r).getByText(/Ledger \d+/).textContent)).toEqual([
      "Ledger 4",
      "Ledger 3",
      "Ledger 2",
      "Ledger 1",
    ]);
  });

  it("hides the load more control once the last page is reached", async () => {
    render(<EventFeed eventName="charged" />);

    emit({ events: [ev("charged", 2)], nextCursor: "c1" });
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();

    fetchEventsMock.mockResolvedValue({ events: [ev("charged", 1)], nextCursor: undefined });
    await act(async () => {
      await screen.getByRole("button", { name: /load more/i }).click();
    });

    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });
});
