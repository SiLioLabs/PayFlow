import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import SubscriptionCard from "../components/SubscriptionCard";
import { Subscription } from "../types";

vi.mock("../components/NextChargeCountdown", () => ({
  default: ({ nextChargeTimestamp }: { nextChargeTimestamp: number }) => (
    <span data-testid="next-charge">{nextChargeTimestamp}</span>
  ),
}));
vi.mock("../components/CopyButton", () => ({
  default: ({ text }: { text: string }) => <button data-testid={`copy-${text}`}>Copy</button>,
}));
vi.mock("../stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stellar")>();
  return {
    ...actual,
    RPC_URL: "https://soroban-testnet.stellar.org",
    getAllowance: vi.fn(() => Promise.resolve(0n)),
    getTrialEnd: vi.fn(() => Promise.resolve(null)),
    getSubscription: vi.fn(() => Promise.resolve(null)),
    buildCancelTx: vi.fn(),
    buildPayPerUseTx: vi.fn(),
    buildPauseTx: vi.fn(),
    buildResumeTx: vi.fn(),
    getSubscriptionHealth: vi.fn(() =>
      Promise.resolve({
        active: true,
        charge_due: false,
        within_grace: false,
        has_sufficient_allowance: true,
        is_paused: false,
        trial_active: false,
        daily_limit_set: false,
      })
    ),
    simulateCharge: vi.fn(() => Promise.resolve("WouldSucceed")),
  };
});

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

const mockSub: Subscription = {
  merchant: "GMERCHANT123456789ABCDEFGH",
  amount: "100000000",
  interval: 2592000,
  last_charged: 1000000,
  active: true,
  paused: false,
  trial_duration: 0,
  label: "Premium Plan",
};

function renderCard() {
  return render(
    <SubscriptionCard
      subscription={mockSub}
      userKey="GUSER123"
      onSign={vi.fn().mockResolvedValue("hash")}
      onRefresh={vi.fn()}
    />
  );
}

describe("SubscriptionCard – responsive layout", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("applies subscription-row--stacked class on mobile (375px)", () => {
    setViewport(375);
    const { container } = renderCard();
    // At least one row should have the stacked class on mobile
    const stackedRows = container.querySelectorAll(".subscription-row--stacked");
    expect(stackedRows.length).toBeGreaterThan(0);
  });

  it("does not apply subscription-row--stacked on desktop (1024px)", () => {
    setViewport(1024);
    const { container } = renderCard();
    const stackedRows = container.querySelectorAll(".subscription-row--stacked");
    expect(stackedRows.length).toBe(0);
  });

  it("applies card--mobile class on mobile (375px)", () => {
    setViewport(375);
    const { container } = renderCard();
    expect(container.querySelector(".card--mobile")).toBeTruthy();
  });

  it("does not apply card--mobile on desktop (1024px)", () => {
    setViewport(1024);
    const { container } = renderCard();
    expect(container.querySelector(".card--mobile")).toBeNull();
  });

  it("renders correctly at 320px viewport width without overflow class errors", () => {
    setViewport(320);
    const { container } = renderCard();
    // No horizontal-overflow-causing fixed-width inline styles
    const card = container.querySelector(".card");
    expect(card).toBeTruthy();
    // All rows should be stacked on mobile
    const stackedRows = container.querySelectorAll(".subscription-row--stacked");
    expect(stackedRows.length).toBeGreaterThan(0);
  });

  it("renders correctly at exact 768px (tablet boundary)", () => {
    setViewport(768);
    const { container } = renderCard();
    // 768px matches max-width: 768px but not max-width: 639px
    // isMobile (max-width: 639px) = false so no stacked rows
    const stackedRows = container.querySelectorAll(".subscription-row--stacked");
    expect(stackedRows.length).toBe(0);
  });

  it("renders correctly in landscape mobile (667px wide)", () => {
    // Landscape iPhone 6/7/8: 667px wide — this is > 639px so not isMobile
    setViewport(667);
    const { container } = renderCard();
    const stackedRows = container.querySelectorAll(".subscription-row--stacked");
    expect(stackedRows.length).toBe(0);
  });
});
