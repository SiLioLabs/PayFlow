import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import IntervalSelector from "../components/IntervalSelector";
import { BILLING_INTERVALS, SECONDS_PER_DAY } from "../constants";

function TestWrapper({ initial = BILLING_INTERVALS[0].value, onValChange }: { initial?: number; onValChange?: (v: number) => void }) {
  const [val, setVal] = useState(initial);
  return (
    <IntervalSelector
      value={val}
      onChange={(v) => {
        setVal(v);
        onValChange?.(v);
      }}
    />
  );
}

describe("IntervalSelector accessible names (Issue #1261)", () => {
  it("associates the billing interval label with the select control", () => {
    render(<TestWrapper />);

    const select = screen.getByRole("combobox", { name: "Billing interval" });
    expect(select).toBeInTheDocument();
    expect(select).toHaveAttribute("id", "billing-interval-select");
  });

  it("does not render custom days input when a preset interval is chosen", () => {
    render(<TestWrapper />);

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("renders and associates the custom-days input with distinct label when Custom is selected", async () => {
    const onValChange = vi.fn();
    render(<TestWrapper onValChange={onValChange} />);

    const select = screen.getByRole("combobox", { name: "Billing interval" });
    await userEvent.selectOptions(select, "-1");

    const customInput = screen.getByRole("spinbutton", { name: "Custom interval in days" });
    expect(customInput).toBeInTheDocument();
    expect(customInput).toHaveAttribute("id", "billing-interval-select-custom-days");

    await userEvent.type(customInput, "7");
    expect(onValChange).toHaveBeenCalledWith(7 * SECONDS_PER_DAY);
  });
});
