import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useStellarBalance } from "../hooks/useStellarBalance";
import BalanceDisplay from "../components/BalanceDisplay";

vi.mock("../hooks/useStellarBalance", () => ({
  useStellarBalance: vi.fn(),
}));

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("BalanceDisplay", () => {
  it("surfaces a balance error instead of showing a zero balance", () => {
    vi.mocked(useStellarBalance).mockReturnValue({
      balance: "0",
      loading: false,
      stale: false,
      error: "RPC unreachable",
    });

    render(<BalanceDisplay address={ADDRESS} />);

    const error = screen.getByTestId("balance-error");
    expect(error).toHaveTextContent("Unavailable");
    expect(error).toHaveAttribute("title", "RPC unreachable");
    expect(error).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/0\.0000000 XLM/)).not.toBeInTheDocument();
  });
});
