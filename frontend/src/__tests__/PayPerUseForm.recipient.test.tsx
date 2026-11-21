import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

// Deterministic, checksum-valid Stellar Ed25519 public key (verified via
// StrKey.isValidEd25519PublicKey).
const VALID_RECIPIENT = "GCOEYT3WI3LY34I7DN7BR7AF33TNF2YF4OYTLVPJKMYAWT2RWEF5BUDK";

describe("PayPerUseForm recipient flow (Issue 073)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an optional recipient field", () => {
    render(<PayPerUseForm onPay={vi.fn()} loading={false} />);
    expect(screen.getByPlaceholderText(/Recipient address/i)).toBeInTheDocument();
  });

  it("calls onPay with only the amount when the recipient is empty", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(<PayPerUseForm onPay={onPay} loading={false} />);

    const amountInput = screen.getByPlaceholderText(/Amount in XLM/);
    const button = screen.getByRole("button", { name: /pay now/i });

    await userEvent.type(amountInput, "5");
    await waitFor(() => expect(button).not.toBeDisabled());
    await userEvent.click(button);

    await waitFor(() => expect(onPay).toHaveBeenCalledWith(50_000_000n));
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it("calls onPay with the amount and recipient when a valid recipient is set", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(<PayPerUseForm onPay={onPay} loading={false} />);

    const amountInput = screen.getByPlaceholderText(/Amount in XLM/);
    const recipientInput = screen.getByPlaceholderText(/Recipient address/i);
    const button = screen.getByRole("button", { name: /pay now/i });

    await userEvent.type(amountInput, "5");
    await userEvent.type(recipientInput, VALID_RECIPIENT);
    await waitFor(() => expect(button).not.toBeDisabled());
    await userEvent.click(button);

    await waitFor(() =>
      expect(onPay).toHaveBeenCalledWith(50_000_000n, VALID_RECIPIENT)
    );
  });

  it("blocks submit and shows an inline error for an invalid recipient", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(<PayPerUseForm onPay={onPay} loading={false} />);

    const amountInput = screen.getByPlaceholderText(/Amount in XLM/);
    const recipientInput = screen.getByPlaceholderText(/Recipient address/i);
    const button = screen.getByRole("button", { name: /pay now/i });

    await userEvent.type(amountInput, "5");
    await userEvent.type(recipientInput, "not-a-real-address");

    await waitFor(() =>
      expect(screen.getByTestId("ppu-recipient-error")).toHaveTextContent(
        /Invalid recipient address/
      )
    );
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onPay).not.toHaveBeenCalled();
  });

  it("clears the recipient error once a valid recipient is entered", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(<PayPerUseForm onPay={onPay} loading={false} />);

    const recipientInput = screen.getByPlaceholderText(/Recipient address/i);

    await userEvent.type(recipientInput, "bad-address");
    expect(screen.getByTestId("ppu-recipient-error")).toBeInTheDocument();

    await userEvent.clear(recipientInput);
    expect(screen.queryByTestId("ppu-recipient-error")).not.toBeInTheDocument();
  });
});
