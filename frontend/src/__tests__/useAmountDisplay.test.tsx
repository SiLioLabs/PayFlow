/**
 * Tests for useAmountDisplay hook and displayAmount utility (Issue #669).
 *
 * Coverage:
 *  - displayAmount conversion correctness for XLM and STROOP units
 *  - Edge cases: 0, 1 stroop, very large amounts
 *  - useAmountDisplay hook: initial unit defaults to "XLM"
 *  - useAmountDisplay hook: setUnit persists to localStorage
 *  - useAmountDisplay hook: toggleUnit flips between XLM and STROOP
 *  - useAmountDisplay hook: displayCurrentAmount uses stored preference
 *  - AmountUnitToggle component: renders, toggles, aria attributes
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";

import { displayAmount } from "../utils/format";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import AmountUnitToggle from "../components/AmountUnitToggle";

// ── displayAmount conversion unit tests ───────────────────────────────────────

describe("displayAmount utility", () => {
  describe("XLM unit", () => {
    it("formats 0 stroops as 0.0000000 XLM", () => {
      expect(displayAmount(0, "XLM")).toBe("0.0000000 XLM");
    });

    it("formats 1 stroop as 0.0000001 XLM (full 7-decimal precision)", () => {
      expect(displayAmount(1, "XLM")).toBe("0.0000001 XLM");
    });

    it("formats 10_000_000 stroops (1 XLM) as 1.0000000 XLM", () => {
      expect(displayAmount(10_000_000, "XLM")).toBe("1.0000000 XLM");
    });

    it("formats 50_000_000 stroops (5 XLM) as 5.0000000 XLM", () => {
      expect(displayAmount(50_000_000, "XLM")).toBe("5.0000000 XLM");
    });

    it("formats 12_345_678 stroops correctly (1.2345678 XLM)", () => {
      expect(displayAmount(12_345_678, "XLM")).toBe("1.2345678 XLM");
    });

    it("accepts bigint input", () => {
      expect(displayAmount(10_000_000n, "XLM")).toBe("1.0000000 XLM");
    });

    it("accepts string input", () => {
      expect(displayAmount("10000000", "XLM")).toBe("1.0000000 XLM");
    });

    it("formats large amount with comma thousands separators", () => {
      // 10_000_000_000_000 stroops = 1,000,000 XLM
      const result = displayAmount(10_000_000_000_000, "XLM");
      expect(result).toContain("1,000,000");
      expect(result).toContain("XLM");
    });

    it("formats 100_000_000_000_000 stroops (max: 10,000,000 XLM) correctly", () => {
      const result = displayAmount(100_000_000_000_000n, "XLM");
      expect(result).toContain("10,000,000");
      expect(result).toContain("XLM");
    });
  });

  describe("STROOP unit", () => {
    it("formats 0 stroops as '0 STROOP'", () => {
      expect(displayAmount(0, "STROOP")).toBe("0 STROOP");
    });

    it("formats 1 stroop as '1 STROOP'", () => {
      expect(displayAmount(1, "STROOP")).toBe("1 STROOP");
    });

    it("formats 10_000_000 stroops as '10,000,000 STROOP'", () => {
      expect(displayAmount(10_000_000, "STROOP")).toBe("10,000,000 STROOP");
    });

    it("formats large stroop amount with comma separators", () => {
      const result = displayAmount(100_000_000_000_000n, "STROOP");
      expect(result).toContain("100,000,000,000,000");
      expect(result).toContain("STROOP");
    });

    it("accepts string input", () => {
      expect(displayAmount("50000000", "STROOP")).toBe("50,000,000 STROOP");
    });

    it("accepts bigint input", () => {
      expect(displayAmount(50_000_000n, "STROOP")).toBe("50,000,000 STROOP");
    });
  });
});

// ── useAmountDisplay hook tests ───────────────────────────────────────────────

describe("useAmountDisplay hook", () => {
  beforeEach(() => {
    // Clear localStorage between tests so unit preference doesn't leak
    localStorage.clear();
  });

  it("defaults to 'XLM' unit when no preference is stored", () => {
    const { result } = renderHook(() => useAmountDisplay());
    expect(result.current.unit).toBe("XLM");
  });

  it("restores persisted 'STROOP' unit from localStorage", () => {
    localStorage.setItem("flowpay_amount_unit", JSON.stringify("STROOP"));
    const { result } = renderHook(() => useAmountDisplay());
    expect(result.current.unit).toBe("STROOP");
  });

  it("setUnit changes the unit to STROOP", () => {
    const { result } = renderHook(() => useAmountDisplay());
    act(() => {
      result.current.setUnit("STROOP");
    });
    expect(result.current.unit).toBe("STROOP");
  });

  it("setUnit persists the preference to localStorage", () => {
    const { result } = renderHook(() => useAmountDisplay());
    act(() => {
      result.current.setUnit("STROOP");
    });
    expect(JSON.parse(localStorage.getItem("flowpay_amount_unit") || "null")).toBe("STROOP");
  });

  it("toggleUnit flips from XLM to STROOP", () => {
    const { result } = renderHook(() => useAmountDisplay());
    expect(result.current.unit).toBe("XLM");
    act(() => {
      result.current.toggleUnit();
    });
    expect(result.current.unit).toBe("STROOP");
  });

  it("toggleUnit flips from STROOP back to XLM", () => {
    localStorage.setItem("flowpay_amount_unit", JSON.stringify("STROOP"));
    const { result } = renderHook(() => useAmountDisplay());
    act(() => {
      result.current.toggleUnit();
    });
    expect(result.current.unit).toBe("XLM");
  });

  it("displayCurrentAmount uses 'XLM' unit when set to XLM", () => {
    const { result } = renderHook(() => useAmountDisplay());
    // Default is XLM
    const formatted = result.current.displayCurrentAmount(10_000_000);
    expect(formatted).toBe("1.0000000 XLM");
  });

  it("displayCurrentAmount uses 'STROOP' unit when set to STROOP", () => {
    const { result } = renderHook(() => useAmountDisplay());
    act(() => {
      result.current.setUnit("STROOP");
    });
    const formatted = result.current.displayCurrentAmount(10_000_000);
    expect(formatted).toBe("10,000,000 STROOP");
  });

  it("displayAmount function is available for explicit unit formatting", () => {
    const { result } = renderHook(() => useAmountDisplay());
    // Use explicit STROOP even though preference is XLM
    expect(result.current.displayAmount(1, "STROOP")).toBe("1 STROOP");
    expect(result.current.displayAmount(1, "XLM")).toBe("0.0000001 XLM");
  });

  it("displayCurrentAmount updates all callers when unit changes (toggle updates displays)", () => {
    const { result } = renderHook(() => useAmountDisplay());
    const stroops = 50_000_000; // 5 XLM

    // Initially XLM
    expect(result.current.displayCurrentAmount(stroops)).toBe("5.0000000 XLM");

    // Toggle to STROOP
    act(() => {
      result.current.toggleUnit();
    });
    expect(result.current.displayCurrentAmount(stroops)).toBe("50,000,000 STROOP");

    // Toggle back to XLM
    act(() => {
      result.current.toggleUnit();
    });
    expect(result.current.displayCurrentAmount(stroops)).toBe("5.0000000 XLM");
  });
});

// ── AmountUnitToggle component tests ─────────────────────────────────────────

describe("AmountUnitToggle component", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the toggle button", () => {
    render(<AmountUnitToggle />);
    expect(screen.getByTestId("amount-unit-toggle")).toBeInTheDocument();
  });

  it("shows 'XLM' as default display value", () => {
    render(<AmountUnitToggle />);
    expect(screen.getByTestId("amount-unit-value")).toHaveTextContent("XLM");
  });

  it("shows 'STROOP' after clicking toggle once", () => {
    render(<AmountUnitToggle />);
    fireEvent.click(screen.getByTestId("amount-unit-toggle"));
    expect(screen.getByTestId("amount-unit-value")).toHaveTextContent("STROOP");
  });

  it("shows 'XLM' again after clicking toggle twice", () => {
    render(<AmountUnitToggle />);
    fireEvent.click(screen.getByTestId("amount-unit-toggle"));
    fireEvent.click(screen.getByTestId("amount-unit-toggle"));
    expect(screen.getByTestId("amount-unit-value")).toHaveTextContent("XLM");
  });

  it("has role='switch' for accessibility", () => {
    render(<AmountUnitToggle />);
    expect(screen.getByTestId("amount-unit-toggle")).toHaveAttribute("role", "switch");
  });

  it("has aria-checked='true' when unit is XLM", () => {
    render(<AmountUnitToggle />);
    expect(screen.getByTestId("amount-unit-toggle")).toHaveAttribute("aria-checked", "true");
  });

  it("has aria-checked='false' when unit is STROOP", () => {
    render(<AmountUnitToggle />);
    fireEvent.click(screen.getByTestId("amount-unit-toggle"));
    expect(screen.getByTestId("amount-unit-toggle")).toHaveAttribute("aria-checked", "false");
  });

  it("has an accessible aria-label describing the action", () => {
    render(<AmountUnitToggle />);
    const btn = screen.getByTestId("amount-unit-toggle");
    expect(btn).toHaveAttribute("aria-label", expect.stringContaining("XLM"));
  });

  it("persists preference to localStorage when toggled", () => {
    render(<AmountUnitToggle />);
    fireEvent.click(screen.getByTestId("amount-unit-toggle"));
    expect(JSON.parse(localStorage.getItem("flowpay_amount_unit") || "null")).toBe("STROOP");
  });

  it("restores persisted STROOP preference from localStorage on mount", () => {
    localStorage.setItem("flowpay_amount_unit", JSON.stringify("STROOP"));
    render(<AmountUnitToggle />);
    expect(screen.getByTestId("amount-unit-value")).toHaveTextContent("STROOP");
  });
});
