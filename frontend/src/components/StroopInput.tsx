import React, { useState, useEffect } from "react";
import { STROOPS_PER_XLM, MIN_STROOPS, MAX_STROOPS } from "../constants";
import { useDebounce } from "../hooks/useDebounce";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import { type AmountUnit } from "../utils/format";

interface Props {
  label: string;
  onChange: (stroops: bigint | null) => void;
  disabled?: boolean;
  initialValue?: bigint;
  id?: string;
  testId?: string;
}

function validate(
  raw: string,
  unit: AmountUnit,
  maxStroops: bigint = MAX_STROOPS
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
    if (raw.includes(".")) {
      return { stroops: null, error: "Stroops must be whole numbers" };
    }
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
        setValue((Number(initialValue) / STROOPS_PER_XLM).toString());
      } else {
        setValue(initialValue.toString());
      }
    }
  }, [initialValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep input value in sync when the global unit preference changes
  useEffect(() => {
    if (convertedStroops !== null) {
      if (unit === "XLM") {
        setValue((Number(convertedStroops) / STROOPS_PER_XLM).toString());
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
    const { stroops, error: err } = validate(debouncedValue, unit);
    setConvertedStroops(stroops);
    setError(err);
    onChange(stroops);
  }, [debouncedValue, unit, onChange]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setValue(raw);
  }

  function handleBlur() {
    const { stroops, error: err } = validate(value, unit);
    setConvertedStroops(stroops);
    setError(err);
    onChange(stroops);
  }

  const stateClass = !value ? "" : error ? "input--error" : "input--valid";

  const formatAlternate = (stroops: bigint): string => {
    if (unit === "XLM") {
      return `${stroops.toLocaleString("en-US")} STROOP`;
    } else {
      const xlm = Number(stroops) / STROOPS_PER_XLM;
      return `${xlm.toFixed(7)} XLM`;
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
