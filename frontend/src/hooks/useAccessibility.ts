import { useCallback, useRef } from "react";

export function useAccessibility() {
  const liveRegionRef = useRef<HTMLDivElement | null>(null);

  const announce = useCallback((message: string) => {
    if (!liveRegionRef.current) {
      const region = document.createElement("div");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      region.style.position = "absolute";
      region.style.left = "-10000px";
      region.style.width = "1px";
      region.style.height = "1px";
      region.style.overflow = "hidden";
      document.body.appendChild(region);
      liveRegionRef.current = region;
    }
    liveRegionRef.current.textContent = message;
  }, []);

  return { announce };
}
