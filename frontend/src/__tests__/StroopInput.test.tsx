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

describe("StroopInput accessibility", () => {
  it("links error message to input via aria-describedby with matching id", () => {
    localStorage.setItem("flowpay_amount_unit", JSON.stringify("XLM"));
    const onChange = vi.fn();
    render(<StroopInput label="Amount" onChange={onChange} id="test-input" />);
    const input = screen.getByTestId("amount-input");

    // Trigger an error by entering an invalid value
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.blur(input);

    // Verify error element exists with correct id
    const errorElement = document.getElementById("test-input-error");
    expect(errorElement).toBeTruthy();
    expect(errorElement?.textContent).toBe("Must be a positive number");

    // Verify aria-describedby points to the error element
    expect(input.getAttribute("aria-describedby")).toBe("test-input-error");
  });

  it("uses unique error IDs for multiple instances", () => {
    localStorage.setItem("flowpay_amount_unit", JSON.stringify("XLM"));
    const onChange1 = vi.fn();
    const onChange2 = vi.fn();
    
    const { container } = render(
      <>
        <StroopInput label="Amount 1" onChange={onChange1} id="input-1" testId="input-1" />
        <StroopInput label="Amount 2" onChange={onChange2} id="input-2" testId="input-2" />
      </>
    );

    const input1 = screen.getByTestId("input-1");
    const input2 = screen.getByTestId("input-2");

    // Trigger errors on both inputs
    fireEvent.change(input1, { target: { value: "-5" } });
    fireEvent.blur(input1);
    fireEvent.change(input2, { target: { value: "-10" } });
    fireEvent.blur(input2);

    // Verify each has a unique error ID
    const error1 = document.getElementById("input-1-error");
    const error2 = document.getElementById("input-2-error");
    
    expect(error1).toBeTruthy();
    expect(error2).toBeTruthy();
    expect(input1.getAttribute("aria-describedby")).toBe("input-1-error");
    expect(input2.getAttribute("aria-describedby")).toBe("input-2-error");
  });

  it("removes aria-describedby when no error is present", () => {
    localStorage.setItem("flowpay_amount_unit", JSON.stringify("XLM"));
    const onChange = vi.fn();
    render(<StroopInput label="Amount" onChange={onChange} id="test-input" />);
    const input = screen.getByTestId("amount-input");

    // Initially no error
    expect(input.getAttribute("aria-describedby")).toBeNull();

    // Trigger an error
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.blur(input);
    expect(input.getAttribute("aria-describedby")).toBe("test-input-error");

    // Clear the error with a valid value
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(document.getElementById("test-input-error")).toBeNull();
  });
});