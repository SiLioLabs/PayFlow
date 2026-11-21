/**
 * ContractPauseBanner — full-width maintenance banner shown when the contract
 * is paused by an admin (is_contract_paused returns true), or when the
 * contract's pause state cannot be reliably determined.
 *
 * Acceptance Criteria (feat/contract-pause-banner):
 *  - Renders a prominent banner when `paused` is true
 *  - Banner text: "PayFlow is currently paused for maintenance.
 *    Subscriptions and payments are temporarily unavailable."
 *  - role="alert" so screen readers announce it immediately
 *  - Auto-hides when `paused` flips to false (next poll)
 *
 * Additional Criteria (#1055 — three-state contract status):
 *  - When `contractStatus === "unknown"` a separate, non-alarming status notice
 *    is rendered so users do not interpret an indeterminate state as confirmed active.
 *  - The "unknown" notice is visually distinct from the "paused" banner.
 */
import React from "react";
import type { ContractPausedStatus } from "../hooks/useContractPaused";

interface ContractPauseBannerProps {
  /** When true the paused banner is visible; when false it is not rendered. */
  paused: boolean;
  /**
   * Three-state status from useContractPaused.  When "unknown" a secondary
   * notice is shown to flag that contract availability is indeterminate.
   * Optional so existing callers that only pass `paused` continue to compile.
   */
  contractStatus?: ContractPausedStatus;
}

export default function ContractPauseBanner({
  paused,
  contractStatus,
}: ContractPauseBannerProps) {
  if (paused) {
    return (
      <div
        className="contract-pause-banner"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="contract-pause-banner"
      >
        <span className="contract-pause-banner__icon" aria-hidden="true">
          🔒
        </span>
        <span className="contract-pause-banner__message">
          PayFlow is currently paused for maintenance. Subscriptions and payments are temporarily
          unavailable.
        </span>
      </div>
    );
  }

  if (contractStatus === "unknown") {
    return (
      <div
        className="contract-status-unknown-banner"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="contract-status-unknown-banner"
      >
        <span className="contract-status-unknown-banner__icon" aria-hidden="true">
          ⚠️
        </span>
        <span className="contract-status-unknown-banner__message">
          Contract status unavailable — some actions may be temporarily disabled.
        </span>
      </div>
    );
  }

  return null;
}
