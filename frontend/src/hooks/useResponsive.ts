/**
 * useResponsive - Tracks the viewport breakpoint for responsive layout decisions.
 *
 * Uses CSS media queries via `window.matchMedia` to detect mobile, tablet, and
 * desktop breakpoints. Updates on window resize events.
 *
 * @returns {Object} Responsive state
 * @returns {boolean} returns.isMobile - True when viewport is <= 639px
 * @returns {boolean} returns.isTablet - True when viewport is 640px–1023px
 * @returns {boolean} returns.isDesktop - True when viewport is >= 1024px
 * @example
 * const { isMobile, isTablet, isDesktop } = useResponsive();
 */
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
