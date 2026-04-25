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
