import React, { useState } from "react";
import { STROOPS_PER_XLM } from "../constants";

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
  return { stroops: BigInt(Math.round(num * STROOPS_PER_XLM)), error: null };
}

export default function StroopInput({ label, onChange, disabled }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setValue(raw);
    const { stroops, error: err } = validate(raw);
    setError(err);
    onChange(stroops);
  }

  const stateClass = !value ? "" : error ? "input--error" : "input--valid";

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
        disabled={disabled}
        required
      />
      {error && <span className="text-error">{error}</span>}
    </label>
  );
}
