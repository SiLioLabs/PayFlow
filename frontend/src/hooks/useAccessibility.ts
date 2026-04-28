import { useState, useCallback } from "react";

export function useAccessibility() {
  const [announcement, setAnnouncement] = useState("");

  const announce = useCallback((message: string) => {
    // Clear first so the same message re-triggers screen readers
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  return { announcement, announce };
}
