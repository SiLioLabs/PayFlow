import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../stellar");
vi.mock("../hooks/useAdmin");
vi.mock("../hooks/useSubscription", () => ({
  useSubscription: vi.fn(() => ({
    subscription: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));
vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(() => ({
    status: "idle",
    hash: null,
    error: null,
    submit: vi.fn(async (fn) => fn()),
  })),
}));

import * as stellar from "../stellar";
import { useAdmin } from "../hooks/useAdmin";
import { useTransaction } from "../hooks/useTransaction";
import SubscriptionRepairPanel from "../components/admin/SubscriptionRepairPanel";

const VALID_USER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("SubscriptionRepairPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAdmin).mockReturnValue({
      adminAddress: "GADMIN123",
      isAdmin: true,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it("shows loading state while validating", async () => {
    vi.mocked(stellar.validateSubscription).mockImplementation(
      () => new Promise(() => {})
    );

    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    const input = screen.getByPlaceholderText("G…");
    await userEvent.type(input, VALID_USER);
    await userEvent.click(screen.getByRole("button", { name: /validate subscription/i }));

    expect(screen.getByText(/Validating…/)).toBeTruthy();
  });

  it("renders human-readable validation failures", async () => {
    vi.mocked(stellar.validateSubscription).mockResolvedValue({
      isValid: false,
      violations: ["missing_renewal_record", "invalid_subscription_status"],
      missingRecords: [],
      invalidStateTransitions: [],
      corruptedReferences: [],
    });

    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await userEvent.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() => {
      expect(screen.getByText("Subscription Validation Failed")).toBeTruthy();
    });

    expect(screen.getByText("Missing renewal record")).toBeTruthy();
    expect(screen.getByText("Invalid subscription status")).toBeTruthy();
  });

  it("shows a passing validation state for clean subscriptions", async () => {
    vi.mocked(stellar.validateSubscription).mockResolvedValue({
      isValid: true,
      violations: [],
      missingRecords: [],
      invalidStateTransitions: [],
      corruptedReferences: [],
    });

    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await userEvent.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() => {
      expect(screen.getByText(/Subscription validation passed/)).toBeTruthy();
    });
  });

  it("disables repair for unauthorized wallets", async () => {
    vi.mocked(useAdmin).mockReturnValue({
      adminAddress: "GADMIN123",
      isAdmin: false,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    vi.mocked(stellar.validateSubscription).mockResolvedValue({
      isValid: false,
      violations: ["corrupted_expiration_timestamp"],
      missingRecords: [],
      invalidStateTransitions: [],
      corruptedReferences: [],
    });

    render(<SubscriptionRepairPanel adminKey="GUSER456" onSign={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await userEvent.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /repair subscription/i })).toBeDisabled();
    });
  });

  it("executes repair and displays fixed inconsistency count", async () => {
    const onSign = vi.fn().mockResolvedValue("tx-hash-123");
    const submit = vi.fn(async (fn: () => Promise<string>) => fn());

    vi.mocked(useTransaction).mockReturnValue({
      status: "idle",
      hash: null,
      error: null,
      submit,
    });

    vi.mocked(stellar.validateSubscription)
      .mockResolvedValueOnce({
        isValid: false,
        violations: ["missing_renewal_record"],
        missingRecords: [],
        invalidStateTransitions: [],
        corruptedReferences: [],
      })
      .mockResolvedValueOnce({
        isValid: true,
        violations: [],
        missingRecords: [],
        invalidStateTransitions: [],
        corruptedReferences: [],
      });

    vi.mocked(stellar.buildRepairSubscriptionTx).mockResolvedValue("signed-xdr");
    vi.mocked(stellar.parseSubscriptionRepairedEvent).mockResolvedValue(3);

    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={onSign} />);

    await userEvent.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await userEvent.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /repair subscription/i })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: /repair subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(stellar.buildRepairSubscriptionTx).toHaveBeenCalledWith("GADMIN123", VALID_USER);
    });

    await waitFor(() => {
      expect(screen.getByText(/Fixed inconsistencies: 3/)).toBeTruthy();
    });
  });

  it("shows validation error state with retry", async () => {
    vi.mocked(stellar.validateSubscription).mockRejectedValue(new Error("HostError: Contract unavailable"));

    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await userEvent.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() => {
      expect(screen.getByText(/Validation Error/)).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: /retry validation/i })).toBeTruthy();
  });
});
