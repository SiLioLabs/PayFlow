import { useState, useEffect } from "react";

export function useResponsive() {
  const getBreakpoints = () => ({
    isMobile: window.matchMedia("(max-width: 639px)").matches,
    isTablet: window.matchMedia("(min-width: 640px) and (max-width: 1023px)").matches,
    isDesktop: window.matchMedia("(min-width: 1024px)").matches,
  });

  const [breakpoints, setBreakpoints] = useState(getBreakpoints);

  useEffect(() => {
    const handler = () => setBreakpoints(getBreakpoints());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return breakpoints;
}
