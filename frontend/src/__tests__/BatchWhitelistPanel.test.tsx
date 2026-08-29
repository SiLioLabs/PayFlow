import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../stellar");
vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(() => ({
    status: "idle",
    hash: null,
    error: null,
    submit: vi.fn(async (fn: () => Promise<string>) => fn()),
  })),
}));
vi.mock("../hooks/useToast", () => ({
  useToast: vi.fn(() => ({
    toasts: [],
    addToast: vi.fn(),
    removeToast: vi.fn(),
  })),
}));

import * as stellar from "../stellar";
import { useTransaction } from "../hooks/useTransaction";
import BatchWhitelistPanel from "../components/admin/BatchWhitelistPanel";

// Generated via Keypair.random() — checksum-valid for StrKey.isValidEd25519PublicKey
const VALID_ADDR_1 = "GCOEYT3WI3LY34I7DN7BR7AF33TNF2YF4OYTLVPJKMYAWT2RWEF5BUDK";
const VALID_ADDR_2 = "GAEVL5Q7VI7A72TZLBHCNYEFGLC7GDQVOX4KKER67U6EUPR3LCZ3NULB";

describe("BatchWhitelistPanel", () => {
  const defaultProps = {
    adminKey: "GADMIN123",
    onSign: vi.fn().mockResolvedValue("tx-hash"),
    isAdmin: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stellar.buildWhitelistBatchAddTx).mockResolvedValue("xdr-add");
    vi.mocked(stellar.buildWhitelistBatchRemoveTx).mockResolvedValue("xdr-remove");
    vi.mocked(useTransaction).mockReturnValue({
      status: "idle",
      hash: null,
      error: null,
      submit: vi.fn(async (fn: () => Promise<string>) => fn()),
    });
  });

  it("renders the section heading", () => {
    render(<BatchWhitelistPanel {...defaultProps} />);
    expect(screen.getByText("Batch Whitelist Management")).toBeTruthy();
  });

  it("shows admin access warning for non-admin wallets", () => {
    render(<BatchWhitelistPanel {...defaultProps} isAdmin={false} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Admin access required to modify the whitelist/)).toBeTruthy();
  });

  it("defaults to 'Add merchants' action", () => {
    render(<BatchWhitelistPanel {...defaultProps} />);
    const addRadio = screen.getByRole("radio", { name: /add merchants/i });
    expect((addRadio as HTMLInputElement).checked).toBe(true);
  });

  it("disables submit when no addresses entered", () => {
    render(<BatchWhitelistPanel {...defaultProps} />);
    expect(screen.getByRole("button", { name: /add to whitelist/i })).toBeDisabled();
  });

  it("disables submit for non-admin even with valid addresses", async () => {
    render(<BatchWhitelistPanel {...defaultProps} isAdmin={false} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, VALID_ADDR_1);
    // Button label changes based on action; for non-admin it stays disabled
    const buttons = screen.getAllByRole("button");
    const submitBtn = buttons.find(
      (b) =>
        b.textContent?.toLowerCase().includes("add") ||
        b.textContent?.toLowerCase().includes("remove")
    );
    expect(submitBtn).toBeDisabled();
  });

  it("shows preview for add action", async () => {
    render(<BatchWhitelistPanel {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, `${VALID_ADDR_1}\n${VALID_ADDR_2}`);

    await waitFor(() => {
      expect(screen.getByText(/2 merchant/)).toBeTruthy();
      expect(screen.getByText(/added to/)).toBeTruthy();
    });
  });

  it("switches to remove action and shows correct preview", async () => {
    render(<BatchWhitelistPanel {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, VALID_ADDR_1);

    await userEvent.click(screen.getByRole("radio", { name: /remove merchants/i }));

    await waitFor(() => {
      expect(screen.getByText(/removed from/)).toBeTruthy();
    });
  });

  it("shows confirmation modal before submitting", async () => {
    render(<BatchWhitelistPanel {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, VALID_ADDR_1);

    await userEvent.click(screen.getByRole("button", { name: /add to whitelist/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("calls buildWhitelistBatchAddTx when add action is confirmed", async () => {
    const onSign = vi.fn().mockResolvedValue("tx-hash");
    render(<BatchWhitelistPanel {...defaultProps} onSign={onSign} />);

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, VALID_ADDR_1);
    await userEvent.click(screen.getByRole("button", { name: /add to whitelist/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(stellar.buildWhitelistBatchAddTx).toHaveBeenCalledWith("GADMIN123", [VALID_ADDR_1]);
    });
    expect(stellar.buildWhitelistBatchRemoveTx).not.toHaveBeenCalled();
  });

  it("calls buildWhitelistBatchRemoveTx when remove action is confirmed", async () => {
    const onSign = vi.fn().mockResolvedValue("tx-hash");
    render(<BatchWhitelistPanel {...defaultProps} onSign={onSign} />);

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, VALID_ADDR_1);
    await userEvent.click(screen.getByRole("radio", { name: /remove merchants/i }));
    await userEvent.click(screen.getByRole("button", { name: /remove from whitelist/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(stellar.buildWhitelistBatchRemoveTx).toHaveBeenCalledWith("GADMIN123", [VALID_ADDR_1]);
    });
    expect(stellar.buildWhitelistBatchAddTx).not.toHaveBeenCalled();
  });

  it("cancels without submitting when cancel is clicked", async () => {
    render(<BatchWhitelistPanel {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, VALID_ADDR_1);

    await userEvent.click(screen.getByRole("button", { name: /add to whitelist/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(stellar.buildWhitelistBatchAddTx).not.toHaveBeenCalled();
  });
});
