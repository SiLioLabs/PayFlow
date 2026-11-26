import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConnectWallet from "../components/ConnectWallet";

describe("ConnectWallet", () => {
  it("starts a connection and shows the loading state", () => {
    const onConnect = vi.fn();
    const { rerender } = render(<ConnectWallet onConnect={onConnect} error={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    expect(onConnect).toHaveBeenCalledOnce();

    rerender(<ConnectWallet onConnect={onConnect} error={null} loading />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("renders a connection error accessibly", () => {
    render(<ConnectWallet onConnect={vi.fn()} error="Wallet not found" />);
    expect(screen.getByText("Wallet not found")).toHaveClass("text-danger");
  });
});