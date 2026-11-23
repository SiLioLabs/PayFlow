/**
 * ChargeReceipt — component tests (#1465)
 *
 * Coverage:
 *  - Renders merchant address and display name
 *  - Renders formatted amount in XLM
 *  - Renders date in human-readable form
 *  - Renders full transaction hash
 *  - Explorer link uses the configured network URL
 *  - Print button is present and labelled
 *  - Close button calls onClose
 *  - Modal overlay click calls onClose
 *  - Renders inline (modal=false) without modal wrapper
 *  - Protocol fee rows absent when VITE_PROTOCOL_FEE_BPS is not set
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ChargeReceipt from "../components/ChargeReceipt";
import type { ChargeEvent } from "../types";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("../stellar", () => ({
  explorerTxUrl: (hash: string) =>
    `https://stellar.expert/explorer/testnet/tx/${hash}`,
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TX_HASH =
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

const MERCHANT = "GBZXN7PIRZGNMHGA7QA7FBT3BTSCKPF5ZJMPKH3VGZRWMHBKIUCMPHB";

const SAMPLE_EVENT: ChargeEvent = {
  date: new Date("2026-11-20T14:35:00.000Z"),
  amount: "50000000", // 5 XLM
  txHash: TX_HASH,
  merchant: MERCHANT,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ChargeReceipt", () => {
  describe("inline (modal=false)", () => {
    beforeEach(() => {
      render(
        <div className="card">
          <ChargeReceipt event={SAMPLE_EVENT} modal={false} />
        </div>
      );
    });

    it("renders the receipt container", () => {
      expect(screen.getByTestId("charge-receipt")).toBeInTheDocument();
    });

    it("displays the merchant address", () => {
      expect(screen.getByTestId("receipt-merchant")).toHaveTextContent(MERCHANT);
    });

    it("displays the amount in XLM (7 decimal places)", () => {
      expect(screen.getByTestId("receipt-amount")).toHaveTextContent("5.0000000 XLM");
    });

    it("displays a human-readable date", () => {
      const dateCell = screen.getByTestId("receipt-date");
      // We only assert the year appears; locale formatting varies by runner.
      expect(dateCell.textContent).toMatch(/2026/);
    });

    it("displays the full transaction hash", () => {
      expect(screen.getByTestId("receipt-tx-hash")).toHaveTextContent(TX_HASH);
    });

    it("renders an explorer link containing the tx hash", () => {
      const link = screen.getByTestId("receipt-explorer-link").querySelector("a");
      expect(link).not.toBeNull();
      expect(link!.href).toContain(TX_HASH);
    });

    it("explorer link targets the correct network", () => {
      const link = screen.getByTestId("receipt-explorer-link").querySelector("a");
      expect(link!.href).toContain("testnet");
    });

    it("does not render a fee row when VITE_PROTOCOL_FEE_BPS is not set", () => {
      expect(screen.queryByTestId("receipt-fee")).not.toBeInTheDocument();
      expect(screen.queryByTestId("receipt-net")).not.toBeInTheDocument();
    });

    it("renders a print button", () => {
      expect(screen.getByTestId("receipt-print-button")).toBeInTheDocument();
      expect(screen.getByTestId("receipt-print-button")).toHaveAttribute(
        "aria-label",
        "Print receipt"
      );
    });

    it("does not render a close button when onClose is not provided", () => {
      expect(screen.queryByTestId("receipt-close-button")).not.toBeInTheDocument();
    });
  });

  describe("inline with merchant name", () => {
    it("shows the merchant display name", () => {
      render(
        <ChargeReceipt event={SAMPLE_EVENT} merchantName="Acme SaaS" modal={false} />
      );
      expect(screen.getByTestId("receipt-merchant")).toHaveTextContent("Acme SaaS");
    });

    it("also shows the raw merchant address when a display name is provided", () => {
      render(
        <ChargeReceipt event={SAMPLE_EVENT} merchantName="Acme SaaS" modal={false} />
      );
      expect(screen.getByTestId("receipt-merchant-address")).toHaveTextContent(MERCHANT);
    });
  });

  describe("close button", () => {
    it("calls onClose when the close button is clicked", () => {
      const onClose = vi.fn();
      render(
        <ChargeReceipt event={SAMPLE_EVENT} onClose={onClose} modal={false} />
      );
      fireEvent.click(screen.getByTestId("receipt-close-button"));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("modal mode", () => {
    it("renders the modal overlay wrapper", () => {
      render(<ChargeReceipt event={SAMPLE_EVENT} modal={true} />);
      expect(screen.getByTestId("receipt-modal-overlay")).toBeInTheDocument();
    });

    it("calls onClose when the overlay backdrop is clicked", () => {
      const onClose = vi.fn();
      render(<ChargeReceipt event={SAMPLE_EVENT} onClose={onClose} modal={true} />);
      fireEvent.click(screen.getByTestId("receipt-modal-overlay"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onClose when clicking inside the receipt card", () => {
      const onClose = vi.fn();
      render(<ChargeReceipt event={SAMPLE_EVENT} onClose={onClose} modal={true} />);
      fireEvent.click(screen.getByTestId("charge-receipt"));
      expect(onClose).not.toHaveBeenCalled();
    });

    it("renders the receipt content inside the modal", () => {
      render(<ChargeReceipt event={SAMPLE_EVENT} modal={true} />);
      expect(screen.getByTestId("charge-receipt")).toBeInTheDocument();
      expect(screen.getByTestId("receipt-amount")).toHaveTextContent("5.0000000 XLM");
    });
  });
});
