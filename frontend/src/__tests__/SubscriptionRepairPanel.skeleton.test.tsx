/**
 * SubscriptionRepairPanel — skeleton / loading / empty / error / race tests.
 *
 * The repair panel's loading state is driven by the `useAdmin` credential check
 * (adminLoading). Its "empty" state is the idle phase before any validation has
 * been run. Its error state covers a failed validateSubscription RPC call.
 * The race guard ensures a slow validateSubscription response that outlives a
 * newer call cannot clobber the UI.
 */
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
    submit: vi.fn(async (fn: () => Promise<string>) => fn()),
  })),
}));

import * as stellar from "../stellar";
import { useAdmin } from "../hooks/useAdmin";
import SubscriptionRepairPanel from "../components/admin/SubscriptionRepairPanel";

// Checksum-valid Stellar Ed25519 public key for test use
const VALID_USER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function adminReady(isAdmin = true) {
  vi.mocked(useAdmin).mockReturnValue({
    adminAddress: "GADMIN123",
    isAdmin,
    loading: false,
    error: null,
    refresh: vi.fn(),
  });
}

function adminLoading() {
  vi.mocked(useAdmin).mockReturnValue({
    adminAddress: null,
    isAdmin: false,
    loading: true,
    error: null,
    refresh: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adminReady();
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("SubscriptionRepairPanel — loading state", () => {
  it("shows the AdminRepairSkeleton (aria-busy) while admin credentials are loading", () => {
    adminLoading();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    // AdminRepairSkeleton sets aria-busy="true" and aria-label="Loading repair panel"
    expect(screen.getByLabelText(/loading repair panel/i)).toBeInTheDocument();
  });

  it("hides the skeleton once admin check completes", () => {
    adminReady();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    expect(screen.queryByLabelText(/loading repair panel/i)).not.toBeInTheDocument();
  });

  it("validate button shows aria-busy while validation RPC is in flight", async () => {
    adminReady();
    // Never resolves → simulates in-flight
    vi.mocked(stellar.validateSubscription).mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));

    const validateBtn = screen.getByRole("button", { name: /validating/i });
    expect(validateBtn).toHaveAttribute("aria-busy", "true");
    expect(validateBtn).toHaveAttribute("aria-disabled", "true");
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("SubscriptionRepairPanel — empty (idle) state", () => {
  it("shows the idle empty-state hint before any validation is run", () => {
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    expect(screen.getByTestId("repair-empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("repair-empty-state")).toHaveTextContent(
      /enter a subscriber address/i
    );
  });

  it("idle hint is distinct from loading (no aria-busy)", () => {
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    const emptyEl = screen.getByTestId("repair-empty-state");
    expect(emptyEl).not.toHaveAttribute("aria-busy");
  });

  it("empty hint disappears once validation result is shown", async () => {
    vi.mocked(stellar.validateSubscription).mockResolvedValue({
      isValid: true,
      violations: [],
      missingRecords: [],
      invalidStateTransitions: [],
      corruptedReferences: [],
    });

    const user = userEvent.setup();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() =>
      expect(screen.getByTestId("repair-report")).toBeInTheDocument()
    );

    expect(screen.queryByTestId("repair-empty-state")).not.toBeInTheDocument();
  });
});

// ─── Error state ──────────────────────────────────────────────────────────────

describe("SubscriptionRepairPanel — error state", () => {
  it("shows the validation-error card with role=alert when RPC fails", async () => {
    vi.mocked(stellar.validateSubscription).mockRejectedValue(
      new Error("Contract call failed: host error")
    );

    const user = userEvent.setup();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() =>
      expect(screen.getByTestId("repair-validation-error")).toBeInTheDocument()
    );

    // Must be role=alert — semantically distinct from loading and empty
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Validation Error/i);
  });

  it("error state is visually distinct: no skeleton, no report, idle hint gone", async () => {
    vi.mocked(stellar.validateSubscription).mockRejectedValue(new Error("timeout"));

    const user = userEvent.setup();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() =>
      expect(screen.getByTestId("repair-validation-error")).toBeInTheDocument()
    );

    expect(screen.queryByLabelText(/loading repair panel/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("repair-report")).not.toBeInTheDocument();
    expect(screen.queryByTestId("repair-empty-state")).not.toBeInTheDocument();
  });

  it("Retry validation button re-triggers RPC and can recover to success", async () => {
    vi.mocked(stellar.validateSubscription)
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValueOnce({
        isValid: true,
        violations: [],
        missingRecords: [],
        invalidStateTransitions: [],
        corruptedReferences: [],
      });

    const user = userEvent.setup();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("G…"), VALID_USER);
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));

    await waitFor(() =>
      expect(screen.getByTestId("repair-validation-error")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /retry validation/i }));

    await waitFor(() =>
      expect(screen.getByTestId("repair-report")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("repair-validation-error")).not.toBeInTheDocument();
  });
});

