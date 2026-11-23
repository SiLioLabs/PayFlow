/**
 * useLocalStorage - Persists React state in localStorage with JSON serialization.
 *
 * A drop-in replacement for `useState` that syncs to the browser's localStorage.
 * Falls back to `initialValue` if the stored value is missing or cannot be parsed.
 *
 * The setter returns `true` on success and `false` on failure. On failure the
 * in-memory state is NOT updated, so the UI never shows unpersisted data as
 * saved. Quota errors (`QuotaExceededError`) and other storage failures are
 * surfaced through the boolean return.
 *
 * @template T
 * @param {string} key - localStorage key under which the value is stored
 * @param {T} initialValue - Default value used when no stored value exists
 * @returns {[T, (value: T) => boolean]} State tuple mirroring `useState`
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

  const setValue = (value: T): boolean => {
    // Serialize first — if this throws we haven't touched storage or state.
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return false;
    }

    // Write to storage BEFORE updating React state. If storage rejects the
    // write (quota exceeded, private mode, etc.) we bail out without lying
    // to the UI about what was persisted.
    try {
      window.localStorage.setItem(key, serialized);
    } catch {
      return false;
    }

    setStoredValue(value);
    return true;
  };

  return [storedValue, setValue] as const;
}