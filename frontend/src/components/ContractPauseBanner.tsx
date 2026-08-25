/**
 * ContractPauseBanner — full-width maintenance banner shown when the contract
 * is paused by an admin (is_contract_paused returns true).
 *
 * Acceptance Criteria (feat/contract-pause-banner):
 *  - Renders a prominent banner when `paused` is true
 *  - Banner text: "PayFlow is currently paused for maintenance.
 *    Subscriptions and payments are temporarily unavailable."
 *  - role="alert" so screen readers announce it immediately
 *  - Auto-hides when `paused` flips to false (next poll)
 */
import React from "react";

interface ContractPauseBannerProps {
  /** When true the banner is visible; when false it is not rendered. */
  paused: boolean;
}

export default function ContractPauseBanner({ paused }: ContractPauseBannerProps) {
  if (!paused) return null;

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
