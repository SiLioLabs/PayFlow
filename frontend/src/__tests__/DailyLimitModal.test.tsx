import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import DailyLimitModal from "../components/DailyLimitModal";

vi.mock("../stellar", () => ({
  getDailyLimit: vi.fn().mockResolvedValue(50000000n),
  buildSetDailyLimitTx: vi.fn().mockResolvedValue("limit-xdr"),
}));

describe("DailyLimitModal error accessibility (Issue #1262)", () => {
  const onSign = vi.fn().mockResolvedValue("tx-hash");
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const announce = vi.fn();

  it("announces validation error with role='alert' and associates input with aria-describedby", async () => {
    render(
      <DailyLimitModal
        userKey="GUSER123"
        onSign={onSign}
        onClose={onClose}
        onSuccess={onSuccess}
        announce={announce}
      />
    );

    const input = screen.getByTestId("amount-input");
    // Wait for async loadLimit to settle
    await waitFor(() => {
      expect(input).toHaveValue(5);
    });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    const saveBtn = screen.getByRole("button", { name: /save limit/i });
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Please enter a valid daily spending limit.");
    expect(alert).toHaveAttribute("id", "daily-limit-error");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("daily-limit-error");
  });
});
