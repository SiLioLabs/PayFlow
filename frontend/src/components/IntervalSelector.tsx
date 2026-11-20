import React, { useState } from "react";
import { BILLING_INTERVALS, SECONDS_PER_DAY } from "../constants";

const CUSTOM_VALUE = -1;

interface Props {
  value: number;
  onChange: (seconds: number) => void;
  id?: string;
  onBlur?: () => void;
}

export default function IntervalSelector({
  value,
  onChange,
  id = "billing-interval-select",
  onBlur,
}: Props) {
  const isPreset = BILLING_INTERVALS.some((i) => i.value === value);
  const [isCustom, setIsCustom] = useState(!isPreset);
  const [customDays, setCustomDays] = useState(
    isPreset ? "" : String(Math.round(value / SECONDS_PER_DAY))
  );

  const customDaysId = `${id}-custom-days`;

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
    const seconds = Math.round(parseFloat(days) * SECONDS_PER_DAY);
    if (!isNaN(seconds) && seconds > 0) onChange(seconds);
  }

  return (
    <div className="form-group">
      <label htmlFor={id} className="form-label">
        Billing interval
      </label>
      <select
        id={id}
        data-testid="interval-select"
        className="select"
        value={isCustom ? CUSTOM_VALUE : value}
        onChange={handleSelectChange}
        onBlur={onBlur}
      >
        {BILLING_INTERVALS.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
        <option value={CUSTOM_VALUE}>Custom</option>
      </select>
      {isCustom && (
        <div className="mt-2">
          <label htmlFor={customDaysId} className="form-label text-sm">
            Custom interval in days
          </label>
          <input
            id={customDaysId}
            data-testid="custom-days-input"
            className="input"
            type="number"
            min="1"
            step="1"
            placeholder="Number of days"
            value={customDays}
            onChange={handleCustomChange}
            onBlur={onBlur}
            aria-label="Custom interval in days"
          />
        </div>
      )}
    </div>
  );
}
