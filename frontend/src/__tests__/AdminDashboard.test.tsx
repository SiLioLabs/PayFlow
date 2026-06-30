import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../hooks/useAdmin");
vi.mock("../stellar");
vi.mock("../hooks/useSubscription", () => ({
  useSubscription: vi.fn(() => ({
    subscription: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));
vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(() => ({
    status: "idle",
    hash: null,
    error: null,
    submit: vi.fn(),
  })),
}));

import { useAdmin } from "../hooks/useAdmin";
import AdminDashboard from "../pages/AdminDashboard";

describe("AdminDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAdmin).mockReturnValue({
      adminAddress: "GADMIN123",
      isAdmin: true,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it("renders the admin dashboard with subscription repair section", async () => {
    render(<AdminDashboard publicKey="GADMIN123" onSign={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Admin Dashboard")).toBeTruthy();
    });

    expect(screen.getByText("Subscription Repair")).toBeTruthy();
    expect(screen.getByRole("button", { name: /validate subscription/i })).toBeTruthy();
  });

  it("shows read-only guidance for non-admin wallets", async () => {
    vi.mocked(useAdmin).mockReturnValue({
      adminAddress: "GADMIN123",
      isAdmin: false,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<AdminDashboard publicKey="GUSER456" onSign={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Diagnostic tools are available in read-only mode/)
      ).toBeTruthy();
    });
  });
});
