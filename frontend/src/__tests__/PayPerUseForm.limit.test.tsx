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

describe("PayPerUseForm daily limit UX (Issue 050)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows remaining when limit set and blocks submit when amount > remaining", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(
      <PayPerUseForm
        onPay={onPay}
        loading={false}
        dailyLimit={100_000_000n} // 10 XLM
        dailySpent={70_000_000n} // 7 XLM => remaining 3
        dayActive={true}
        isLimitLoading={false}
      />
    );

    expect(screen.getByText(/Remaining:/)).toBeInTheDocument();
    expect(screen.getByText(/Resets about 24 hours/)).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Amount in XLM/);
    const button = screen.getByRole("button", { name: /pay now/i });

    // Within limit: 3 XLM should be allowed
    await userEvent.clear(input);
    await userEvent.type(input, "3");
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.queryByTestId("ppu-limit-error")).not.toBeInTheDocument();

    // Exceeds remaining: 4 XLM > 3 remaining
    await userEvent.clear(input);
    await userEvent.type(input, "4");
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByTestId("ppu-limit-error")).toHaveTextContent(
      /Exceeds remaining daily budget/
    );
  });

  it("blocks when remaining is 0 (limit reached)", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(
      <PayPerUseForm
        onPay={onPay}
        loading={false}
        dailyLimit={50_000_000n}
        dailySpent={50_000_000n}
        dayActive={true}
      />
    );
    const input = screen.getByPlaceholderText(/Amount in XLM/);
    await userEvent.type(input, "1");
    const button = screen.getByRole("button", { name: /pay now/i });
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByTestId("ppu-limit-error")).toHaveTextContent(/Daily limit reached/);
  });

  it("does not block when no limit (uncapped)", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(<PayPerUseForm onPay={onPay} loading={false} dailyLimit={null} dailySpent={null} />);
    const input = screen.getByPlaceholderText(/Amount in XLM/);
    await userEvent.type(input, "100");
    const button = screen.getByRole("button", { name: /pay now/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.queryByTestId("ppu-limit-error")).not.toBeInTheDocument();
  });

  it("shows loading when isLimitLoading true", async () => {
    const onPay = vi.fn();
    render(
      <PayPerUseForm
        onPay={onPay}
        loading={false}
        isLimitLoading={true}
        dailyLimit={100_000_000n}
        dailySpent={0n}
      />
    );
    expect(screen.getByText(/Loading daily spending limit/)).toBeInTheDocument();
  });

  it("calls onPay only when not exceeding remaining", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(
      <PayPerUseForm
        onPay={onPay}
        loading={false}
        dailyLimit={100_000_000n}
        dailySpent={0n}
        dayActive={false}
      />
    );
    const input = screen.getByPlaceholderText(/Amount in XLM/);
    await userEvent.type(input, "5");
    await userEvent.click(screen.getByRole("button", { name: /pay now/i }));
    await waitFor(() => expect(onPay).toHaveBeenCalledWith(50_000_000n));
  });

  it("prevents onPay when amount exceeds remaining even if button somehow enabled", async () => {
    const onPay = vi.fn().mockResolvedValue(undefined);
    render(
      <PayPerUseForm
        onPay={onPay}
        loading={false}
        dailyLimit={10_000_000n}
        dailySpent={9_000_000n}
        dayActive={true}
      />
    );
    const input = screen.getByPlaceholderText(/Amount in XLM/);
    await userEvent.clear(input);
    await userEvent.type(input, "2"); // 2 XLM > 1 XLM remaining
    // Directly try to submit via form logic: button is disabled, but ensure onPay not called
    await userEvent.click(screen.getByRole("button", { name: /pay now/i }));
    expect(onPay).not.toHaveBeenCalled();
  });
});
