import React, { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AddressInput from "../components/AddressInput";

const VALID_ADDRESS = "GCXO7NWYDZJGGZZIZK3VJLMY276XKV5ZOONULFCRUBCCOCVX5F5M36CR";

function TestWrapper({ initialValue = "" }: { initialValue?: string }) {
  const [val, setVal] = useState(initialValue);
  return <AddressInput label="Recipient Stellar Address" value={val} onChange={setVal} id="test-addr" />;
}

describe("AddressInput accessibility and validation", () => {
  it("associates label with input for an accessible name", () => {
    render(<TestWrapper />);
    const input = screen.getByRole("textbox", { name: "Recipient Stellar Address" });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("id", "test-addr");
  });

  it("does not flag empty input as invalid initially", () => {
    render(<TestWrapper />);
    const input = screen.getByRole("textbox", { name: "Recipient Stellar Address" });
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces validation error to assistive technology with role='alert' and sets aria-invalid", async () => {
    render(<TestWrapper />);
    const input = screen.getByRole("textbox", { name: "Recipient Stellar Address" });

    await userEvent.type(input, "not-a-valid-key");
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Invalid Stellar address");
    expect(alert).toHaveAttribute("id", "test-addr-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "test-addr-error");
  });

  it("clears error and removes aria-invalid and aria-describedby when a valid address is supplied", async () => {
    render(<TestWrapper />);
    const input = screen.getByRole("textbox", { name: "Recipient Stellar Address" });

    await userEvent.type(input, "invalid");
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    await userEvent.clear(input);
    await userEvent.type(input, VALID_ADDRESS);
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});
