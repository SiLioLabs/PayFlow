/**
 * AmountUnitToggle — a small toggle button that switches amount display
 * between "XLM" and "STROOP" globally across the UI.
 *
 * The preference is persisted via useAmountDisplay → useLocalStorage so it
 * survives page reloads.
 *
 * Acceptance Criteria (Issue #669):
 *  - Clicking the button toggles the unit preference
 *  - Current unit is clearly shown
 *  - Accessible: role="switch", aria-checked, aria-label
 *  - Keyboard-operable (standard button behaviour)
 */
import React from "react";
import { useAmountDisplay } from "../hooks/useAmountDisplay";

interface AmountUnitToggleProps {
  /** Optional extra CSS class names */
  className?: string;
}

export default function AmountUnitToggle({ className }: AmountUnitToggleProps) {
  const { unit, toggleUnit } = useAmountDisplay();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={unit === "XLM"}
      aria-label={`Show amounts in ${unit === "XLM" ? "Stroops" : "XLM"}. Currently showing ${unit}`}
      onClick={toggleUnit}
      className={`btn-secondary amount-unit-toggle${className ? ` ${className}` : ""}`}
      data-testid="amount-unit-toggle"
      title={`Toggle amount unit (currently ${unit})`}
    >
      <span className="amount-unit-toggle__label" aria-hidden="true">
        Show in:
      </span>{" "}
      <span className="amount-unit-toggle__value" data-testid="amount-unit-value">
        {unit}
      </span>
    </button>
  );
}
