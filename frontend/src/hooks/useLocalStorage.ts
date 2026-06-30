/**
 * useLocalStorage - Persists React state in localStorage with JSON serialization.
 *
 * A drop-in replacement for `useState` that syncs to the browser's localStorage.
 * Falls back to `initialValue` if the stored value is missing or cannot be parsed.
 *
 * @template T
 * @param {string} key - localStorage key under which the value is stored
 * @param {T} initialValue - Default value used when no stored value exists
 * @returns {[T, Function]} State tuple mirroring `useState`
 * @returns {T} returns[0] - Current persisted value
 * @returns {Function} returns[1] - Setter that updates both state and localStorage
 *
 * @example
 * const [theme, setTheme] = useLocalStorage<"dark" | "light">("flowpay_theme", "dark");
 *
 * return (
 *   <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
 *     Toggle Theme
 *   </button>
 * );
 */
import { useState } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage unavailable
    }
  };

  return [storedValue, setValue] as const;
}
