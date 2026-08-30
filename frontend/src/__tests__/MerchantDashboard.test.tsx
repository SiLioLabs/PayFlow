import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../stellar");
vi.mock("../hooks/usePolling", () => ({ usePolling: () => {} }));

// MerchantSubscriberTable uses CopyButton — mock it to keep tests simple
vi.mock("../components/CopyButton", () => ({
  default: ({ ariaLabel }: { ariaLabel?: string }) => (
    <button aria-label={ariaLabel ?? "Copy"}>Copy</button>
  ),
}));

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

const NOW = Math.floor(Date.now() / 1000);

// Checksum-valid Stellar public key (StrKey.isValidEd25519PublicKey)
const VALID_ADDR_1 = "GCOEYT3WI3LY34I7DN7BR7AF33TNF2YF4OYTLVPJKMYAWT2RWEF5BUDK";

const SAMPLE_SUBSCRIBER = {
  subscriber: VALID_ADDR_1,
  amount: "10000000",
  interval: 2592000,
  lastCharged: NOW - 2592000,
  nextChargeAt: NOW + 2592000, // future → active
};

interface MockTxState {
  status: "idle" | "pending" | "success" | "failed";
  submit: (fn: () => Promise<string>) => Promise<string>;
  error: string | null;
  hash: string | null;
}

const idleTx = (): MockTxState => ({
  status: "idle",
  submit: vi.fn(async (fn) => fn()),
  error: null,
  hash: null,
});

// MerchantDashboard calls useTransaction() twice: first for the batch-charge
// flow, then for the withdraw flow. Hooks are called in the same order on
// every render, so alternating by call count lets tests control each
// instance independently.
function mockUseTransaction(overrides: {
  batch?: Partial<MockTxState>;
  withdraw?: Partial<MockTxState>;
}) {
  const batchState: MockTxState = { ...idleTx(), ...overrides.batch };
  const withdrawState: MockTxState = { ...idleTx(), ...overrides.withdraw };
  let call = 0;
  vi.mocked(useTransaction).mockImplementation(() => {
    call += 1;
    return call % 2 === 1 ? batchState : withdrawState;
  });
  return { batchState, withdrawState };
}

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

    // Table renders truncated address via formatAddress default (6, 4)
    expect(screen.getByText("GCOEYT…BUDK")).toBeTruthy();
    // Amount column shows XLM value
    expect(screen.getByText("10.0000000 XLM")).toBeTruthy(); // Total Revenue
    expect(screen.getByText("1.0000000 XLM")).toBeTruthy();
    // Status badge shows Active (nextChargeAt is in the future)
    expect(screen.getByText(/active/i)).toBeTruthy();
    // CopyButton rendered for the subscriber address
    expect(screen.getByRole("button", { name: /copy subscriber address/i })).toBeTruthy();
  });

  it("shows an empty state when there are no active subscribers", async () => {
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    const onSign = vi.fn();

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={onSign} refreshTrigger={0} />);

    await waitFor(() => expect(screen.getByText(/No active subscribers found/i)).toBeTruthy());
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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Charge 1 due subscriber/i })).toBeTruthy()
    );
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

    await waitFor(() =>
      expect(screen.getByText(/Batch charge submitted successfully!/i)).toBeTruthy()
    );
    expect(screen.getByText("Charged")).toBeTruthy();
    expect(stellar.simulateBatchCharge).toHaveBeenCalled();
    expect(stellar.buildBatchChargeTx).toHaveBeenCalled();
  });

  // ── Withdraw revenue ────────────────────────────────────────────────────

  it("disables the withdraw button when revenue is zero", async () => {
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(0n);
    mockUseTransaction({});

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={vi.fn()} refreshTrigger={0} />);

    const button = await screen.findByTestId("withdraw-revenue-button");
    expect(button).toBeDisabled();
  });

  it("enables the withdraw button when revenue is positive", async () => {
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(50000000n);
    mockUseTransaction({});

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={vi.fn()} refreshTrigger={0} />);

    const button = await screen.findByTestId("withdraw-revenue-button");
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("opens a confirmation showing the amount, and cancel closes it without building a tx", async () => {
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(50000000n);
    mockUseTransaction({});
    const user = userEvent.setup();

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={vi.fn()} refreshTrigger={0} />);

    const withdrawButton = await screen.findByTestId("withdraw-revenue-button");
    await waitFor(() => expect(withdrawButton).not.toBeDisabled());
    await user.click(withdrawButton);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/5\.0000000 XLM/)).toBeTruthy();

    await user.click(screen.getByTestId("withdraw-cancel-button"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stellar.buildWithdrawMerchantRevenueTx).not.toHaveBeenCalled();
  });

  it("confirming withdraws, signs, shows success, and refreshes revenue", async () => {
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(50000000n);
    vi.mocked(stellar.buildWithdrawMerchantRevenueTx).mockResolvedValue("withdraw-xdr");
    const onSign = vi.fn().mockResolvedValue("tx-hash");
    const mockSubmit = vi.fn(async (fn) => {
      await fn();
      return "tx-hash";
    });
    mockUseTransaction({ withdraw: { status: "success", submit: mockSubmit } });
    const user = userEvent.setup();

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={onSign} refreshTrigger={0} />);

    const withdrawButton = await screen.findByTestId("withdraw-revenue-button");
    await waitFor(() => expect(withdrawButton).not.toBeDisabled());
    await user.click(withdrawButton);
    await user.click(screen.getByTestId("withdraw-confirm-button"));

    await waitFor(() => expect(screen.getByText(/Revenue withdrawn successfully!/i)).toBeTruthy());

    expect(stellar.buildWithdrawMerchantRevenueTx).toHaveBeenCalledWith("GMERCHANT");
    expect(onSign).toHaveBeenCalledWith("withdraw-xdr");
    expect(mockSubmit).toHaveBeenCalled();
    // Initial mount fetches revenue once; a successful withdraw triggers a refresh.
    await waitFor(() =>
      expect(vi.mocked(stellar.getMerchantRevenue).mock.calls.length).toBeGreaterThanOrEqual(2)
    );
  });

  it("surfaces a friendly message and does not silently succeed on ZeroBalanceAvailable", async () => {
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(50000000n);
    vi.mocked(stellar.buildWithdrawMerchantRevenueTx).mockResolvedValue("withdraw-xdr");
    const onSign = vi.fn().mockResolvedValue("tx-hash");
    const failingSubmit = vi
      .fn()
      .mockRejectedValue(new Error("ContractError(#21): ZeroBalanceAvailable"));
    mockUseTransaction({
      withdraw: {
        status: "failed",
        submit: failingSubmit,
        error: "ContractError(#21): ZeroBalanceAvailable",
      },
    });
    const user = userEvent.setup();

    render(<MerchantDashboard merchantKey="GMERCHANT" onSign={onSign} refreshTrigger={0} />);

    const withdrawButton = await screen.findByTestId("withdraw-revenue-button");
    await waitFor(() => expect(withdrawButton).not.toBeDisabled());
    await user.click(withdrawButton);
    await user.click(screen.getByTestId("withdraw-confirm-button"));

    await waitFor(() =>
      expect(screen.getByText(/You have no withdrawable revenue yet\./i)).toBeTruthy()
    );
    expect(screen.queryByText(/Revenue withdrawn successfully!/i)).toBeNull();
  });
});
