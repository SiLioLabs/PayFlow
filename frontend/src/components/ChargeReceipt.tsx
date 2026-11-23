/**
 * ChargeReceipt — a printable / PDF-friendly view of a single charge event.
 *
 * Renders in two modes:
 *  - Screen: a card with a print button in the top-right corner.
 *  - Print:  full-width, single-page layout with print-specific styles applied
 *            via the `.receipt-print-only` / `.receipt-screen-only` CSS helper
 *            classes defined in index.css (the global `@media print` block).
 *
 * The explorer link uses `explorerTxUrl()` from stellar.ts so it always points
 * at the configured network (Testnet or Mainnet).
 *
 * Usage:
 *   <ChargeReceipt
 *     event={chargeEvent}
 *     merchant={subscription.merchant}
 *     onClose={() => setReceiptEvent(null)}
 *   />
 *
 * The component can also be opened from SubscriptionHistory by clicking the
 * "View receipt" link on each charge row (see SubscriptionHistory.tsx).
 */
import React from "react";
import type { ChargeEvent } from "../types";
import { explorerTxUrl } from "../stellar";
import { STROOPS_PER_XLM } from "../constants";

// ── Protocol fee constants ─────────────────────────────────────────────────────
// The on-chain fee rate is not surfaced in charge events directly; we use the
// BUILD_PROTOCOL_FEE_BPS env var when available, or omit the fee line.
const FEE_BPS = import.meta.env.VITE_PROTOCOL_FEE_BPS
  ? Number(import.meta.env.VITE_PROTOCOL_FEE_BPS)
  : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatXlm(stroops: bigint): string {
  return (Number(stroops) / STROOPS_PER_XLM).toFixed(7) + " XLM";
}

function formatDate(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChargeReceiptProps {
  /** The charge event to display. */
  event: ChargeEvent;
  /**
   * Optional merchant display label (falls back to event.merchant address).
   */
  merchantName?: string;
  /** Called when the user closes the receipt (e.g. clicks "Close"). */
  onClose?: () => void;
  /** When true the receipt is opened inside a modal overlay. Defaults to true. */
  modal?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChargeReceipt({
  event,
  merchantName,
  onClose,
  modal = true,
}: ChargeReceiptProps) {
  const amountStroops = BigInt(event.amount);
  const feeStroops =
    FEE_BPS !== null ? (amountStroops * BigInt(FEE_BPS)) / 10_000n : null;
  const netStroops =
    feeStroops !== null ? amountStroops - feeStroops : null;

  const explorerLink = explorerTxUrl(event.txHash);

  function handlePrint() {
    window.print();
  }

  const receipt = (
    <div
      className="charge-receipt"
      data-testid="charge-receipt"
      role="document"
      aria-label="Charge receipt"
    >
      {/* ── Print-only header ───────────────────────────────────────────── */}
      <div className="receipt-print-only receipt__letterhead">
        <p className="receipt__app-name">PayFlow</p>
        <p className="receipt__app-tagline">Decentralized Subscription Billing on Stellar</p>
      </div>

      {/* ── Title row ───────────────────────────────────────────────────── */}
      <div className="receipt__title-row">
        <h2 className="receipt__title">Charge Receipt</h2>
        <div className="receipt-screen-only receipt__actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handlePrint}
            aria-label="Print receipt"
            data-testid="receipt-print-button"
          >
            🖨 Print / Save PDF
          </button>
          {onClose && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              aria-label="Close receipt"
              data-testid="receipt-close-button"
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {/* ── Receipt body ────────────────────────────────────────────────── */}
      <table
        className="receipt__table"
        role="presentation"
        data-testid="receipt-table"
      >
        <tbody>
          {/* Date */}
          <tr>
            <th scope="row" className="receipt__label">
              Date
            </th>
            <td className="receipt__value" data-testid="receipt-date">
              {formatDate(event.date)}
            </td>
          </tr>

          {/* Merchant */}
          <tr>
            <th scope="row" className="receipt__label">
              Merchant
            </th>
            <td className="receipt__value" data-testid="receipt-merchant">
              {merchantName ?? event.merchant}
            </td>
          </tr>
          {merchantName && (
            <tr>
              <th scope="row" className="receipt__label receipt__label--secondary">
                Merchant address
              </th>
              <td
                className="receipt__value receipt__value--mono receipt__value--break"
                data-testid="receipt-merchant-address"
              >
                {event.merchant}
              </td>
            </tr>
          )}

          {/* Charged amount */}
          <tr>
            <th scope="row" className="receipt__label">
              Amount charged
            </th>
            <td
              className="receipt__value receipt__value--amount"
              data-testid="receipt-amount"
            >
              {formatXlm(amountStroops)}
            </td>
          </tr>

          {/* Protocol fee (only shown when FEE_BPS is configured) */}
          {feeStroops !== null && (
            <>
              <tr>
                <th scope="row" className="receipt__label">
                  Protocol fee ({FEE_BPS! / 100}%)
                </th>
                <td className="receipt__value" data-testid="receipt-fee">
                  {formatXlm(feeStroops)}
                </td>
              </tr>
              <tr className="receipt__row--total">
                <th scope="row" className="receipt__label">
                  Net to merchant
                </th>
                <td
                  className="receipt__value receipt__value--amount"
                  data-testid="receipt-net"
                >
                  {formatXlm(netStroops!)}
                </td>
              </tr>
            </>
          )}

          {/* Transaction hash */}
          <tr>
            <th scope="row" className="receipt__label">
              Transaction hash
            </th>
            <td
              className="receipt__value receipt__value--mono receipt__value--break"
              data-testid="receipt-tx-hash"
            >
              {event.txHash}
            </td>
          </tr>

          {/* Explorer link */}
          <tr>
            <th scope="row" className="receipt__label">
              Explorer
            </th>
            <td className="receipt__value" data-testid="receipt-explorer-link">
              <a
                href={explorerLink}
                target="_blank"
                rel="noopener noreferrer"
                className="receipt__link"
              >
                {explorerLink}
              </a>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Print-only footer ───────────────────────────────────────────── */}
      <div className="receipt-print-only receipt__footer">
        <p>
          This is a system-generated record. The Stellar ledger is the authoritative source of
          truth for all transactions. See the explorer link above for the on-chain event.
        </p>
      </div>
    </div>
  );

  if (!modal) return receipt;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      data-testid="receipt-modal-overlay"
      role="presentation"
    >
      <div
        className="modal receipt-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Charge receipt"
      >
        {receipt}
      </div>
    </div>
  );
}
