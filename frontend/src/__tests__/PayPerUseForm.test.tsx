import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PayPerUseForm from "../components/PayPerUseForm";

vi.mock("../hooks/useAmountDisplay", () => ({
  useAmountDisplay: () => ({
    displayCurrentAmount: (v: bigint) => `${Number(v) / 10_000_000} XLM`,
    unit: "XLM" as const,
    setUnit: vi.fn(),
  }),
}));

describe("PayPerUseForm accessibility and single validation source (Issue #1261, #1262, #1263)", () => {
  const onPay = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gives the amount input and recipient input clear accessible names", () => {
    render(<PayPerUseForm onPay={onPay} loading={false} />);

    const amountInput = screen.getByRole("spinbutton", { name: /amount/i });
    expect(amountInput).toBeInTheDocument();
    expect(amountInput).toHaveAttribute("id", "ppu-amount-input");

    const recipientInput = screen.getByRole("textbox", { name: /recipient address/i });
    expect(recipientInput).toBeInTheDocument();
    expect(recipientInput).toHaveAttribute("id", "ppu-recipient-input");
  });

  it("renders exactly one error node when amount input is invalid", async () => {
    render(<PayPerUseForm onPay={onPay} loading={false} />);

    const amountInput = screen.getByRole("spinbutton", { name: /amount/i });

    // Enter a negative amount to trigger validation failure
    await userEvent.type(amountInput, "-5");

    // Check that exactly one error element is rendered in the DOM
    const errors = screen.getAllByText(/Must be a positive number/i);
    expect(errors).toHaveLength(1);

    const errorEl = errors[0];
    expect(errorEl).toHaveAttribute("id", "ppu-amount-error");
    expect(errorEl).toHaveAttribute("role", "alert");
    expect(errorEl).toHaveAttribute("data-testid", "ppu-amount-error");

    // Verify aria attributes on the input
    expect(amountInput).toHaveAttribute("aria-invalid", "true");
    expect(amountInput).toHaveAttribute("aria-describedby", "ppu-amount-error");
  });

  it("clears error and removes aria-invalid when amount becomes valid", async () => {
    render(<PayPerUseForm onPay={onPay} loading={false} />);

    const amountInput = screen.getByRole("spinbutton", { name: /amount/i });

    await userEvent.type(amountInput, "-5");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(amountInput).toHaveAttribute("aria-invalid", "true");

    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, "2");

    expect(screen.queryByTestId("ppu-amount-error")).not.toBeInTheDocument();
    expect(amountInput).not.toHaveAttribute("aria-invalid");
    expect(amountInput).not.toHaveAttribute("aria-describedby");
  });

  it("exposes recipient validation errors with aria-invalid and role='alert'", async () => {
    render(<PayPerUseForm onPay={onPay} loading={false} />);

    const recipientInput = screen.getByRole("textbox", { name: /recipient address/i });
    expect(recipientInput).not.toHaveAttribute("aria-invalid");

    await userEvent.type(recipientInput, "invalid-key");

    await waitFor(() => {
      const recipientError = screen.getByTestId("ppu-recipient-error");
      expect(recipientError).toBeInTheDocument();
      expect(recipientError).toHaveAttribute("role", "alert");
      expect(recipientInput).toHaveAttribute("aria-invalid", "true");
      expect(recipientInput).toHaveAttribute("aria-describedby", "ppu-recipient-error");
    });

    await userEvent.clear(recipientInput);
    await waitFor(() => {
      expect(screen.queryByTestId("ppu-recipient-error")).not.toBeInTheDocument();
      expect(recipientInput).not.toHaveAttribute("aria-invalid");
      expect(recipientInput).not.toHaveAttribute("aria-describedby");
    });
  });
});
