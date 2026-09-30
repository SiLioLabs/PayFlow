import React, { useState, useEffect, useMemo, forwardRef } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import Spinner from "./Spinner";
import { STROOPS_PER_XLM, CONTRACT_LIMITS } from "../constants";
import { useDebounce } from "../hooks/useDebounce";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import { type AmountUnit, stroopsToXlm } from "../utils/format";
import { dailyLimitProgress } from "../utils/format";
import { validateStroopAmount } from "../utils/validation";

interface PayPerUseFormProps {
  onPay: (amount: bigint, recipient?: string) => Promise<void>;
  loading: boolean;
  isPaused?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  warningReason?: string;
  /** Daily limit state for proactive validation before wallet prompt */
  dailyLimit?: bigint | null;
  dailySpent?: bigint | null;
  dayActive?: boolean;
  isLimitLoading?: boolean;
}

/**
 * validatePayPerUseInput — thin wrapper around the canonical validateStroopAmount
 * preserved for backward-compatibility with amounts.test.ts and other callers
 * that rely on this export name and signature.
 */
export function validatePayPerUseInput(
  raw: string,
  unit: AmountUnit,
  maxStroops: bigint
): { stroops: bigint | null; error: string | null } {
  return validateStroopAmount(raw, unit, maxStroops);
}

/**
 * Validates an optional `pay_per_use_to` recipient address. An empty value is
 * valid (the field is optional); a non-empty value must be a Stellar account
 * (Ed25519) or contract address — the same shapes the contract accepts via
 * `Address`. Federated names are intentionally rejected since they cannot be
 * encoded into an `Address` ScVal without a resolver round-trip.
 */
function validateRecipient(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (StrKey.isValidEd25519PublicKey(trimmed) || StrKey.isValidContract(trimmed)) {
    return null;
  }
  return "Invalid recipient address.";
}

