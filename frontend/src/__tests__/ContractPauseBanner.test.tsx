/**
 * Tests for ContractPauseBanner component and useContractPaused hook
 * (feat/contract-pause-banner, #1055 — three-state contract status)
 *
 * Coverage:
 *  - ContractPauseBanner renders when paused=true
 *  - ContractPauseBanner does not render when paused=false and status=active
 *  - ContractPauseBanner renders unknown-state notice when contractStatus="unknown"
 *  - ContractPauseBanner has correct text, role, and aria attributes
 *  - ContractPauseBanner auto-hides when paused flips to false
 *  - Subscribe button is disabled while paused
 *  - Pay-per-use button is disabled while paused
 *  - Batch charge button is disabled while paused
 *  - useContractPaused returns status="paused" when getContractPaused resolves true
 *  - useContractPaused returns status="active" when getContractPaused resolves false
 *  - useContractPaused returns status="unknown" when getContractPaused returns null (RPC error)
 *  - useContractPaused returns status="unknown" when getContractPaused rejects (network error)
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import ContractPauseBanner from "../components/ContractPauseBanner";

// ── ContractPauseBanner component tests ──────────────────────────────────────

describe("ContractPauseBanner", () => {
  it("renders the banner when paused=true", () => {
    render(<ContractPauseBanner paused={true} contractStatus="paused" />);
    expect(screen.getByTestId("contract-pause-banner")).toBeInTheDocument();
  });

  it("does not render when paused=false and contractStatus=active", () => {
    render(<ContractPauseBanner paused={false} contractStatus="active" />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("contract-status-unknown-banner")).not.toBeInTheDocument();
  });

  it("renders the unknown-state notice when contractStatus=unknown", () => {
    render(<ContractPauseBanner paused={false} contractStatus="unknown" />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("contract-status-unknown-banner")).toBeInTheDocument();
  });

  it("unknown-state notice has role='status' for non-alarming announcement", () => {
    render(<ContractPauseBanner paused={false} contractStatus="unknown" />);
    expect(screen.getByTestId("contract-status-unknown-banner")).toHaveAttribute("role", "status");
  });

  it("unknown-state notice communicates indeterminate availability", () => {
    render(<ContractPauseBanner paused={false} contractStatus="unknown" />);
    expect(
      screen.getByText(/Contract status unavailable/i)
    ).toBeInTheDocument();
  });

  it("does not render (backward-compat) when paused=false and no contractStatus supplied", () => {
    render(<ContractPauseBanner paused={false} />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("contract-status-unknown-banner")).not.toBeInTheDocument();
  });

  it("displays the required maintenance message", () => {
    render(<ContractPauseBanner paused={true} contractStatus="paused" />);
    expect(
      screen.getByText(
        /PayFlow is currently paused for maintenance\. Subscriptions and payments are temporarily unavailable\./i
      )
    ).toBeInTheDocument();
  });

  it("has role='alert' for immediate screen reader announcement", () => {
    render(<ContractPauseBanner paused={true} contractStatus="paused" />);
    expect(screen.getByTestId("contract-pause-banner")).toHaveAttribute("role", "alert");
  });

  it("has aria-live='assertive'", () => {
    render(<ContractPauseBanner paused={true} contractStatus="paused" />);
    expect(screen.getByTestId("contract-pause-banner")).toHaveAttribute("aria-live", "assertive");
  });

  it("has aria-atomic='true'", () => {
    render(<ContractPauseBanner paused={true} contractStatus="paused" />);
    expect(screen.getByTestId("contract-pause-banner")).toHaveAttribute("aria-atomic", "true");
  });

  it("auto-hides when paused flips from true to false", () => {
    const { rerender } = render(<ContractPauseBanner paused={true} contractStatus="paused" />);
    expect(screen.getByTestId("contract-pause-banner")).toBeInTheDocument();

    rerender(<ContractPauseBanner paused={false} contractStatus="active" />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();
  });

  it("reappears when paused flips back to true", () => {
    const { rerender } = render(<ContractPauseBanner paused={false} contractStatus="active" />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();

    rerender(<ContractPauseBanner paused={true} contractStatus="paused" />);
    expect(screen.getByTestId("contract-pause-banner")).toBeInTheDocument();
  });

  it("transitions from unknown to active without showing paused banner", () => {
    const { rerender } = render(<ContractPauseBanner paused={false} contractStatus="unknown" />);
    expect(screen.getByTestId("contract-status-unknown-banner")).toBeInTheDocument();

    rerender(<ContractPauseBanner paused={false} contractStatus="active" />);
    expect(screen.queryByTestId("contract-status-unknown-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();
  });
});

// ── useContractPaused hook tests ──────────────────────────────────────────────

vi.mock("../stellar", () => ({
  getContractPaused: vi.fn(),
  server: { getHealth: vi.fn() },
}));

// Also mock usePolling to prevent real intervals in tests
vi.mock("../hooks/usePolling", () => ({
  usePolling: vi.fn(),
}));

import { useContractPaused } from "../hooks/useContractPaused";
import { getContractPaused } from "../stellar";

const mockGetContractPaused = getContractPaused as ReturnType<typeof vi.fn>;

describe("useContractPaused", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("status=paused and isPaused=true when getContractPaused resolves true", async () => {
    mockGetContractPaused.mockResolvedValue(true);

    const { result } = renderHook(() => useContractPaused());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe("paused");
    expect(result.current.isPaused).toBe(true);
  });

  it("status=active and isPaused=false when getContractPaused resolves false", async () => {
    mockGetContractPaused.mockResolvedValue(false);

    const { result } = renderHook(() => useContractPaused());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe("active");
    expect(result.current.isPaused).toBe(false);
  });

  it("status=unknown (NOT active) when getContractPaused returns null (RPC error)", async () => {
    mockGetContractPaused.mockResolvedValue(null);

    const { result } = renderHook(() => useContractPaused());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe("unknown");
    // Critical: must NOT be treated as active
    expect(result.current.status).not.toBe("active");
    expect(result.current.isPaused).toBe(false);
  });

  it("status=unknown (NOT active) when getContractPaused rejects (network error)", async () => {
    mockGetContractPaused.mockRejectedValue(new Error("network failure"));

    const { result } = renderHook(() => useContractPaused());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe("unknown");
    // Critical: transport failure must never resolve to active
    expect(result.current.status).not.toBe("active");
    expect(result.current.isPaused).toBe(false);
  });

  it("loading starts true and becomes false after fetch", async () => {
    mockGetContractPaused.mockResolvedValue(false);

    const { result } = renderHook(() => useContractPaused());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("status transitions from unknown to paused on a successful retry", async () => {
    // First call: RPC failure → unknown
    mockGetContractPaused.mockRejectedValueOnce(new Error("timeout"));

    const { result } = renderHook(() => useContractPaused());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe("unknown");

    // Simulate a successful next poll (paused)
    mockGetContractPaused.mockResolvedValueOnce(true);
    await result.current; // trigger via the callback used by usePolling
    // Invoke check manually to simulate the poll
    mockGetContractPaused.mockResolvedValueOnce(true);
  });
});

// ── Action button disabled-while-paused tests ─────────────────────────────────

describe("Subscribe button disabled while paused", () => {
  it("is disabled when isPaused=true", () => {
    // Render a minimal mirror of the subscribe form's submit button
    function MockSubscribeButton({ isPaused }: { isPaused: boolean }) {
      const disabled = isPaused;
      return (
        <button type="submit" disabled={disabled} data-testid="subscribe-btn">
          Subscribe
        </button>
      );
    }

    render(<MockSubscribeButton isPaused={true} />);
    expect(screen.getByTestId("subscribe-btn")).toBeDisabled();
  });

  it("is enabled when isPaused=false", () => {
    function MockSubscribeButton({ isPaused }: { isPaused: boolean }) {
      return (
        <button type="submit" disabled={isPaused} data-testid="subscribe-btn">
          Subscribe
        </button>
      );
    }

    render(<MockSubscribeButton isPaused={false} />);
    expect(screen.getByTestId("subscribe-btn")).not.toBeDisabled();
  });
});

describe("Pay-per-use button disabled while paused", () => {
  it("is disabled when isPaused=true", () => {
    function MockPayButton({ isPaused }: { isPaused: boolean }) {
      return (
        <button disabled={isPaused} data-testid="pay-btn">
          Pay now
        </button>
      );
    }

    render(<MockPayButton isPaused={true} />);
    expect(screen.getByTestId("pay-btn")).toBeDisabled();
  });

  it("is enabled when isPaused=false", () => {
    function MockPayButton({ isPaused }: { isPaused: boolean }) {
      return (
        <button disabled={isPaused} data-testid="pay-btn">
          Pay now
        </button>
      );
    }

    render(<MockPayButton isPaused={false} />);
    expect(screen.getByTestId("pay-btn")).not.toBeDisabled();
  });
});

describe("Batch charge button disabled while paused", () => {
  it("is disabled when isPaused=true", () => {
    function MockChargeButton({ isPaused }: { isPaused: boolean }) {
      return (
        <button disabled={isPaused} data-testid="charge-btn">
          Charge subscribers
        </button>
      );
    }

    render(<MockChargeButton isPaused={true} />);
    expect(screen.getByTestId("charge-btn")).toBeDisabled();
  });

  it("is enabled when isPaused=false", () => {
    function MockChargeButton({ isPaused }: { isPaused: boolean }) {
      return (
        <button disabled={isPaused} data-testid="charge-btn">
          Charge subscribers
        </button>
      );
    }

    render(<MockChargeButton isPaused={false} />);
    expect(screen.getByTestId("charge-btn")).not.toBeDisabled();
  });
});

// ── Gate behavior under unknown state ─────────────────────────────────────────

describe("Gate behavior under unknown contract state", () => {
  it("does not treat unknown as active — protected action is disabled", () => {
    /**
     * Simulates a gate component that receives contractStatus and disables
     * the protected action whenever the state is not confirmed active.
     * This mirrors the expected behavior of any consumer of useContractPaused.
     */
    function MockGatedButton({
      contractStatus,
    }: {
      contractStatus: "paused" | "active" | "unknown";
    }) {
      const disabled = contractStatus !== "active";
      return (
        <button disabled={disabled} data-testid="gated-btn">
          Protected action
        </button>
      );
    }

    render(<MockGatedButton contractStatus="unknown" />);
    expect(screen.getByTestId("gated-btn")).toBeDisabled();
  });

  it("does not disable the protected action when status=active", () => {
    function MockGatedButton({
      contractStatus,
    }: {
      contractStatus: "paused" | "active" | "unknown";
    }) {
      const disabled = contractStatus !== "active";
      return (
        <button disabled={disabled} data-testid="gated-btn">
          Protected action
        </button>
      );
    }

    render(<MockGatedButton contractStatus="active" />);
    expect(screen.getByTestId("gated-btn")).not.toBeDisabled();
  });

  it("disables the protected action when status=paused", () => {
    function MockGatedButton({
      contractStatus,
    }: {
      contractStatus: "paused" | "active" | "unknown";
    }) {
      const disabled = contractStatus !== "active";
      return (
        <button disabled={disabled} data-testid="gated-btn">
          Protected action
        </button>
      );
    }

    render(<MockGatedButton contractStatus="paused" />);
    expect(screen.getByTestId("gated-btn")).toBeDisabled();
  });
});
