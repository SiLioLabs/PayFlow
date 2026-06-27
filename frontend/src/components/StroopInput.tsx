import React, { useState, useEffect } from "react";
import { STROOPS_PER_XLM, MIN_STROOPS, MAX_STROOPS } from "../constants";
import { useDebounce } from "../hooks/useDebounce";

interface Props {
  label: string;
  onChange: (stroops: bigint | null) => void;
  disabled?: boolean;
}

function validate(raw: string): { stroops: bigint | null; error: string | null } {
  if (!raw) return { stroops: null, error: null };
  const num = parseFloat(raw);
  if (isNaN(num) || num <= 0) return { stroops: null, error: "Must be a positive number" };
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  if (decimals > 7) return { stroops: null, error: "Max 7 decimal places" };
  const stroops = BigInt(Math.round(num * STROOPS_PER_XLM));
  if (stroops < MIN_STROOPS) {
    return { stroops: null, error: `Must be at least ${Number(MIN_STROOPS) / STROOPS_PER_XLM} XLM` };
  }
  if (stroops > MAX_STROOPS) {
    return { stroops: null, error: `Must be at most ${Number(MAX_STROOPS) / STROOPS_PER_XLM} XLM` };
  }
  return { stroops, error: null };
}

export default function StroopInput({ label, onChange, disabled }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [lastValue, setLastValue] = useState(value);
  const debouncedValue = useDebounce(value, 300);
  const [convertedStroops, setConvertedStroops] = useState<bigint | null>(null);

  useEffect(() => {
    if (value !== lastValue) {
      setIsDebouncing(true);
      setLastValue(value);
    }
  }, [value, lastValue]);

  useEffect(() => {
    const { stroops, error: err } = validate(debouncedValue);
    setConvertedStroops(stroops);
    setError(err);
    setIsDebouncing(false);
    onChange(stroops);
  }, [debouncedValue, onChange]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setValue(raw);
    // validation is debounced to avoid firing on every keystroke
  }

  function handleBlur() {
    // validate immediately on blur
    const { stroops, error: err } = validate(value);
    setConvertedStroops(stroops);
    setError(err);
    setIsDebouncing(false);
    onChange(stroops);
  }

  const stateClass = !value ? "" : error ? "input--error" : "input--valid";

  const formatXLM = (stroops: bigint): string => {
    const xlm = Number(stroops) / STROOPS_PER_XLM;
    return xlm.toFixed(7);
  };

  return (
    <label className="form-group">
      <span className="form-label">{label}</span>
      <input
        className={`input ${stateClass}`.trim()}
        type="number"
        min="0.0000001"
        step="0.0000001"
        placeholder="5"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        required
      />
      {error && <span className="text-error">{error}</span>}
      {convertedStroops !== null && !error && (
        <span className="text-muted">= {formatXLM(convertedStroops)} XLM</span>
      )}
    </label>
  );
}