const PayPerUseForm = forwardRef<HTMLInputElement, PayPerUseFormProps>(
  (
    {
      onPay,
      loading,
      isPaused = false,
      disabled = false,
      disabledReason,
      warningReason,
      dailyLimit = null,
      dailySpent = null,
      dayActive = false,
      isLimitLoading = false,
    },
    ref
  ) => {
    const { unit } = useAmountDisplay();
    const [amount, setAmount] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [recipient, setRecipient] = useState("");
    const [recipientError, setRecipientError] = useState<string | null>(null);
    const [lastValue, setLastValue] = useState(amount);
    const debouncedValue = useDebounce(amount, 300);
    const [convertedStroops, setConvertedStroops] = useState<bigint | null>(null);
    const { displayCurrentAmount } = useAmountDisplay();

    // Keep input value in sync when the global unit preference changes
    useEffect(() => {
      if (convertedStroops !== null) {
        if (unit === "XLM") {
          setAmount(stroopsToXlm(convertedStroops));
        } else {
          setAmount(convertedStroops.toString());
        }
      }
    }, [unit]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (amount !== lastValue) {
        setLastValue(amount);
      }
    }, [amount, lastValue]);

    useEffect(() => {
      const { stroops, error: err } = validatePayPerUseInput(
        debouncedValue,
        unit,
        CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT
      );
      setConvertedStroops(stroops);
      setError(err);
    }, [debouncedValue, unit]);

    function handleBlur() {
      const { stroops, error: err } = validatePayPerUseInput(
        amount,
        unit,
        CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT
      );
      setConvertedStroops(stroops);
      setError(err);
    }

    const formatAlternate = (stroops: bigint): string => {
      if (unit === "XLM") {
        return `${stroops.toLocaleString("en-US")} STROOP`;
      } else {
        return `${stroopsToXlm(stroops)} XLM`;
      }
    };

    const isFormValid = convertedStroops !== null && !error && !recipientError;

    const validationResult = useMemo(() => {
      return validatePayPerUseInput(amount, unit, CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT);
    }, [amount, unit]);

    // Daily limit remaining logic — block submit when amount would exceed remaining budget
    const remaining = dailyLimit !== null && dailySpent !== null ? dailyLimit - dailySpent : null;
    const amountStroopsForLimit = useMemo(() => {
      if (!amount) return null;
      const parsed = parseFloat(amount);
      if (Number.isNaN(parsed) || parsed <= 0) return null;
      try {
        return BigInt(Math.round(parsed * STROOPS_PER_XLM));
      } catch {
        return null;
      }
    }, [amount]);
    const exceedsRemaining =
      remaining !== null && amountStroopsForLimit !== null && amountStroopsForLimit > remaining;
    const limitBlocked = remaining !== null && remaining <= 0n;
    const limitError = exceedsRemaining
      ? `Exceeds remaining daily budget (${displayCurrentAmount(remaining!)} remaining).`
      : limitBlocked
        ? "Daily limit reached — wait ~24h after first spend or raise limit."
        : null;

    const payDisabled = loading || isPaused || disabled || exceedsRemaining || limitBlocked;

    function handleRecipientChange(e: React.ChangeEvent<HTMLInputElement>) {
      const value = e.target.value;
      setRecipient(value);
      setRecipientError(validateRecipient(value));
    }

    async function handleSubmit() {
      if (validationResult.stroops === null || payDisabled || exceedsRemaining) return;
      const trimmedRecipient = recipient.trim();
      if (trimmedRecipient) {
        const recipientErr = validateRecipient(trimmedRecipient);
        if (recipientErr) {
          setRecipientError(recipientErr);
          return;
        }
      }
      const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));
      // Extra guard: re-check before wallet prompt
      if (remaining !== null && stroops > remaining) {
        setError(
          `Amount exceeds remaining daily budget. Remaining: ${displayCurrentAmount(remaining)}`
        );
        return;
      }
      if (trimmedRecipient) {
        await onPay(stroops, trimmedRecipient);
      } else {
        await onPay(stroops);
      }
      setAmount("");
      setError(null);
      setConvertedStroops(null);
    }

    const payAriaLabel = disabled
      ? "Pay now (unavailable — subscription is unhealthy)"
      : isPaused
        ? "Pay now (unavailable during maintenance)"
        : undefined;

    const progress =
      dailyLimit !== null && dailySpent !== null ? dailyLimitProgress(dailySpent, dailyLimit) : 0;

    return (
      <div className="card">
        <h3 className="ppu-card__title">Pay-per-use</h3>
        {(dailyLimit !== null || isLimitLoading) && (
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              background: "var(--color-surface-overlay)",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
            }}
          >
            {isLimitLoading ? (
              <span className="text-xs text-muted">Loading daily spending limit…</span>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span className="text-xs text-muted">
                    Limit: {displayCurrentAmount(dailyLimit!)}
                  </span>
                  <span className="text-xs text-muted">
                    Spent: {displayCurrentAmount(dailySpent!)}
                  </span>
                  <span
                    className="text-xs"
                    style={{
                      fontWeight: 600,
                      color:
                        remaining !== null && remaining <= 0n
                          ? "var(--color-danger)"
                          : "var(--color-success)",
                    }}
                  >
                    Remaining: {remaining !== null ? displayCurrentAmount(remaining) : "—"}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    height: 6,
                    background: "var(--color-border)",
                    borderRadius: 999,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${progress}%`,
                      height: "100%",
                      background: progress >= 100 ? "var(--color-danger)" : "var(--color-primary)",
                      transition: "width 0.2s",
                    }}
                  />
                </div>
                <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                  {dayActive
                    ? "Resets about 24 hours after your first spend today."
                    : "Window starts on first pay-per-use."}{" "}
                  {progress}% used.
                </p>
              </>
            )}
          </div>
        )}
        <div className="ppu-card__row">
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <input
              ref={ref}
              type="number"
              min={unit === "XLM" ? "0.0000001" : "1"}
              step={unit === "XLM" ? "0.0000001" : "1"}
              placeholder={`Amount in ${unit}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={handleBlur}
              disabled={payDisabled}
              style={{ width: "100%" }}
            />
            {error && <span className="text-error">{error}</span>}
            {convertedStroops !== null && !error && (
              <span className="text-muted">= {formatAlternate(convertedStroops)}</span>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={!isFormValid || payDisabled}
            className="btn-primary ppu-card__pay-btn"
            aria-label={payAriaLabel}
          >
            {loading ? <Spinner size="sm" /> : "Pay now"}
          </button>
        </div>
        <div className="ppu-card__recipient" style={{ marginTop: 8 }}>
          <input
            type="text"
            placeholder="Recipient address (optional)"
            aria-label="Recipient address (optional)"
            value={recipient}
            onChange={handleRecipientChange}
            onBlur={() => setRecipientError(validateRecipient(recipient))}
            disabled={payDisabled}
            style={{ width: "100%" }}
          />
          {recipientError && (
            <span className="text-error" data-testid="ppu-recipient-error" role="alert">
              {recipientError}
            </span>
          )}
        </div>
        {disabled && disabledReason && (
          <p className="text-error" data-testid="ppu-blocked-reason" role="status">
            {disabledReason}
          </p>
        )}
        {!disabled && warningReason && (
          <p className="text-sm text-muted" data-testid="ppu-warning-reason" role="status">
            {warningReason}
          </p>
        )}
        {limitError && (
          <p className="text-error" data-testid="ppu-limit-error" role="alert">
            {limitError}
          </p>
        )}
        {validationResult.error && <span className="text-error">{validationResult.error}</span>}
      </div>
    );
  }
);

PayPerUseForm.displayName = "PayPerUseForm";

export default React.memo(PayPerUseForm);
