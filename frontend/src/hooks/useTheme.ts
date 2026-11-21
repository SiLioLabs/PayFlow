/**
 * useTheme - Manages dark/light theme state synchronized with localStorage and DOM.
 *
 * Reads and writes the theme preference from localStorage ("flowpay_theme") and
 * applies it as a `data-theme` attribute on the document root element.
 *
 * @returns {Object} Theme state and toggle control
 * @returns {"dark"|"light"} returns.theme - Current active theme
 * @returns {Function} returns.toggle - Switches between "dark" and "light"
 *
 * @example
 * const { theme, toggle } = useTheme();
 *
 * return (
 *   <button onClick={toggle}>
 *     Switch to {theme === "dark" ? "Light" : "Dark"} Mode
 *   </button>
 * );
 */
import { useEffect } from "react";
import { useLocalStorage } from "./useLocalStorage";

type Theme = "dark" | "light";

export function useTheme() {
  const [theme, setTheme] = useLocalStorage<Theme>("flowpay_theme", "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return { theme, toggle };
}
