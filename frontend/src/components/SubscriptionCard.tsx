import React, { useState } from "react";
import CopyButton from "./CopyButton";
import NextChargeCountdown from "./NextChargeCountdown";
import SubscriptionActions from "./SubscriptionActions";
import SubscriptionCardModals from "./SubscriptionCardModals";
import SubscriptionCardStatus from "./SubscriptionCardStatus";
import SubscriptionHealthWidget from "./SubscriptionHealthWidget";
import {
  AllowanceHealthBadge,
  SubscriptionStatusBadge,
  TrialBadge,
} from "./SubscriptionStatusBadge";
import { BILLING_INTERVALS } from "../constants";
import { useResponsive } from "../hooks/useResponsive";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import { useSubscriptionCardState } from "../hooks/useSubscriptionCardState";
import { useToast } from "../hooks/useToast";
import type { ChargeSimResult, SubscriptionHealth } from "../stellar";
import type { Subscription } from "../types";

export { computeAllowanceHealth, TrialBadge } from "./SubscriptionStatusBadge";
export type { AllowanceHealth } from "./SubscriptionStatusBadge";

interface SubscriptionCardProps {
  subscription: Subscription;
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onRefresh: () => void;
  onCancelled?: () => void;
  showSimulateCharge?: boolean;
  onHealthChange?: (health: SubscriptionHealth | null) => void;
  onSimulateResult?: (result: ChargeSimResult | null) => void;
}

function formatInterval(secs: number): string {
  const monthly = BILLING_INTERVALS[2].value;
  const weekly = BILLING_INTERVALS[1].value;
  const daily = BILLING_INTERVALS[0].value;
  if (secs >= monthly) return `${Math.round(secs / monthly)}mo`;
  if (secs >= weekly) return `${Math.round(secs / weekly)}w`;
  if (secs >= daily) return `${Math.round(secs / daily)}d`;
  return `${secs}s`;
}

function StackedRow({
  label,
  value,
  isMobile,
}: {
  label: string;
  value: string;
  isMobile: boolean;
}) {
  return (
    <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
      <span className="subscription-row__label">{label}</span>
      <span className="subscription-row__value">{value}</span>
    </div>
  );
}

export default function SubscriptionCard({
  subscription,
  userKey,
  onSign,
  onRefresh,
  onCancelled,
  showSimulateCharge = false,
  onHealthChange,
  onSimulateResult,
}: SubscriptionCardProps) {
  const { merchant, amount, interval, last_charged, active, paused } = subscription;
  const { isMobile } = useResponsive();
  const { displayCurrentAmount } = useAmountDisplay();
  const { addToast } = useToast();
  const [showAllowanceModal, setShowAllowanceModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const cardState = useSubscriptionCardState({
    subscription,
    userKey,
    onSign,
    onRefresh,
    onCancelled,
    onHealthChange,
  });

  const pauseFailed = cardState.hasPauseError;
  const status = pauseFailed
    ? cardState.pauseStatus
    : cardState.cancelStatus || cardState.pauseStatus;

  return (
    <div className={`card${isMobile ? " card--mobile" : ""}`}>
      <div className="subscription-card__header">
        <div>
          <h2 className="subscription-card__title">Your Subscription</h2>
          {subscription.label && <p className="subscription-card__label">{subscription.label}</p>}
        </div>
        <SubscriptionStatusBadge
          active={active}
          paused={paused}
          isInTrial={cardState.isInTrial}
        />
      </div>

      {active && cardState.trialEndTimestamp !== null && (
        <div className="trial-badge-row" data-testid="trial-badge-row">
          <TrialBadge trialEndTimestamp={cardState.trialEndTimestamp} />
        </div>
      )}

      {active && (
        <div className="allowance-health-row">
          <span className="text-sm text-muted">Allowance:</span>
          <AllowanceHealthBadge
            health={cardState.allowanceHealth}
            loading={cardState.allowanceLoading}
            onClick={() => setShowAllowanceModal(true)}
          />
        </div>
      )}

      <div className={`subscription-rows${isMobile ? " subscription-rows--mobile" : ""}`}>
        <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
          <span className="subscription-row__label">Merchant</span>
          <div className="merchant-row">
            <span className="merchant-row__address">
              {`${merchant.slice(0, 8)}…${merchant.slice(-6)}`}
            </span>
            <CopyButton text={merchant} ariaLabel="Copy merchant address" />
          </div>
        </div>
        <StackedRow
          label="Amount"
          value={displayCurrentAmount(amount)}
          isMobile={isMobile}
        />
        <StackedRow label="Interval" value={formatInterval(interval)} isMobile={isMobile} />
        <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
          <span className="subscription-row__label">
            {paused || cardState.scheduledResumeAt
              ? "Status"
              : cardState.isInTrial
                ? "First charge"
                : "Next charge"}
          </span>
          <span className="subscription-row__value">
            {active ? (
              paused || cardState.scheduledResumeAt ? (
                cardState.scheduledResumeAt ? (
                  <span data-testid="scheduled-resume">
                    Auto-resumes{" "}
                    <span data-testid="auto-resume-date">
                      {new Date(cardState.scheduledResumeAt * 1000).toLocaleString()}
                    </span>
                  </span>
                ) : (
                  <span className="badge badge-warning" aria-label="Subscription is paused">
                    Paused
                  </span>
                )
              ) : (
                <NextChargeCountdown nextChargeTimestamp={last_charged + interval} />
              )
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      {active && cardState.healthUnhealthy && (
        <p
          className="text-sm"
          data-testid="health-action-warning"
          role="status"
          style={{ color: "var(--color-danger-text)", marginBottom: "var(--space-3)" }}
        >
          {cardState.healthBlocksActions
            ? "Subscription is unhealthy. Pause and cancel remain available; pay and charge may fail."
            : "Subscription needs attention before the next charge."}
        </p>
      )}

      <SubscriptionActions
        active={active}
        paused={paused}
        healthUnhealthy={cardState.healthUnhealthy}
        pausePending={cardState.pauseTx.state === "pending"}
        pauseUntilPending={cardState.pauseUntilTx.state === "pending"}
        resumePending={cardState.resumeTx.state === "pending"}
        cancelLoading={cardState.cancelLoading}
        onPause={cardState.handlePause}
        onResume={cardState.handleResume}
        onCancel={cardState.handleCancel}
        onTransfer={() => setShowTransferModal(true)}
      />

      <SubscriptionCardModals
        userKey={userKey}
        amount={BigInt(amount)}
        onSign={onSign}
        showAllowanceModal={showAllowanceModal}
        showTransferModal={showTransferModal}
        onCloseAllowance={() => setShowAllowanceModal(false)}
        onAllowanceSuccess={() => {
          setShowAllowanceModal(false);
          cardState.refreshAllowance();
        }}
        onCloseTransfer={() => setShowTransferModal(false)}
        onTransferSuccess={() => {
          setShowTransferModal(false);
          addToast("Subscription transferred successfully.", "success");
          onRefresh();
        }}
      />

      {active && (
        <SubscriptionHealthWidget
          userKey={userKey}
          showSimulateCharge={showSimulateCharge}
          onHealthChange={cardState.handleHealthChange}
          onSimulateResult={onSimulateResult}
        />
      )}

      <SubscriptionCardStatus
        status={status}
        isError={pauseFailed || cardState.cancelError !== null}
        error={pauseFailed ? cardState.pauseError : cardState.cancelError}
        health={cardState.subHealth}
        onIncreaseAllowance={() => setShowAllowanceModal(true)}
      />
    </div>
  );
}
