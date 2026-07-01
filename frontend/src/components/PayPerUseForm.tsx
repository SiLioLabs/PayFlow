import React, { useState, useEffect, forwardRef, useMemo } from "react";
import Spinner from "./Spinner";
import { validateStroopAmount } from "../hooks/useFormValidation";
import { STROOPS_PER_XLM, MIN_STROOPS, MAX_STROOPS, CONTRACT_LIMITS } from "../constants";
import { useDebounce } from "../hooks/useDebounce";

interface PayPerUseFormProps {
  onPay: (amount: bigint) => Promise<void>;
  loading: boolean;
}

function validate(raw: string): { stroops: bigint | null; error: string | null } {
  if (!raw) return { stroops: null, error: null };
  const num = parseFloat(raw);
  if (isNaN(num) || num <= 0) return { stroops: null, error: "Must be a positive number" };
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  if (decimals > 7) return { stroops: null, error: "Max 7 decimal places" };
  const stroops = BigInt(Math.round(num * STROOPS_PER_XLM));
  if (stroops < MIN_STROOPS) {
    return {
      stroops: null,
      error: `Must be at least ${Number(MIN_STROOPS) / STROOPS_PER_XLM} XLM`,
    };
  }
  if (stroops > MAX_STROOPS) {
    return { stroops: null, error: `Must be at most ${Number(MAX_STROOPS) / STROOPS_PER_XLM} XLM` };
  }
  return { stroops, error: null };
}

const PayPerUseForm = forwardRef<HTMLInputElement, PayPerUseFormProps>(
  ({ onPay, loading }, ref) => {
    const [amount, setAmount] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [lastValue, setLastValue] = useState(amount);
    const debouncedValue = useDebounce(amount, 300);
    const [convertedStroops, setConvertedStroops] = useState<bigint | null>(null);

    useEffect(() => {
      if (amount !== lastValue) {
        setLastValue(amount);
      }
    }, [amount, lastValue]);

    useEffect(() => {
      const { stroops, error: err } = validate(debouncedValue);
      setConvertedStroops(stroops);
      setError(err);
    }, [debouncedValue]);

    function handleBlur() {
      const { stroops, error: err } = validate(amount);
      setConvertedStroops(stroops);
      setError(err);
    }

    const formatXLM = (stroops: bigint): string => {
      const xlm = Number(stroops) / STROOPS_PER_XLM;
      return xlm.toFixed(7);
    };

    const validationResult = useMemo(() => {
      return validateStroopAmount(amount, CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT);
    }, [amount]);

    async function handleSubmit() {
      if (!validationResult.valid) return;
      const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));
      await onPay(stroops);
      setAmount("");
      setError(null);
      setConvertedStroops(null);
    }

    return (
      <div className="card">
        <h3 className="ppu-card__title">Pay-per-use</h3>
        <div className="ppu-card__row">
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <input
              ref={ref}
              type="number"
              min="0.0000001"
              step="0.0000001"
              placeholder="Amount in XLM"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={handleBlur}
              disabled={loading}
              style={{ width: "100%" }}
            />
            {error && <span className="text-error">{error}</span>}
            {convertedStroops !== null && !error && (
              <span className="text-muted">= {formatXLM(convertedStroops)} XLM</span>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={!validationResult.valid || loading}
            className="btn-primary ppu-card__pay-btn"
          >
            {loading ? <Spinner size="sm" /> : "Pay now"}
          </button>
        </div>
        {validationResult.error && <span className="text-error">{validationResult.error}</span>}
      </div>
    );
  }
);

PayPerUseForm.displayName = "PayPerUseForm";

export default React.memo(PayPerUseForm);
