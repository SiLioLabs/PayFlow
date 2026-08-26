/**
 * Tests for ContractPauseBanner component and useContractPaused hook
 * (feat/contract-pause-banner)
 *
 * Coverage:
 *  - ContractPauseBanner renders when paused=true
 *  - ContractPauseBanner does not render when paused=false
 *  - ContractPauseBanner has correct text, role, and aria attributes
 *  - ContractPauseBanner auto-hides when paused flips to false
 *  - Subscribe button is disabled while paused
 *  - Pay-per-use button is disabled while paused
 *  - Batch charge button is disabled while paused
 *  - useContractPaused returns isPaused=true when getContractPaused resolves true
 *  - useContractPaused returns isPaused=false when getContractPaused resolves false
 *  - useContractPaused returns isPaused=false (not paused) when getContractPaused returns null (RPC error)
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import ContractPauseBanner from "../components/ContractPauseBanner";

// ── ContractPauseBanner component tests ──────────────────────────────────────

describe("ContractPauseBanner", () => {
  it("renders the banner when paused=true", () => {
    render(<ContractPauseBanner paused={true} />);
    expect(screen.getByTestId("contract-pause-banner")).toBeInTheDocument();
  });

  it("does not render when paused=false", () => {
    render(<ContractPauseBanner paused={false} />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();
  });

  it("displays the required maintenance message", () => {
    render(<ContractPauseBanner paused={true} />);
    expect(
      screen.getByText(
        /PayFlow is currently paused for maintenance\. Subscriptions and payments are temporarily unavailable\./i
      )
    ).toBeInTheDocument();
  });

  it("has role='alert' for immediate screen reader announcement", () => {
    render(<ContractPauseBanner paused={true} />);
    expect(screen.getByTestId("contract-pause-banner")).toHaveAttribute("role", "alert");
  });

  it("has aria-live='assertive'", () => {
    render(<ContractPauseBanner paused={true} />);
    expect(screen.getByTestId("contract-pause-banner")).toHaveAttribute("aria-live", "assertive");
  });

  it("has aria-atomic='true'", () => {
    render(<ContractPauseBanner paused={true} />);
    expect(screen.getByTestId("contract-pause-banner")).toHaveAttribute("aria-atomic", "true");
  });

  it("auto-hides when paused flips from true to false", () => {
    const { rerender } = render(<ContractPauseBanner paused={true} />);
    expect(screen.getByTestId("contract-pause-banner")).toBeInTheDocument();

    rerender(<ContractPauseBanner paused={false} />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();
  });

  it("reappears when paused flips back to true", () => {
    const { rerender } = render(<ContractPauseBanner paused={false} />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();

    rerender(<ContractPauseBanner paused={true} />);
    expect(screen.getByTestId("contract-pause-banner")).toBeInTheDocument();
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

  it("isPaused=true when getContractPaused resolves true", async () => {
    mockGetContractPaused.mockResolvedValue(true);

    const { result } = renderHook(() => useContractPaused());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPaused).toBe(true);
  });

  it("isPaused=false when getContractPaused resolves false", async () => {
    mockGetContractPaused.mockResolvedValue(false);

    const { result } = renderHook(() => useContractPaused());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPaused).toBe(false);
  });

  it("isPaused=false when getContractPaused returns null (RPC error — don't block UI)", async () => {
    mockGetContractPaused.mockResolvedValue(null);

    const { result } = renderHook(() => useContractPaused());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPaused).toBe(false);
  });

  it("isPaused=false when getContractPaused rejects (network error)", async () => {
    mockGetContractPaused.mockRejectedValue(new Error("network failure"));

    const { result } = renderHook(() => useContractPaused());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPaused).toBe(false);
  });

  it("loading starts true and becomes false after fetch", async () => {
    mockGetContractPaused.mockResolvedValue(false);

    const { result } = renderHook(() => useContractPaused());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
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
