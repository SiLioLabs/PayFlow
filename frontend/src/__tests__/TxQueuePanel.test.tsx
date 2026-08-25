import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import TxQueuePanel from "../components/TxQueuePanel";
import * as txQueue from "../services/txQueue";

// Mock stellar so explorerTxUrl doesn't need real config
vi.mock("../stellar", () => ({
  explorerTxUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
}));

// Mock CopyButton to keep tests simple
vi.mock("../components/CopyButton", () => ({
  default: ({ text }: { text: string }) => <button data-testid={`copy-${text}`}>Copy</button>,
}));

describe("TxQueuePanel", () => {
  beforeEach(() => {
    txQueue._reset();
  });

  it("renders nothing when the queue is empty", () => {
    const { container } = render(<TxQueuePanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders and auto-opens when a transaction is enqueued", async () => {
    render(<TxQueuePanel />);

    act(() => {
      txQueue.enqueue("Subscribe");
    });

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /transaction queue/i })).toBeInTheDocument();
    });

    // Panel should be expanded (auto-open on enqueue)
    expect(screen.getByRole("list", { name: /recent transactions/i })).toBeInTheDocument();
    expect(screen.getByText("Subscribe")).toBeInTheDocument();
  });

  it("shows 'Pending' status for a newly enqueued entry", async () => {
    render(<TxQueuePanel />);

    act(() => {
      txQueue.enqueue("Cancel");
    });

    await waitFor(() => {
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });
  });

  it("shows 'Submitted' status after markSubmitted", async () => {
    render(<TxQueuePanel />);

    let id: number;
    act(() => {
      id = txQueue.enqueue("Pay Per Use");
    });

    act(() => {
      txQueue.markSubmitted(id!, "abc123def456abc123def456abc123");
    });

    await waitFor(() => {
      expect(screen.getByText("Submitted")).toBeInTheDocument();
    });
  });

  it("shows 'Confirmed' status after markConfirmed", async () => {
    render(<TxQueuePanel />);

    let id: number;
    act(() => {
      id = txQueue.enqueue("Subscribe");
    });

    act(() => {
      txQueue.markSubmitted(id!, "abc123def456abc123def456abc123");
      txQueue.markConfirmed(id!);
    });

    await waitFor(() => {
      expect(screen.getByText("Confirmed")).toBeInTheDocument();
    });
  });

  it("shows 'Failed' status and error message after markFailed", async () => {
    render(<TxQueuePanel />);

    let id: number;
    act(() => {
      id = txQueue.enqueue("Batch Charge");
    });

    act(() => {
      txQueue.markFailed(id!, "Insufficient funds");
    });

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Insufficient funds")).toBeInTheDocument();
    });
  });

  it("shows retry button for failed entry with a retry callback", async () => {
    const mockRetry = vi.fn().mockResolvedValue(undefined);
    render(<TxQueuePanel />);

    let id: number;
    act(() => {
      id = txQueue.enqueue("Subscribe", mockRetry);
    });

    act(() => {
      txQueue.markFailed(id!, "RPC timeout");
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry subscribe/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /retry subscribe/i }));

    await waitFor(() => {
      expect(mockRetry).toHaveBeenCalledTimes(1);
    });
  });

  it("does not show retry button for failed entry without retry callback", async () => {
    render(<TxQueuePanel />);

    let id: number;
    act(() => {
      id = txQueue.enqueue("Pay Per Use", null);
    });

    act(() => {
      txQueue.markFailed(id!, "User rejected");
    });

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders explorer link with truncated hash for submitted entry", async () => {
    render(<TxQueuePanel />);

    const hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
    let id: number;
    act(() => {
      id = txQueue.enqueue("Subscribe");
    });

    act(() => {
      txQueue.markSubmitted(id!, hash);
    });

    await waitFor(() => {
      const link = screen.getByRole("link", {
        name: /view transaction.*stellar\.expert/i,
      });
      expect(link).toHaveAttribute("href", `https://stellar.expert/explorer/testnet/tx/${hash}`);
      expect(link).toHaveAttribute("target", "_blank");
    });
  });

  it("collapses when the toggle button is clicked", async () => {
    render(<TxQueuePanel />);

    act(() => {
      txQueue.enqueue("Subscribe");
    });

    await waitFor(() => {
      expect(screen.getByRole("list", { name: /recent transactions/i })).toBeInTheDocument();
    });

    // Click the toggle button to collapse
    await userEvent.click(screen.getByRole("button", { name: /collapse transaction queue/i }));

    await waitFor(() => {
      expect(screen.queryByRole("list", { name: /recent transactions/i })).not.toBeInTheDocument();
    });
  });

  it("re-opens when expand toggle is clicked while collapsed", async () => {
    render(<TxQueuePanel />);

    act(() => {
      txQueue.enqueue("Subscribe");
    });

    // Collapse first
    await waitFor(() => screen.getByRole("button", { name: /collapse transaction queue/i }));
    await userEvent.click(screen.getByRole("button", { name: /collapse transaction queue/i }));

    // Now expand
    await waitFor(() => screen.getByRole("button", { name: /expand transaction queue/i }));
    await userEvent.click(screen.getByRole("button", { name: /expand transaction queue/i }));

    await waitFor(() => {
      expect(screen.getByRole("list", { name: /recent transactions/i })).toBeInTheDocument();
    });
  });

  it("shows a pending count badge for in-progress transactions", async () => {
    render(<TxQueuePanel />);

    act(() => {
      txQueue.enqueue("Subscribe");
      txQueue.enqueue("Cancel");
    });

    await waitFor(() => {
      // Badge shows count of pending/submitted entries (2)
      expect(screen.getByLabelText(/2 in progress/i)).toBeInTheDocument();
    });
  });

  it("shows operation name and timestamp for each entry", async () => {
    render(<TxQueuePanel />);

    act(() => {
      txQueue.enqueue("Set Daily Limit");
    });

    await waitFor(() => {
      expect(screen.getByText("Set Daily Limit")).toBeInTheDocument();
      // timestamp is rendered as a <time> element
      expect(screen.getByRole("time")).toBeInTheDocument();
    });
  });
});
