import { useState, useEffect } from "react";

interface Breakpoints {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

export function useResponsive(): Breakpoints {
  const [breakpoints, setBreakpoints] = useState<Breakpoints>({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
  });

  useEffect(() => {
    const updateBreakpoints = () => {
      const width = window.innerWidth;
      setBreakpoints({
        isMobile: width < 768,
        isTablet: width >= 768 && width < 1024,
        isDesktop: width >= 1024,
      });
    };

    updateBreakpoints();
    window.addEventListener("resize", updateBreakpoints);
    return () => window.removeEventListener("resize", updateBreakpoints);
  }, []);

  return breakpoints;
}
