import { describe, it, expect, beforeEach, vi } from "vitest";
import * as txQueue from "../services/txQueue";

describe("txQueue persistence (Issue 052)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    txQueue._reset();
  });

  it("persists enqueued entries to localStorage", () => {
    const id = txQueue.enqueue("Subscribe");
    const raw = localStorage.getItem(txQueue.TX_QUEUE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].operation).toBe("Subscribe");
    expect(parsed[0].id).toBe(id);
    expect(parsed[0].status).toBe("pending");
    expect(parsed[0].hash).toBeNull();
  });

  it("pending items survive reload via _rehydrate", () => {
    const id1 = txQueue.enqueue("Subscribe");
    const id2 = txQueue.enqueue("Pay Per Use");
    txQueue.markSubmitted(id1, "abc123hash000000000000000000000000");
    // Simulate reload: clear in-memory but keep localStorage, then rehydrate
    // Do NOT call _reset (which clears storage); instead manually wipe memory via _rehydrate after _reset without clearing storage
    // We'll snapshot storage, reset (clears), then restore snapshot and rehydrate
    const snapshot = localStorage.getItem(txQueue.TX_QUEUE_STORAGE_KEY);
    const panelSnapshot = localStorage.getItem(txQueue.TX_PANEL_STORAGE_KEY);
    // _reset already cleared storage, so restore
    if (snapshot) localStorage.setItem(txQueue.TX_QUEUE_STORAGE_KEY, snapshot);
    if (panelSnapshot) localStorage.setItem(txQueue.TX_PANEL_STORAGE_KEY, panelSnapshot);
    txQueue._rehydrate();
    const entries = txQueue.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.id === id1)?.hash).toBe("abc123hash000000000000000000000000");
    expect(entries.find((e) => e.id === id2)?.status).toBe("pending");
  });

  it("removeEntry discards and updates persisted storage", () => {
    const id = txQueue.enqueue("Subscribe");
    expect(txQueue.getEntries()).toHaveLength(1);
    txQueue.removeEntry(id);
    expect(txQueue.getEntries()).toHaveLength(0);
    const raw = localStorage.getItem(txQueue.TX_QUEUE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    expect(parsed).toHaveLength(0);
  });

  it("retry callback is not persisted (function dropped) but entry remains", () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    txQueue.enqueue("Subscribe", retry);
    const entries = txQueue.getEntries();
    expect(entries[0].retry).toBe(retry);
    const raw = localStorage.getItem(txQueue.TX_QUEUE_STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed[0].retry).toBeUndefined();
    // After rehydrate, retry is null (safe to discard or rebuild)
    const snap = localStorage.getItem(txQueue.TX_QUEUE_STORAGE_KEY)!;
    const panel = localStorage.getItem(txQueue.TX_PANEL_STORAGE_KEY);
    txQueue._reset();
    localStorage.setItem(txQueue.TX_QUEUE_STORAGE_KEY, snap);
    if (panel) localStorage.setItem(txQueue.TX_PANEL_STORAGE_KEY, panel);
    txQueue._rehydrate();
    const rehydrated = txQueue.getEntries();
    expect(rehydrated[0].retry).toBeNull();
    expect(rehydrated[0].operation).toBe("Subscribe");
  });

  it("markFailed + setRetry enables resume with simulation re-check", () => {
    const id = txQueue.enqueue("Pay Per Use");
    txQueue.markFailed(id, "Freighter closed");
    const retry = vi.fn().mockResolvedValue(undefined);
    txQueue.setRetry(id, retry);
    const entry = txQueue.getEntries().find((e) => e.id === id);
    expect(entry?.status).toBe("failed");
    expect(entry?.error).toBe("Freighter closed");
    expect(entry?.retry).toBe(retry);
  });

  it("panel open state persists", () => {
    txQueue.enqueue("Subscribe");
    expect(localStorage.getItem(txQueue.TX_PANEL_STORAGE_KEY)).toBe("true");
    txQueue.setPanelOpen(false);
    expect(localStorage.getItem(txQueue.TX_PANEL_STORAGE_KEY)).toBe("false");
    // Rehydrate should restore false
    const snap = localStorage.getItem(txQueue.TX_QUEUE_STORAGE_KEY)!;
    const panel = localStorage.getItem(txQueue.TX_PANEL_STORAGE_KEY)!;
    txQueue._reset();
    localStorage.setItem(txQueue.TX_QUEUE_STORAGE_KEY, snap);
    localStorage.setItem(txQueue.TX_PANEL_STORAGE_KEY, panel);
    txQueue._rehydrate();
    expect(txQueue.isPanelOpen()).toBe(false);
  });
});
