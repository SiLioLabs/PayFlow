import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../stellar");
vi.mock("../hooks/usePolling", () => ({ usePolling: () => {} }));
vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(() => ({
    status: "idle",
    submit: vi.fn(async (fn) => fn()),
    error: null,
  })),
}));

// ─── responsive mock helpers ─────────────────────────────────────────────────
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
import MerchantDashboard from "../components/MerchantDashboard";

describe("MerchantDashboard – responsive layout", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("applies dashboard--mobile class on mobile viewport (375px)", async () => {
    setViewport(375);
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(0n);
    vi.mocked(stellar.getMerchantRevenueHistory).mockResolvedValue([]);

    const { container } = render(
      <MerchantDashboard merchantKey="GMERCHANT" onSign={vi.fn()} refreshTrigger={0} />
    );

    await waitFor(() => screen.getByText(/Merchant Dashboard/));
    const dashboard = container.querySelector(".dashboard--mobile");
    expect(dashboard).toBeTruthy();
  });

  it("uses grid-cols-1 class on mobile (375px)", async () => {
    setViewport(375);
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(0n);
    vi.mocked(stellar.getMerchantRevenueHistory).mockResolvedValue([]);

    const { container } = render(
      <MerchantDashboard merchantKey="GMERCHANT" onSign={vi.fn()} refreshTrigger={0} />
    );

    await waitFor(() => screen.getByText(/Merchant Dashboard/));
    // Stats grid should use grid-cols-1 on mobile
    const grid = container.querySelector(".merchant-stats-grid");
    expect(grid).toBeTruthy();
    expect(grid!.className).toContain("grid-cols-1");
  });

  it("uses grid-cols-2 class on desktop (1024px)", async () => {
    setViewport(1024);
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(0n);
    vi.mocked(stellar.getMerchantRevenueHistory).mockResolvedValue([]);

    const { container } = render(
      <MerchantDashboard merchantKey="GMERCHANT" onSign={vi.fn()} refreshTrigger={0} />
    );

    await waitFor(() => screen.getByText(/Merchant Dashboard/));
    const grid = container.querySelector(".merchant-stats-grid");
    expect(grid).toBeTruthy();
    expect(grid!.className).toContain("grid-cols-2");
  });

  it("does not apply dashboard--mobile on desktop (1024px)", async () => {
    setViewport(1024);
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(0n);
    vi.mocked(stellar.getMerchantRevenueHistory).mockResolvedValue([]);

    const { container } = render(
      <MerchantDashboard merchantKey="GMERCHANT" onSign={vi.fn()} refreshTrigger={0} />
    );

    await waitFor(() => screen.getByText(/Merchant Dashboard/));
    expect(container.querySelector(".dashboard--mobile")).toBeNull();
  });

  it("renders correctly on tablet breakpoint (768px)", async () => {
    setViewport(768);
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(0n);
    vi.mocked(stellar.getMerchantRevenueHistory).mockResolvedValue([]);

    const { container } = render(
      <MerchantDashboard merchantKey="GMERCHANT" onSign={vi.fn()} refreshTrigger={0} />
    );

    await waitFor(() => screen.getByText(/Merchant Dashboard/));
    // At 768px (which matches max-width: 768px) -> isMobile via max-width:639px = false
    // so should use grid-cols-2
    const grid = container.querySelector(".merchant-stats-grid");
    expect(grid).toBeTruthy();
  });
});
