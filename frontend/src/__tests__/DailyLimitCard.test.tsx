import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../hooks/useAmountDisplay", () => ({
  useAmountDisplay: () => ({
    displayCurrentAmount: (v: bigint) => `${Number(v) / 10_000_000} XLM`,
    unit: "XLM" as const,
    setUnit: vi.fn(),
  }),
}));

describe("DailyLimitCard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("shows loading initially", async () => {
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return {
        ...actual,
        getDailyLimit: vi.fn(() => new Promise(() => {})),
        getDailySpent: vi.fn(() => new Promise(() => {})),
        getDayStart: vi.fn(() => new Promise(() => {})),
      };
    });
    const { default: Card } = await import("../components/DailyLimitCard");
    render(<Card userKey="GABC" refreshTrigger={0} onOpen={vi.fn()} />);
    expect(screen.getByLabelText(/loading daily spending limit/i)).toBeInTheDocument();
  });

  it("renders limit/spent/remaining and progress when limit set", async () => {
    vi.resetModules();
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return {
        ...actual,
        getDailyLimit: vi.fn().mockResolvedValue(100_000_000n), // 10 XLM
        getDailySpent: vi.fn().mockResolvedValue(70_000_000n), // 7 XLM
        getDayStart: vi.fn().mockResolvedValue(123456789n),
      };
    });
    const { default: Card2 } = await import("../components/DailyLimitCard");
    render(<Card2 userKey="GABC" refreshTrigger={0} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Daily Spending/)).toBeInTheDocument());
    expect(screen.getByText(/Daily limit/)).toBeInTheDocument();
    expect(screen.getByText(/Today's spend/)).toBeInTheDocument();
    expect(screen.getByText(/Remaining/)).toBeInTheDocument();
    // Progress bar
    expect(screen.getByRole("progressbar", { name: /daily limit usage/i })).toBeInTheDocument();
    expect(screen.getByText(/70% used/)).toBeInTheDocument();
    expect(
      screen.getByText(/Resets about 24 hours after your first spend today/)
    ).toBeInTheDocument();
  });

  it("shows Not set and uncapped hint when no limit", async () => {
    vi.resetModules();
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return {
        ...actual,
        getDailyLimit: vi.fn().mockResolvedValue(null),
        getDailySpent: vi.fn().mockResolvedValue(0n),
        getDayStart: vi.fn().mockResolvedValue(null),
      };
    });
    const { default: Card3 } = await import("../components/DailyLimitCard");
    render(<Card3 userKey="GABC" refreshTrigger={0} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Not set")).toBeInTheDocument());
    expect(screen.getByText(/No cap set — pay-per-use is uncapped/)).toBeInTheDocument();
    expect(screen.getByText(/Inactive/)).toBeInTheDocument();
  });

  it("shows uncapped-but-window-active warning when limit expired mid-window", async () => {
    vi.resetModules();
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return {
        ...actual,
        getDailyLimit: vi.fn().mockResolvedValue(null),
        getDailySpent: vi.fn().mockResolvedValue(5_000_000n),
        getDayStart: vi.fn().mockResolvedValue(999n),
      };
    });
    const { default: Card4 } = await import("../components/DailyLimitCard");
    render(<Card4 userKey="GABC" refreshTrigger={0} onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Limit expired but window still active/)).toBeInTheDocument()
    );
  });

  it("shows error state when fetch fails", async () => {
    vi.resetModules();
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return {
        ...actual,
        getDailyLimit: vi.fn().mockRejectedValue(new Error("RPC down")),
        getDailySpent: vi.fn().mockRejectedValue(new Error("RPC down")),
        getDayStart: vi.fn().mockRejectedValue(new Error("RPC down")),
      };
    });
    const { default: Card5 } = await import("../components/DailyLimitCard");
    render(<Card5 userKey="GABC" refreshTrigger={0} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/Unable to load daily spending data/)).toBeInTheDocument();
  });

  it("remaining shows Exceeded when spent > limit", async () => {
    vi.resetModules();
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return {
        ...actual,
        getDailyLimit: vi.fn().mockResolvedValue(10_000_000n),
        getDailySpent: vi.fn().mockResolvedValue(15_000_000n),
        getDayStart: vi.fn().mockResolvedValue(1n),
      };
    });
    const { default: Card6 } = await import("../components/DailyLimitCard");
    render(<Card6 userKey="GABC" refreshTrigger={0} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Exceeded")).toBeInTheDocument());
  });
});
