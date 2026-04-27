import React, { useState } from "react";
import { BILLING_INTERVALS } from "../constants";

const CUSTOM_VALUE = -1;

interface Props {
  value: number;
  onChange: (seconds: number) => void;
}

export default function IntervalSelector({ value, onChange }: Props) {
  const isPreset = BILLING_INTERVALS.some((i) => i.value === value);
  const [isCustom, setIsCustom] = useState(!isPreset);
  const [customDays, setCustomDays] = useState(
    isPreset ? "" : String(Math.round(value / 86400))
  );

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = Number(e.target.value);
    if (val === CUSTOM_VALUE) {
      setIsCustom(true);
    } else {
      setIsCustom(false);
      onChange(val);
    }
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    const days = e.target.value;
    setCustomDays(days);
    const seconds = Math.round(parseFloat(days) * 86400);
    if (!isNaN(seconds) && seconds > 0) onChange(seconds);
  }

  return (
    <div className="form-group">
      <span className="form-label">Billing interval</span>
      <select
        className="select"
        value={isCustom ? CUSTOM_VALUE : value}
        onChange={handleSelectChange}
      >
        {BILLING_INTERVALS.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
        <option value={CUSTOM_VALUE}>Custom</option>
      </select>
      {isCustom && (
        <input
          className="input mt-2"
          type="number"
          min="1"
          step="1"
          placeholder="Number of days"
          value={customDays}
          onChange={handleCustomChange}
        />
      )}
    </div>
  );
}
