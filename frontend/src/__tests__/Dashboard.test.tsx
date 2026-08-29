import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

const toast = {
  error: vi.fn(),
  success: vi.fn(),
};

vi.mock("../hooks/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useToast")>();
  return {
    ...actual,
    useToast: () => {
      const hook = actual.useToast();
      return {
        ...hook,
        addToast: (
          message: string,
          variant: "success" | "error" | "info" = "info",
          txHash?: string
        ) => {
          if (variant === "error") toast.error(message);
          if (variant === "success") toast.success(message);
          return hook.addToast(message, variant, txHash);
        },
      };
    },
  };
});

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
    fetchEvents: vi.fn(() => Promise.resolve([])),
    buildCancelTx: vi.fn(),
    buildPayPerUseTx: vi.fn(),
    explorerTxUrl: vi.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
    server: {
      getTransaction: vi.fn(() => Promise.resolve({ status: "SUCCESS" })),
    },
  };
});
vi.mock("../hooks/usePolling", () => ({ usePolling: () => {} }));
vi.mock("../hooks/useRpcHealth", () => ({
  useRpcHealth: vi.fn(() => ({ status: "healthy", latencyMs: 50, error: null })),
}));
vi.mock("../components/SubscriptionHistory", () => ({
  default: () => <div data-testid="history" />,
}));

import * as stellar from "../stellar";
import type { ChargeSimResult, SubscriptionHealth } from "../stellar";
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

const HEALTHY_HEALTH: SubscriptionHealth = {
  active: true,
  charge_due: false,
  within_grace: false,
  has_sufficient_allowance: true,
  is_paused: false,
  trial_active: false,
  daily_limit_set: false,
};

function setup(
  sub: typeof ACTIVE_SUB | null = ACTIVE_SUB,
  health: SubscriptionHealth | null = HEALTHY_HEALTH,
  sim: ChargeSimResult | null = "WouldSucceed"
) {
  vi.mocked(stellar.getSubscription).mockResolvedValue(sub);
  vi.mocked(stellar.getAllowance).mockResolvedValue(BigInt(0));
  vi.mocked(stellar.getDailyLimit).mockResolvedValue(null);
  vi.mocked(stellar.getDailySpent).mockResolvedValue(BigInt(0));
  vi.mocked(stellar.getSubscriptionHealth).mockResolvedValue(health);
  vi.mocked(stellar.simulateCharge).mockResolvedValue(sim);
  vi.mocked(stellar.server.getTransaction).mockResolvedValue({ status: "SUCCESS" } as any);

  const onSign = vi.fn().mockResolvedValue("txhash1234567890");
  const announce = vi.fn();

  render(<Dashboard userKey="GUSER" onSign={onSign} refreshTrigger={0} announce={announce} />);

  return { onSign, announce };
}

describe("Dashboard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRpcHealth).mockReturnValue({
      status: "healthy",
      latencyMs: 50,
      error: null,
    } as ReturnType<typeof useRpcHealth>);
    toast.error.mockClear();
    toast.success.mockClear();
  });

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

    await waitFor(() => screen.getAllByRole("spinbutton").length > 0);

    // Replace single getByRole with getAllByRole and pick the pay-per-use input:
    const amountInputs = screen.getAllByRole("spinbutton");
    await userEvent.clear(amountInputs[0]);
    await userEvent.type(amountInputs[0], "10");
    await userEvent.click(screen.getByRole("button", { name: /pay/i }));

    await waitFor(() => expect(screen.getByText(/Paid!/)).toBeTruthy());
  });

  it("cancel flow: error from onSign shows error toast", async () => {
    vi.mocked(stellar.buildCancelTx).mockRejectedValue(new Error("user rejected"));
    setup();

    await waitFor(() => screen.getByRole("button", { name: /cancel subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/user rejected/i));
    });
  });

  it("shows health Good and keeps pay enabled for a healthy subscription", async () => {
    vi.mocked(stellar.buildPayPerUseTx).mockResolvedValue("ppu-xdr");
    setup();

    await waitFor(() => {
      expect(screen.getByTestId("subscription-health-status")).toHaveTextContent("Good");
    });
    await waitFor(() => {
      expect(screen.getByTestId("simulate-charge-readout")).toHaveTextContent(/would succeed/i);
    });
    expect(screen.queryByTestId("ppu-blocked-reason")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-recovery")).not.toBeInTheDocument();
  });

  it("disables pay-per-use when the subscription is paused", async () => {
    setup(
      { ...ACTIVE_SUB, paused: true },
      { ...HEALTHY_HEALTH, is_paused: true },
      "SubscriptionPaused"
    );

    await waitFor(() => {
      expect(screen.getByTestId("ppu-blocked-reason")).toHaveTextContent(/paused/i);
    });
    expect(screen.getByRole("button", { name: /pay now/i })).toBeDisabled();
  });

  it("warns but does not disable pay when allowance is insufficient", async () => {
    setup(
      ACTIVE_SUB,
      { ...HEALTHY_HEALTH, has_sufficient_allowance: false },
      "InsufficientAllowance"
    );

    await waitFor(() => {
      expect(screen.getByTestId("ppu-warning-reason")).toHaveTextContent(
        /allowance is insufficient/i
      );
    });
    expect(screen.getByTestId("error-recovery")).toHaveAttribute("data-proactive", "true");
    expect(
      within(screen.getByTestId("error-recovery")).getByRole("button", {
        name: /increase allowance/i,
      })
    ).toBeInTheDocument();
  });
});
