import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("../stellar", () => ({
  buildCancelTx: vi.fn(),
  buildPayPerUseTx: vi.fn(),
  getSubscription: vi.fn(() => Promise.resolve(null)),
  getAllowance: vi.fn(() => Promise.resolve(0n)),
  getDailyLimit: vi.fn(() => Promise.resolve(null)),
  getDailySpent: vi.fn(() => Promise.resolve(0n)),
  explorerTxUrl: vi.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
  server: {
    getTransaction: vi.fn(() => Promise.resolve({ status: "SUCCESS" })),
  },
}));
vi.mock("../hooks/usePolling", () => ({ usePolling: () => {} }));
vi.mock("../hooks/useRpcHealth", () => ({
  useRpcHealth: vi.fn(() => ({ status: "healthy", latencyMs: 50, error: null })),
}));
vi.mock("../components/SubscriptionHistory", () => ({
  default: () => <div data-testid="history" />,
}));

import * as stellar from "../stellar";
import { useRpcHealth } from "../hooks/useRpcHealth";
import Dashboard from "../components/Dashboard";

const ACTIVE_SUB = {
  merchant: "GMERCHANT",
  amount: "10000000",
  interval: 2592000,
  last_charged: 0,
  active: true,
  paused: false,
};

function setup(sub: typeof ACTIVE_SUB | null = ACTIVE_SUB) {
  vi.mocked(stellar.getSubscription).mockResolvedValue(sub);
  vi.mocked(stellar.getAllowance).mockResolvedValue(BigInt(0));
  vi.mocked(stellar.getDailyLimit).mockResolvedValue(null);
  vi.mocked(stellar.getDailySpent).mockResolvedValue(BigInt(0));
  vi.mocked(stellar.server.getTransaction).mockResolvedValue({ status: "SUCCESS" } as any);

  const onSign = vi.fn().mockResolvedValue("txhash1234567890");
  const announce = vi.fn();

  render(<Dashboard userKey="GUSER" onSign={onSign} refreshTrigger={0} announce={announce} />);

  return { onSign, announce };
}

describe("Dashboard", () => {
  afterEach(() => vi.resetAllMocks());

  it("shows no-subscription message when sub is null", async () => {
    setup(null);
    await waitFor(() => expect(screen.getByText(/No active subscription found/)).toBeTruthy());
  });

  it("shows an inline RPC warning when RPC is unhealthy", async () => {
    vi.mocked(useRpcHealth).mockReturnValue({
      healthy: false,
      circuitOpen: false,
      status: "unreachable",
      latencyMs: null,
      error: "RPC down",
    });
    setup();

    await waitFor(() =>
      expect(screen.getByText(/RPC endpoint unreachable: RPC down/)).toBeTruthy()
    );
  });

  it("cancel flow: confirm modal → performCancel → success toast", async () => {
    vi.mocked(stellar.buildCancelTx).mockResolvedValue("cancel-xdr");
    setup();

    await waitFor(() => screen.getByRole("button", { name: /cancel subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel subscription/i }));
    expect(screen.getByText(/Are you sure/i)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(screen.getByText(/Cancelled successfully/i)).toBeTruthy());
  });

  it("cancel flow: dismiss modal does not cancel", async () => {
    vi.mocked(stellar.buildCancelTx).mockResolvedValue("cancel-xdr");
    setup();

    await waitFor(() => screen.getByRole("button", { name: /cancel subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel subscription/i }));

    // Click the modal's "Cancel" (dismiss) button — it's the btn-secondary inside the modal
    const modalCancelBtn = screen.getByRole("button", { name: /back/i });
    await userEvent.click(modalCancelBtn);

    expect(stellar.buildCancelTx).not.toHaveBeenCalled();
  });

  it("pay-per-use flow: submit amount → success toast", async () => {
    vi.mocked(stellar.buildPayPerUseTx).mockResolvedValue("ppu-xdr");
    setup();

    await waitFor(() => screen.getByRole("spinbutton"));

    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "1");
    await userEvent.click(screen.getByRole("button", { name: /pay/i }));

    await waitFor(() => expect(screen.getByText(/Paid!/)).toBeTruthy());
  });

  it("cancel flow: error from onSign shows error toast", async () => {
    vi.mocked(stellar.buildCancelTx).mockRejectedValue(new Error("user rejected"));
    setup();

    await waitFor(() => screen.getByRole("button", { name: /cancel subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(screen.getByText(/user rejected/i)).toBeTruthy());
  });
});
