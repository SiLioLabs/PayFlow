import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import TxQueuePanel from "../components/TxQueuePanel";
import * as txQueue from "../services/txQueue";

vi.mock("../stellar", () => ({
  explorerTxUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
}));

vi.mock("../components/CopyButton", () => ({
  default: ({ text }: { text: string }) => <button data-testid={`copy-${text}`}>Copy</button>,
}));

describe("TxQueuePanel recovery UX (Issue 052)", () => {
  beforeEach(() => {
    localStorage.clear();
    txQueue._reset();
  });

  it("shows interrupted pending entry with resume/discard and double-submit warning", async () => {
    render(<TxQueuePanel />);

    act(() => {
      txQueue.enqueue("Subscribe", vi.fn().mockResolvedValue(undefined));
      // keep as pending with no hash (interrupted)
    });

    await waitFor(() => expect(screen.getByText("Subscribe")).toBeInTheDocument());
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText(/Interrupted — wallet closed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume subscribe/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard subscribe/i })).toBeInTheDocument();
    expect(screen.getByText(/Double-submit risk/)).toBeInTheDocument();
  });

  it("discard removes the entry", async () => {
    render(<TxQueuePanel />);
    act(() => {
      txQueue.enqueue("Subscribe");
    });
    await waitFor(() => expect(screen.getByText("Subscribe")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /discard subscribe/i }));
    await waitFor(() => {
      expect(screen.queryByText("Subscribe")).not.toBeInTheDocument();
    });
    expect(txQueue.getEntries()).toHaveLength(0);
  });

  it("retry on interrupted entry calls retry callback and warns about simulation", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(<TxQueuePanel />);
    act(() => {
      txQueue.enqueue("Pay Per Use", retry);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /resume pay per use/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /resume pay per use/i }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  it("failed entry shows discard and retry, and explains risk after reload", async () => {
    render(<TxQueuePanel />);
    const retry = vi.fn().mockResolvedValue(undefined);
    let id: number;
    act(() => {
      id = txQueue.enqueue("Subscribe", retry);
      txQueue.markFailed(id, "Freighter closed");
    });
    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry subscribe/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard subscribe/i })).toBeInTheDocument();
    // Persistence hint
    expect(screen.getByText(/Pending items survive reload/)).toBeInTheDocument();
  });

  it("pending items survive reload: pre-populated localStorage renders on mount", async () => {
    const persisted = [
      {
        id: 42,
        operation: "Subscribe",
        hash: null,
        timestamp: new Date().toISOString(),
        status: "pending",
        error: null,
      },
    ];
    localStorage.setItem(txQueue.TX_QUEUE_STORAGE_KEY, JSON.stringify(persisted));
    localStorage.setItem(txQueue.TX_PANEL_STORAGE_KEY, "true");
    txQueue._rehydrate();
    render(<TxQueuePanel />);
    await waitFor(() => expect(screen.getByText("Subscribe")).toBeInTheDocument());
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("clear all removes all persisted entries", async () => {
    render(<TxQueuePanel />);
    act(() => {
      txQueue.enqueue("Subscribe");
      txQueue.enqueue("Cancel");
    });
    await waitFor(() => expect(screen.getByText("Clear all")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /clear all transactions/i }));
    await waitFor(() => {
      // Panel disappears when empty
      expect(screen.queryByRole("region", { name: /transaction queue/i })).not.toBeInTheDocument();
    });
  });
});
