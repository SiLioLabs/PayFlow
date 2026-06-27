import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../stellar");
vi.mock("../hooks/usePolling", () => ({ usePolling: () => {} }));

vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(() => ({
    status: "idle",
    submit: vi.fn(async (fn) => {
      const hash = await fn();
      return hash;
    }),
    error: null,
  })),
}));

vi.mock("../hooks/useWallet", () => ({
  useWallet: vi.fn(() => ({
    signAndSubmit: vi.fn().mockResolvedValue("tx-hash"),
  })),
}));

import * as stellar from "../stellar";
import { useTransaction } from "../hooks/useTransaction";
import MerchantDashboard from "../components/MerchantDashboard";

const SAMPLE_SUBSCRIBER = {
  subscriber: "GTESTER000000000000000000000000000000000000000000",
  amount: "10000000",
  interval: 2592000,
  lastCharged: 0,
  nextChargeAt: 2592000,
};

describe("MerchantDashboard", () => {
  beforeEach(() => {
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(0n);
    vi.mocked(stellar.getMerchantRevenueHistory).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders active subscribers with formatted values and copy buttons", async () => {
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([SAMPLE_SUBSCRIBER]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(100000000n); // 10 XLM
    const onSign = vi.fn().mockResolvedValue("tx-hash");

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={onSign} refreshTrigger={0} />);

    await waitFor(() => expect(screen.getByText(/Merchant Dashboard/)).toBeTruthy());

    expect(screen.getByText("10.0000000 XLM")).toBeTruthy(); // Total Revenue
    expect(screen.getByText("GTESTE…0000")).toBeTruthy();
    expect(screen.getByText("1.0000000 XLM")).toBeTruthy();
    expect(screen.getByText(/Next charge/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy address/i })).toBeTruthy();
  });

  it("shows an empty state when there are no active subscribers", async () => {
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    const onSign = vi.fn();

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={onSign} refreshTrigger={0} />);

    await waitFor(() => expect(screen.getByText(/No active subscribers found/)).toBeTruthy());
  });

  it("renders a virtualized window for large subscriber lists", async () => {
    const manySubscribers = Array.from({ length: 200 }, (_, index) => ({
      ...SAMPLE_SUBSCRIBER,
      subscriber: `GUSER${String(index).padStart(51, "0")}`,
    }));
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue(manySubscribers);
    const onSign = vi.fn();

    const { container } = render(
      <MerchantDashboard merchantKey="GMERCHANT" onSign={onSign} refreshTrigger={0} />
    );

    await waitFor(() => expect(screen.getByText("200 total")).toBeTruthy());

    const renderedRows = container.querySelectorAll(".merchant-subscriber-row");
    expect(renderedRows.length).toBeLessThanOrEqual(20);
  });

  it("enables the batch charge button when subscribers are due", async () => {
    const dueSubscriber = {
      ...SAMPLE_SUBSCRIBER,
      nextChargeAt: Math.floor(Date.now() / 1000) - 10, // 10 seconds ago
    };
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([dueSubscriber]);
    const onSign = vi.fn();

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={onSign} refreshTrigger={0} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Charge 1 due subscriber/i })).toBeTruthy());
  });

  it("processes a batch charge and shows success message", async () => {
    const dueSubscriber = {
      ...SAMPLE_SUBSCRIBER,
      nextChargeAt: Math.floor(Date.now() / 1000) - 10,
    };
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([dueSubscriber]);
    vi.mocked(stellar.simulateBatchCharge).mockResolvedValue(["Charged"]);
    vi.mocked(stellar.buildBatchChargeTx).mockResolvedValue("batch-xdr");
    const onSign = vi.fn().mockResolvedValue("tx-hash");

    // Mock useTransaction to return success after submit
    const mockSubmit = vi.fn(async (fn) => {
      await fn();
      return "tx-hash";
    });
    vi.mocked(useTransaction).mockReturnValue({
      status: "success",
      submit: mockSubmit,
      error: null,
      hash: "tx-hash",
    });

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={onSign} refreshTrigger={0} />);

    await waitFor(() => screen.getByRole("button", { name: /Charge 1 due subscriber/i }));
    const button = screen.getByRole("button", { name: /Charge 1 due subscriber/i });

    await userEvent.click(button);

    await waitFor(() => expect(screen.getByText(/Batch charge submitted successfully!/i)).toBeTruthy());
    expect(screen.getByText("Charged")).toBeTruthy();
    expect(stellar.simulateBatchCharge).toHaveBeenCalled();
    expect(stellar.buildBatchChargeTx).toHaveBeenCalled();
  });
});
