/**
 * useAmountDisplay — global hook for consistent, user-controlled amount formatting.
 *
 * Acceptance Criteria (Issue #669):
 *  - Provides displayAmount(stroops, unit) → string conversion
 *  - Exposes the current unit preference ("XLM" | "STROOP")
 *  - Provides a setUnit setter to change the unit globally
 *  - Persists the unit preference to localStorage via useLocalStorage
 *  - Convenience helper displayCurrentAmount(stroops) uses the stored preference
 *
 * Usage:
 * ```tsx
 * const { displayCurrentAmount, unit, setUnit } = useAmountDisplay();
 * <span>{displayCurrentAmount(subscription.amount)}</span>
 * ```
 *
 * To render with an explicit unit (e.g. for a conversion preview):
 * ```tsx
 * const { displayAmount } = useAmountDisplay();
 * <span>{displayAmount(amount, "STROOP")}</span>
 * ```
 */
import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { displayAmount as formatAmount, type AmountUnit } from "../utils/format";

/** localStorage key used to persist the user's preferred amount unit. */
const UNIT_STORAGE_KEY = "flowpay_amount_unit";

interface UseAmountDisplayResult {
  /** The currently selected display unit. */
  unit: AmountUnit;
  /** Setter to change the display unit (persisted to localStorage). */
  setUnit: (unit: AmountUnit) => void;
  /**
   * Format a stroop amount using the provided unit — useful when you need a
   * specific unit regardless of the global preference.
   */
  displayAmount: (stroops: string | number | bigint, unit: AmountUnit) => string;
  /**
   * Format a stroop amount using the globally preferred unit.
   * This is the primary function to use in all UI components.
   */
  displayCurrentAmount: (stroops: string | number | bigint) => string;
  /** Toggle between "XLM" and "STROOP". Convenience alias for setUnit. */
  toggleUnit: () => void;
}

/**
 * Central hook for amount display preferences.
 *
 * The unit preference is stored in localStorage under "flowpay_amount_unit"
 * so it persists across page reloads. All components that show amounts should
 * use this hook for a consistent user experience.
 */
export function useAmountDisplay(): UseAmountDisplayResult {
  const [unit, setUnitStored] = useLocalStorage<AmountUnit>(UNIT_STORAGE_KEY, "XLM");

  const setUnit = useCallback(
    (newUnit: AmountUnit) => {
      setUnitStored(newUnit);
    },
    [setUnitStored]
  );

  const toggleUnit = useCallback(() => {
    setUnit(unit === "XLM" ? "STROOP" : "XLM");
  }, [unit, setUnit]);

  const displayCurrentAmount = useCallback(
    (stroops: string | number | bigint): string => {
      return formatAmount(stroops, unit);
    },
    [unit]
  );

  return {
    unit,
    setUnit,
    displayAmount: formatAmount,
    displayCurrentAmount,
    toggleUnit,
  };
}
