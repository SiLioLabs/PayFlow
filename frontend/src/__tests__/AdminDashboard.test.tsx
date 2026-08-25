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
vi.mock("../hooks/useToast", () => ({
  useToast: vi.fn(() => ({
    toasts: [],
    addToast: vi.fn(),
    removeToast: vi.fn(),
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

  it("renders the admin dashboard heading", async () => {
    render(<AdminDashboard publicKey="GADMIN123" onSign={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Admin Dashboard")).toBeTruthy();
    });
  });

  it("renders the subscription repair section", async () => {
    render(<AdminDashboard publicKey="GADMIN123" onSign={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Subscription Repair")).toBeTruthy();
    });
  });

  it("renders the batch pause section", async () => {
    render(<AdminDashboard publicKey="GADMIN123" onSign={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Batch Pause Subscriptions")).toBeTruthy();
    });
  });

  it("renders the batch whitelist section", async () => {
    render(<AdminDashboard publicKey="GADMIN123" onSign={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Batch Whitelist Management")).toBeTruthy();
    });
  });

  it("shows authorized admin status message", async () => {
    render(<AdminDashboard publicKey="GADMIN123" onSign={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Authorized as contract admin/)).toBeTruthy();
    });
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
      expect(screen.getByText(/Diagnostic tools are available in read-only mode/)).toBeTruthy();
    });
  });

  it("shows admin access required alerts for non-admin wallets on batch sections", async () => {
    vi.mocked(useAdmin).mockReturnValue({
      adminAddress: "GADMIN123",
      isAdmin: false,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<AdminDashboard publicKey="GUSER456" onSign={vi.fn()} />);

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      // Expect at least the batch pause and whitelist warnings
      expect(alerts.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows loading spinner while admin status is loading", async () => {
    vi.mocked(useAdmin).mockReturnValue({
      adminAddress: null,
      isAdmin: false,
      loading: true,
      error: null,
      refresh: vi.fn(),
    });

    render(<AdminDashboard publicKey="GADMIN123" onSign={vi.fn()} />);
    expect(screen.getByText(/Loading admin context/)).toBeTruthy();
  });

  it("batch pause panel submit is disabled for non-admin", async () => {
    vi.mocked(useAdmin).mockReturnValue({
      adminAddress: "GADMIN123",
      isAdmin: false,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<AdminDashboard publicKey="GUSER456" onSign={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pause subscriptions/i })).toBeDisabled();
    });
  });

  it("whitelist submit is disabled for non-admin", async () => {
    vi.mocked(useAdmin).mockReturnValue({
      adminAddress: "GADMIN123",
      isAdmin: false,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<AdminDashboard publicKey="GUSER456" onSign={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add to whitelist/i })).toBeDisabled();
    });
  });
});
