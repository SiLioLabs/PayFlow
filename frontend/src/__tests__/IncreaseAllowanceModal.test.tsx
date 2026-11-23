import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import IncreaseAllowanceModal from "../components/IncreaseAllowanceModal";

vi.mock("../stellar", () => ({
  getAllowance: vi.fn().mockResolvedValue(10000000n),
  buildApproveTx: vi.fn().mockResolvedValue("approve-xdr"),
  TOKEN_CONTRACT_ID: "CTOKEN1234567890",
  CONTRACT_ID: "CCONTRACT1234567890",
}));

describe("IncreaseAllowanceModal error accessibility (Issue #1262)", () => {
  const onSign = vi.fn().mockResolvedValue("tx-hash");
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const announce = vi.fn();

  it("announces validation error with role='alert' and associates input with aria-describedby", async () => {
    render(
      <IncreaseAllowanceModal
        userKey="GUSER123"
        subscriptionAmount={10000000n}
        onSign={onSign}
        onClose={onClose}
        onSuccess={onSuccess}
        announce={announce}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("amount-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("amount-input");
    // Wait for async loadAllowance to settle
    await waitFor(() => {
      expect(input).toHaveValue(6);
    });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    const approveBtn = screen.getByRole("button", { name: /approve increase/i });
    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Please enter an amount to approve.");
    expect(alert).toHaveAttribute("id", "increase-allowance-error");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("increase-allowance-error");
  });
});
