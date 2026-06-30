import { useState, useCallback } from "react";

/**
 * useAccessibility - Provides an ARIA live region announcer.
 *
 * Useful for screen reader feedback (e.g., form validation, action success).
 * Calling `announce(message)` updates `announcement` which can be rendered in
 * an element like `<div aria-live="polite">{announcement}</div>`.
 *
 * @returns {Object} Accessibility announcement API
 * @returns {string} returns.announcement - Latest message to announce
 * @returns {(message: string) => void} returns.announce - Triggers an announcement
 *
 * @sideEffects
 * - Updates React state and schedules a `requestAnimationFrame`.
 *
 * @example
 * const { announcement, announce } = useAccessibility();
 *
 * return (
 *   <>
 *     <div aria-live="polite">{announcement}</div>
 *     <button onClick={() => announce("Saved!")}>Save</button>
 *   </>
 * );
 */
export function useAccessibility() {
  const [announcement, setAnnouncement] = useState("");

  const announce = useCallback((message: string) => {
    // Clear first so the same message re-triggers screen readers
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  return { announcement, announce };
}

