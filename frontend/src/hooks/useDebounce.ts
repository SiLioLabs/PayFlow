import { useState, useEffect } from "react";

/**
 * useDebounce - Debounces a changing value.
 *
 * Updates `debounced` only after `delay` milliseconds have elapsed without
 * additional changes to `value`.
 *
 * @template T
 * @param {T} value - The input value to debounce
 * @param {number} [delay=300] - Debounce delay in milliseconds
 * @returns {T} returns - Debounced value
 *
 * @sideEffects
 * - Schedules and clears a timeout via `setTimeout`/`clearTimeout`.
 *
 * @example
 * const debouncedQuery = useDebounce(query, 300);
 * useEffect(() => {
 *   if (debouncedQuery) search(debouncedQuery);
 * }, [debouncedQuery]);
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
