import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONTRACT_LIMITS, MAX_STROOPS, MIN_STROOPS } from "../constants";
import StroopInput, { validateStroopAmount } from "../components/StroopInput";
import { validateStroopAmount as validateFormAmount } from "../hooks/useFormValidation";

describe("StroopInput amount limits", () => {
  it("pins the frontend limits and their contract source values", () => {
    expect(MIN_STROOPS).toBe(1n);
    expect(MAX_STROOPS).toBe(9_000_000_000_000_000n);
    expect(MAX_STROOPS).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));

    // These mirror MAX_AMOUNT and MAX_SUBSCRIPTION_AMOUNT in contract/src/lib.rs.
    expect(CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT).toBe(100_000_000_000n);
    expect(CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT).toBe(100_000_000_000_000n);
  });

  it("accepts exactly the maximum and minimum and rejects out-of-range values", () => {
    expect(validateStroopAmount(MAX_STROOPS.toString(), "STROOP")).toEqual({
      stroops: MAX_STROOPS,
      error: null,
    });
    expect(validateStroopAmount((MAX_STROOPS + 1n).toString(), "STROOP").stroops).toBeNull();
    expect(validateStroopAmount(MIN_STROOPS.toString(), "STROOP")).toEqual({
      stroops: MIN_STROOPS,
      error: null,
    });
    expect(validateStroopAmount((MIN_STROOPS - 1n).toString(), "STROOP").stroops).toBeNull();
    expect(validateStroopAmount("0.0000001", "XLM").stroops).toBe(MIN_STROOPS);
  });

  it("keeps shared form validation within its contract-specific amount cap", () => {
    const maxSubscriptionXlm = "10000000";
    const aboveMaxSubscriptionXlm = "10000000.0000001";

    expect(validateFormAmount(maxSubscriptionXlm, CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT).valid).toBe(true);
    expect(validateFormAmount(aboveMaxSubscriptionXlm, CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT).valid).toBe(false);
    expect(validateFormAmount("0.0000001", CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT).valid).toBe(true);
    expect(validateFormAmount("0", CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT).valid).toBe(false);
  });

  it("enforces the same boundaries through the component", () => {
    localStorage.setItem("flowpay_amount_unit", JSON.stringify("STROOP"));
    const onChange = vi.fn();
    render(<StroopInput label="Amount" onChange={onChange} />);
    const input = screen.getByTestId("amount-input");

    fireEvent.change(input, { target: { value: MAX_STROOPS.toString() } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(MAX_STROOPS);

    fireEvent.change(input, { target: { value: (MAX_STROOPS + 1n).toString() } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.change(input, { target: { value: MIN_STROOPS.toString() } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(MIN_STROOPS);
  });
});