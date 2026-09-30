import React, { useState, useEffect } from "react";
import { MAX_STROOPS } from "../constants";
import { stroopsToXlm } from "../utils/format";
import { useDebounce } from "../hooks/useDebounce";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import { validateStroopAmount } from "../utils/validation";
import type { AmountUnit } from "../utils/format";

interface Props {
  label: string;
  onChange: (stroops: bigint | null) => void;
  disabled?: boolean;
  initialValue?: bigint;
  id?: string;
  testId?: string;
}

/**
 * validateStroopInput — thin wrapper around the canonical validateStroopAmount
 * that supplies a default maxStroops.  Kept for backward-compatibility with
 * existing callers (e.g. amounts.test.ts) that rely on this export name and
 * signature.
 */
export function validateStroopInput(
  raw: string,
  unit: AmountUnit,
  maxStroops: bigint = MAX_STROOPS
): { stroops: bigint | null; error: string | null } {
  return validateStroopAmount(raw, unit, maxStroops);
}

// Keep the aliased export so callers that import validateStroopAmount from
// this module continue to work without changes.
export { validateStroopInput as validateStroopAmount };

export default function StroopInput({
  label,
  onChange,
  disabled,
  initialValue,
  id = "amount-input",
  testId = "amount-input",
}: Props) {
  const { unit } = useAmountDisplay();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  const debouncedValue = useDebounce(value, 300);
  const [convertedStroops, setConvertedStroops] = useState<bigint | null>(null);

  // Initialize value from initialValue if provided
  useEffect(() => {
    if (initialValue !== undefined && initialValue !== null) {
      setConvertedStroops(initialValue);
      if (unit === "XLM") {
        setValue(stroopsToXlm(initialValue));
      } else {
        setValue(initialValue.toString());
      }
    }
  }, [initialValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep input value in sync when the global unit preference changes
  useEffect(() => {
    if (convertedStroops !== null) {
      if (unit === "XLM") {
        setValue(stroopsToXlm(convertedStroops));
      } else {
        setValue(convertedStroops.toString());
      }
    }
  }, [unit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (value !== lastValue) {
      setLastValue(value);
    }
  }, [value, lastValue]);

  useEffect(() => {
    const { stroops, error: err } = validateStroopAmount(debouncedValue, unit, MAX_STROOPS);
    setConvertedStroops(stroops);
    setError(err);
    onChange(stroops);
  }, [debouncedValue, unit, onChange]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setValue(raw);
  }

  function handleBlur() {
    const { stroops, error: err } = validateStroopAmount(value, unit, MAX_STROOPS);
    setConvertedStroops(stroops);
    setError(err);
    onChange(stroops);
  }

  const stateClass = !value ? "" : error ? "input--error" : "input--valid";

  const formatAlternate = (stroops: bigint): string => {
    if (unit === "XLM") {
      return `${stroops.toLocaleString("en-US")} STROOP`;
    } else {
      return `${stroopsToXlm(stroops)} XLM`;
    }
  };

  return (
    <label className="form-group">
      <span className="form-label">
        {label} ({unit})
      </span>
      <input
        id={id}
        data-testid={testId}
        className={`input ${stateClass}`.trim()}
        type="number"
        min={unit === "XLM" ? "0.0000001" : "1"}
        step={unit === "XLM" ? "0.0000001" : "1"}
        placeholder={unit === "XLM" ? "5" : "50000000"}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "amount-error" : undefined}
      />
      {error && <span className="text-error">{error}</span>}
      {convertedStroops !== null && !error && (
        <span className="text-muted">= {formatAlternate(convertedStroops)}</span>
      )}
    </label>
  );
}
