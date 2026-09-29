import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import TransferSubscriptionModal from "../components/TransferSubscriptionModal";

// Deterministic valid Stellar Ed25519 public keys (verified via StrKey.isValidEd25519PublicKey)
const USER_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TARGET_KEY = "GCXO7NWYDZJGGZZIZK3VJLMY276XKV5ZOONULFCRUBCCOCVX5F5M36CR";

const mockBuildTransferSubscriptionTx = vi.fn();
vi.mock("../stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stellar")>();
  return {
    ...actual,
    buildTransferSubscriptionTx: (...args: unknown[]) => mockBuildTransferSubscriptionTx(...args),
  };
});

// Mock AddressBook so selection can be exercised without localStorage/dialog internals.
vi.mock("../components/AddressBook", () => ({
  default: ({ onSelect }: { onSelect: (address: string) => void; onClose: () => void }) => (
    <div data-testid="mock-address-book">
      <button onClick={() => onSelect(TARGET_KEY)}>Pick Target</button>
    </div>
  ),
}));

describe("TransferSubscriptionModal", () => {
  const mockOnSign = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildTransferSubscriptionTx.mockResolvedValue("transfer-xdr");
    mockOnSign.mockResolvedValue("tx-hash");
  });

  function renderModal() {
    return render(
      <TransferSubscriptionModal
        userKey={USER_KEY}
        onSign={mockOnSign}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );
  }

  it("renders with an empty address and all checklist items unchecked, confirm disabled", () => {
    renderModal();

    expect(screen.getByTestId("transfer-address-input")).toHaveValue("");
    expect(screen.getByTestId("transfer-checklist-item-0")).not.toBeChecked();
    expect(screen.getByTestId("transfer-checklist-item-1")).not.toBeChecked();
    expect(screen.getByTestId("transfer-checklist-item-2")).not.toBeChecked();
    expect(screen.getByTestId("transfer-confirm-button")).toBeDisabled();
  });

  it("shows a validation error for an invalid address and keeps confirm disabled", async () => {
    renderModal();

    await userEvent.type(screen.getByTestId("transfer-address-input"), "not-a-valid-address");

    expect(await screen.findByRole("alert")).toHaveTextContent(/valid stellar address/i);
    expect(screen.getByTestId("transfer-confirm-button")).toBeDisabled();
  });

  it("keeps confirm disabled when the address equals the caller's own address", async () => {
    renderModal();

    await userEvent.type(screen.getByTestId("transfer-address-input"), USER_KEY);

    expect(await screen.findByRole("alert")).toHaveTextContent(/own address/i);
    expect(screen.getByTestId("transfer-confirm-button")).toBeDisabled();
  });

  it("keeps confirm disabled when address is valid but not all checklist items are checked", async () => {
    renderModal();

    await userEvent.type(screen.getByTestId("transfer-address-input"), TARGET_KEY);
    await userEvent.click(screen.getByTestId("transfer-checklist-item-0"));
    await userEvent.click(screen.getByTestId("transfer-checklist-item-1"));

    expect(screen.getByTestId("transfer-confirm-button")).toBeDisabled();
  });

  it("enables confirm once address is valid, not self, and all checklist items are checked, then submits", async () => {
    renderModal();

    await userEvent.type(screen.getByTestId("transfer-address-input"), TARGET_KEY);
    await userEvent.click(screen.getByTestId("transfer-checklist-item-0"));
    await userEvent.click(screen.getByTestId("transfer-checklist-item-1"));
    await userEvent.click(screen.getByTestId("transfer-checklist-item-2"));

    expect(screen.getByTestId("transfer-confirm-button")).toBeEnabled();

    await userEvent.click(screen.getByTestId("transfer-confirm-button"));

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
    });

    expect(mockBuildTransferSubscriptionTx).toHaveBeenCalledWith(USER_KEY, TARGET_KEY);
    expect(mockOnSign).toHaveBeenCalledWith("transfer-xdr");
  });

  it("shows a friendly error and does not call onSuccess when the build/sign call is rejected", async () => {
    mockBuildTransferSubscriptionTx.mockRejectedValue(new Error("no subscription found"));

    renderModal();

    await userEvent.type(screen.getByTestId("transfer-address-input"), TARGET_KEY);
    await userEvent.click(screen.getByTestId("transfer-checklist-item-0"));
    await userEvent.click(screen.getByTestId("transfer-checklist-item-1"));
    await userEvent.click(screen.getByTestId("transfer-checklist-item-2"));

    await userEvent.click(screen.getByTestId("transfer-confirm-button"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no subscription found/i);
    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it("populates the address input when an address is selected via the address book", async () => {
    renderModal();

    await userEvent.click(screen.getByTestId("transfer-address-book-button"));
    expect(screen.getByTestId("mock-address-book")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Pick Target"));

    expect(screen.getByTestId("transfer-address-input")).toHaveValue(TARGET_KEY);
  });
});