// ─── Race / stale-response prevention ────────────────────────────────────────

describe("SubscriptionRepairPanel — race / stale-response prevention", () => {
  it("discards a slow first validateSubscription when a second one completes first", async () => {
    // Request 1: slow — a manually-resolved promise
    // Request 2: fast — resolves immediately with a passing report
    // Expected: UI shows the result from request 2; request 1's late resolution is dropped.

    let resolveSlowValidation!: (v: unknown) => void;
    const slowPromise = new Promise((res) => { resolveSlowValidation = res; });

    let callCount = 0;
    vi.mocked(stellar.validateSubscription).mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // First call is slow — returns a failing report when it eventually resolves
        return slowPromise as Promise<unknown> as ReturnType<typeof stellar.validateSubscription>;
      }
      // Second call resolves immediately with a clean report
      return Promise.resolve({
        isValid: true,
        violations: [],
        missingRecords: [],
        invalidStateTransitions: [],
        corruptedReferences: [],
      });
    });

    const user = userEvent.setup();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    const addressInput = screen.getByPlaceholderText("G…");

    // Trigger first (slow) validation
    await user.type(addressInput, VALID_USER);
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));

    // Immediately trigger second (fast) validation while first is still in-flight
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));

    // Second call resolves quickly → success report shown
    await waitFor(() =>
      expect(screen.getByTestId("repair-report")).toBeInTheDocument()
    );
    expect(screen.getByText(/Subscription validation passed/i)).toBeInTheDocument();

    // Now resolve the first (stale) validation with a failure — must NOT clobber the UI
    await import("@testing-library/react").then(({ act }) =>
      act(async () => {
        resolveSlowValidation({
          isValid: false,
          violations: ["missing_renewal_record"],
          missingRecords: [],
          invalidStateTransitions: [],
          corruptedReferences: [],
        });
      })
    );

    // UI must still show the passing report from request 2
    expect(screen.getByText(/Subscription validation passed/i)).toBeInTheDocument();
    expect(screen.queryByText(/Subscription Validation Failed/i)).not.toBeInTheDocument();
  });

  it("a stale error response does not clobber a newer success result", async () => {
    let resolveSlowWithError!: (reason: unknown) => void;
    const slowErrorPromise = new Promise<never>((_, rej) => {
      resolveSlowWithError = rej;
    });

    let callCount = 0;
    vi.mocked(stellar.validateSubscription).mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return slowErrorPromise;
      return Promise.resolve({
        isValid: true,
        violations: [],
        missingRecords: [],
        invalidStateTransitions: [],
        corruptedReferences: [],
      });
    });

    const user = userEvent.setup();
    render(<SubscriptionRepairPanel adminKey="GADMIN123" onSign={vi.fn()} />);

    const addressInput = screen.getByPlaceholderText("G…");

    // Start slow (will error), then immediately start fast (will succeed)
    await user.type(addressInput, VALID_USER);
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));
    await user.click(screen.getByRole("button", { name: /validate subscription/i }));

    // Fast call completes — success state shown
    await waitFor(() =>
      expect(screen.getByTestId("repair-report")).toBeInTheDocument()
    );

    // Reject the slow promise — error must NOT appear
    await import("@testing-library/react").then(({ act }) =>
      act(async () => { resolveSlowWithError(new Error("stale error")); })
    );

    expect(screen.queryByTestId("repair-validation-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("repair-report")).toBeInTheDocument();
  });
});
