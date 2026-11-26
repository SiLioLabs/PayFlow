import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import AdminTransferPanel from "../components/admin/AdminTransferPanel";
import * as stellar from "../stellar";

vi.mock("../stellar", () => ({
  buildTransferAdminTx: vi.fn(),
  buildAcceptAdminTx: vi.fn(),
}));

// Valid G-addresses (56 chars, A-Z2-7)
const ADMIN =
  "GDTUJBPAVAOKJ7GAY3Z5UJ5NLDT7VC5RXUSPTEN4INUZRDYD6LTU7CMV";
const PENDING =
  "GCCQEZIDYMSG7PRH6TRNKJYJFTTRCHO2PU6PR5OQ4G66G52O5Z473J56";
const NEW_ADMIN =
  "GDUPU6QDLWLO3RCF4N6IILLEDPERBXZRPD3DSTEDI2QUL5XABGOYD7PW";

describe("AdminTransferPanel", () => {
  const onSign = vi.fn().mockResolvedValue("txhash");
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stellar.buildTransferAdminTx).mockResolvedValue("xdr_propose");
    vi.mocked(stellar.buildAcceptAdminTx).mockResolvedValue("xdr_accept");
  });

  it("renders current and pending admin addresses", () => {
    render(
      <AdminTransferPanel
        publicKey={ADMIN}
        onSign={onSign}
        isAdmin={true}
        isPendingAdmin={false}
        adminAddress={ADMIN}
        pendingAdminAddress={PENDING}
        onSuccess={onSuccess}
      />
    );
    expect(screen.getByTestId("current-admin-address").textContent).toBe(ADMIN);
    expect(screen.getByTestId("pending-admin-address").textContent).toBe(PENDING);
  });

  it("shows propose button for current admin", () => {
    render(
      <AdminTransferPanel
        publicKey={ADMIN}
        onSign={onSign}
        isAdmin={true}
        isPendingAdmin={false}
        adminAddress={ADMIN}
        pendingAdminAddress={null}
        onSuccess={onSuccess}
      />
    );
    expect(screen.getByTestId("propose-admin-btn")).toBeTruthy();
  });

  it("propose button is disabled when input is empty", () => {
    render(
      <AdminTransferPanel
        publicKey={ADMIN}
        onSign={onSign}
        isAdmin={true}
        isPendingAdmin={false}
        adminAddress={ADMIN}
        pendingAdminAddress={null}
        onSuccess={onSuccess}
      />
    );
    expect(screen.getByTestId("propose-admin-btn")).toBeDisabled();
  });

  it("shows accept button for pending admin", () => {
    render(
      <AdminTransferPanel
        publicKey={PENDING}
        onSign={onSign}
        isAdmin={false}
        isPendingAdmin={true}
        adminAddress={ADMIN}
        pendingAdminAddress={PENDING}
        onSuccess={onSuccess}
      />
    );
    expect(screen.getByTestId("accept-admin-btn")).toBeTruthy();
  });

  it("shows read-only message for wallets with no admin role", () => {
    render(
      <AdminTransferPanel
        publicKey="GOTHER"
        onSign={onSign}
        isAdmin={false}
        isPendingAdmin={false}
        adminAddress={ADMIN}
        pendingAdminAddress={null}
        onSuccess={onSuccess}
      />
    );
    expect(screen.getByText(/Connect as the current admin/)).toBeTruthy();
  });

  it("opens confirm modal when propose button is clicked with valid address", async () => {
    render(
      <AdminTransferPanel
        publicKey={ADMIN}
        onSign={onSign}
        isAdmin={true}
        isPendingAdmin={false}
        adminAddress={ADMIN}
        pendingAdminAddress={null}
        onSuccess={onSuccess}
      />
    );

    const input = screen.getByPlaceholderText("G…");
    fireEvent.change(input, { target: { value: NEW_ADMIN } });
    // Trigger immediate validation via blur (bypasses debounce).
    fireEvent.blur(input);

    await waitFor(
      () => {
        expect(screen.getByTestId("propose-admin-btn")).not.toBeDisabled();
      },
      { timeout: 2000 }
    );

    fireEvent.click(screen.getByTestId("propose-admin-btn"));
    expect(screen.getByTestId("confirm-propose-btn")).toBeTruthy();
  });

  it("calls buildTransferAdminTx and onSign on confirm", async () => {
    render(
      <AdminTransferPanel
        publicKey={ADMIN}
        onSign={onSign}
        isAdmin={true}
        isPendingAdmin={false}
        adminAddress={ADMIN}
        pendingAdminAddress={null}
        onSuccess={onSuccess}
      />
    );

    const input = screen.getByPlaceholderText("G…");
    fireEvent.change(input, { target: { value: NEW_ADMIN } });
    fireEvent.blur(input);

    await waitFor(
      () => {
        expect(screen.getByTestId("propose-admin-btn")).not.toBeDisabled();
      },
      { timeout: 2000 }
    );

    fireEvent.click(screen.getByTestId("propose-admin-btn"));
    fireEvent.click(screen.getByTestId("confirm-propose-btn"));

    await waitFor(() => {
      expect(stellar.buildTransferAdminTx).toHaveBeenCalledWith(ADMIN, NEW_ADMIN);
      expect(onSign).toHaveBeenCalledWith("xdr_propose");
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("calls buildAcceptAdminTx and onSign when pending admin accepts", async () => {
    render(
      <AdminTransferPanel
        publicKey={PENDING}
        onSign={onSign}
        isAdmin={false}
        isPendingAdmin={true}
        adminAddress={ADMIN}
        pendingAdminAddress={PENDING}
        onSuccess={onSuccess}
      />
    );

    fireEvent.click(screen.getByTestId("accept-admin-btn"));
    fireEvent.click(screen.getByTestId("confirm-accept-btn"));

    await waitFor(() => {
      expect(stellar.buildAcceptAdminTx).toHaveBeenCalledWith(PENDING);
      expect(onSign).toHaveBeenCalledWith("xdr_accept");
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("maps NoPendingAdmin error code 45 to a friendly message", async () => {
    vi.mocked(stellar.buildAcceptAdminTx).mockRejectedValue(
      new Error("Contract error: 45")
    );

    render(
      <AdminTransferPanel
        publicKey={PENDING}
        onSign={onSign}
        isAdmin={false}
        isPendingAdmin={true}
        adminAddress={ADMIN}
        pendingAdminAddress={PENDING}
        onSuccess={onSuccess}
      />
    );

    fireEvent.click(screen.getByTestId("accept-admin-btn"));
    fireEvent.click(screen.getByTestId("confirm-accept-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "No pending admin transfer exists"
      );
    });
  });
});
