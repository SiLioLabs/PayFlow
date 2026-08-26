import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AddressListInput from "../components/admin/AddressListInput";

const VALID_ADDR_1 = "GAEVL5Q7VI7A72TZLBHCNYEFGLC7GDQVOX4KKER67U6EUPR3LCZ3NULB";
const VALID_ADDR_2 = "GDSG7FQANGG6BP2QNVPKOBHDTKHTOBKRWK2LD6Z7OLZ4GXQXZDXE6AEL";

describe("AddressListInput", () => {
  it("renders the label and textarea", () => {
    render(<AddressListInput label="Test label" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Test label")).toBeTruthy();
  });

  it("shows valid count when all addresses are valid", () => {
    const input = `${VALID_ADDR_1}\n${VALID_ADDR_2}`;
    render(<AddressListInput label="Addresses" value={input} onChange={vi.fn()} />);
    expect(screen.getByText(/2 valid address/)).toBeTruthy();
  });

  it("shows invalid count when some addresses are bad", () => {
    const input = `${VALID_ADDR_1}\nnot-valid`;
    render(<AddressListInput label="Addresses" value={input} onChange={vi.fn()} />);
    expect(screen.getByText(/1 invalid address/)).toBeTruthy();
  });

  it("shows duplicate warning when duplicates are present", () => {
    const input = `${VALID_ADDR_1}\n${VALID_ADDR_1}`;
    render(<AddressListInput label="Addresses" value={input} onChange={vi.fn()} />);
    expect(screen.getByText(/1 duplicate/)).toBeTruthy();
  });

  it("calls onChange when the user types", async () => {
    const onChange = vi.fn();
    render(<AddressListInput label="Addresses" value="" onChange={onChange} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "G");
    expect(onChange).toHaveBeenCalled();
  });

  it("sets aria-invalid when there are invalid addresses", () => {
    const input = `${VALID_ADDR_1}\nbad`;
    render(<AddressListInput label="Addresses" value={input} onChange={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
  });

  it("does not set aria-invalid when all addresses are valid", () => {
    render(<AddressListInput label="Addresses" value={VALID_ADDR_1} onChange={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea.getAttribute("aria-invalid")).toBe("false");
  });

  it("is disabled when disabled prop is true", () => {
    render(<AddressListInput label="Addresses" value="" onChange={vi.fn()} disabled={true} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("shows no status content when input is empty", () => {
    render(<AddressListInput label="Addresses" value="" onChange={vi.fn()} />);
    // No count indicators should be rendered for empty input
    expect(screen.queryByText(/valid address/)).toBeNull();
    expect(screen.queryByText(/invalid address/)).toBeNull();
  });
});
