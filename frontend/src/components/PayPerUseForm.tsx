import React, { useState, useEffect, forwardRef } from "react";
import Spinner from "./Spinner";
import { STROOPS_PER_XLM, MIN_STROOPS, CONTRACT_LIMITS } from "../constants";
import { useDebounce } from "../hooks/useDebounce";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import { type AmountUnit } from "../utils/format";
import { dailyLimitProgress } from "../utils/format";

interface PayPerUseFormProps {
  onPay: (amount: bigint) => Promise<void>;
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

function validate(
  raw: string,
  unit: AmountUnit,
  maxStroops: bigint
): { stroops: bigint | null; error: string | null } {
  if (!raw) return { stroops: null, error: null };
  const num = parseFloat(raw);
  if (isNaN(num) || num <= 0) return { stroops: null, error: "Must be a positive number" };

  let stroops: bigint;
  if (unit === "XLM") {
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    if (decimals > 7) return { stroops: null, error: "Max 7 decimal places" };
    stroops = BigInt(Math.round(num * STROOPS_PER_XLM));
  } else {
    if (raw.includes(".")) return { stroops: null, error: "Stroops must be whole numbers" };
    try {
      stroops = BigInt(raw);
    } catch {
      return { stroops: null, error: "Invalid integer" };
    }
  }

  if (stroops < MIN_STROOPS) {
    return {
      stroops: null,
      error:
        unit === "XLM"
          ? `Must be at least ${Number(MIN_STROOPS) / STROOPS_PER_XLM} XLM`
          : `Must be at least ${MIN_STROOPS} STROOP`,
    };
  }
  if (stroops > maxStroops) {
    return {
      stroops: null,
      error:
        unit === "XLM"
          ? `Must be at most ${Number(maxStroops) / STROOPS_PER_XLM} XLM`
          : `Must be at most ${maxStroops} STROOP`,
    };
  }
  return { stroops, error: null };
}

const PayPerUseForm = forwardRef<HTMLInputElement, PayPerUseFormProps>(
  ({ onPay, loading, isPaused = false, disabled = false, disabledReason, warningReason }, ref) => {
    const { unit } = useAmountDisplay();
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
    const [amount, setAmount] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [lastValue, setLastValue] = useState(amount);
    const debouncedValue = useDebounce(amount, 300);
    const [convertedStroops, setConvertedStroops] = useState<bigint | null>(null);
    const { displayCurrentAmount } = useAmountDisplay();

    // Keep input value in sync when the global unit preference changes
    useEffect(() => {
      if (convertedStroops !== null) {
        if (unit === "XLM") {
          setAmount((Number(convertedStroops) / STROOPS_PER_XLM).toString());
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
      const { stroops, error: err } = validate(
        debouncedValue,
        unit,
        CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT
      );
      setConvertedStroops(stroops);
      setError(err);
    }, [debouncedValue, unit]);

    function handleBlur() {
      const { stroops, error: err } = validate(
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
        const xlm = Number(stroops) / STROOPS_PER_XLM;
        return `${xlm.toFixed(7)} XLM`;
      }
    };

    const isFormValid = convertedStroops !== null && !error;
    const payDisabled = loading || isPaused || disabled;

    async function handleSubmit() {
      if (!isFormValid || payDisabled) return;
      await onPay(convertedStroops);
    const validationResult = useMemo(() => {
      return validateStroopAmount(amount, CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT);
    }, [amount]);

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

    async function handleSubmit() {
      if (!validationResult.valid || payDisabled || exceedsRemaining) return;
      const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));
      // Extra guard: re-check before wallet prompt
      if (remaining !== null && stroops > remaining) {
        setError(
          `Amount exceeds remaining daily budget. Remaining: ${displayCurrentAmount(remaining)}`
        );
        return;
      }
      await onPay(stroops);
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
