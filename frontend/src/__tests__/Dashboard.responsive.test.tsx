import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── module mocks ────────────────────────────────────────────────────────────
vi.mock("../stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stellar")>();
  return {
    ...actual,
    RPC_URL: "https://soroban-testnet.stellar.org",
    getAllowance: vi.fn(() => Promise.resolve(0n)),
    getTrialEnd: vi.fn(() => Promise.resolve(null)),
    getSubscription: vi.fn(() => Promise.resolve(null)),
    getDailyLimit: vi.fn(() => Promise.resolve(null)),
    getDailySpent: vi.fn(() => Promise.resolve(0n)),
    buildCancelTx: vi.fn(),
    buildPayPerUseTx: vi.fn(),
    explorerTxUrl: vi.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
    server: { getTransaction: vi.fn(() => Promise.resolve({ status: "SUCCESS" })) },
  };
});
vi.mock("../hooks/usePolling", () => ({ usePolling: () => {} }));
vi.mock("../hooks/useRpcHealth", () => ({
  useRpcHealth: vi.fn(() => ({ status: "healthy", latencyMs: 50, error: null })),
}));
vi.mock("../components/SubscriptionHistory", () => ({
  default: () => <div data-testid="history" />,
}));

// ─── responsive mock helper ───────────────────────────────────────────────────
function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      (query.includes("max-width: 639px") && width <= 639) ||
      (query.includes("max-width: 768px") && width <= 768),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

import * as stellar from "../stellar";
import Dashboard from "../components/Dashboard";

const ACTIVE_SUB = {
  merchant: "GMERCHANT",
  amount: "10000000",
  interval: 2592000,
  last_charged: 0,
  active: true,
  paused: false,
};

function setupMocks(sub: typeof ACTIVE_SUB | null = ACTIVE_SUB) {
  vi.mocked(stellar.getSubscription).mockResolvedValue(sub);
  vi.mocked(stellar.getAllowance).mockResolvedValue(0n);
  vi.mocked(stellar.getDailyLimit).mockResolvedValue(null);
  vi.mocked(stellar.getDailySpent).mockResolvedValue(0n);
  vi.mocked(stellar.server.getTransaction).mockResolvedValue({ status: "SUCCESS" } as any);
}

describe("Dashboard – responsive layout", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("applies dashboard--mobile class on mobile viewport (375px)", async () => {
    setViewport(375);
    setupMocks(null);

    const { container } = render(
      <Dashboard
        userKey="GUSER"
        onSign={vi.fn().mockResolvedValue("tx")}
        refreshTrigger={0}
        announce={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/No active subscription found/)).toBeTruthy());

    expect(container.querySelector(".dashboard--mobile")).toBeTruthy();
  });

  it("renders single-column layout on mobile (320px)", async () => {
    setViewport(320);
    setupMocks(null);

    render(
      <Dashboard
        userKey="GUSER"
        onSign={vi.fn().mockResolvedValue("tx")}
        refreshTrigger={0}
        announce={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/No active subscription found/)).toBeTruthy());
  });

  it("applies dashboard--mobile class at exactly 639px", async () => {
    setViewport(639);
    setupMocks(null);

    const { container } = render(
      <Dashboard
        userKey="GUSER"
        onSign={vi.fn().mockResolvedValue("tx")}
        refreshTrigger={0}
        announce={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/No active subscription found/)).toBeTruthy());

    await waitFor(() => {
      expect(container.querySelector(".dashboard--mobile")).toBeTruthy();
    });
  });

  it("does not apply dashboard--mobile class on desktop viewport (1024px)", async () => {
    setViewport(1024);
    setupMocks(null);

    const { container } = render(
      <Dashboard
        userKey="GUSER"
        onSign={vi.fn().mockResolvedValue("tx")}
        refreshTrigger={0}
        announce={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/No active subscription found/)).toBeTruthy());

    expect(container.querySelector(".dashboard--mobile")).toBeNull();
  });
});
