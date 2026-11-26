import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (element) => !element.matches(":disabled")
  );
}

/**
 * Hook to trap keyboard focus within a container element.
 *
 * @param ref - Ref object containing the container element.
 * @param active - Boolean indicating if the focus trap is currently active.
 * @param onEscape - Optional callback invoked when the Escape key is pressed.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void
) {
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;

    // Cache the currently focused element to restore it later
    previouslyFocusedElement.current = document.activeElement as HTMLElement;

    const element = ref.current;
    if (!element) return;

    // Focus the first focusable element inside the ref container
    const focusableElements = getFocusableElements(element);
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      const container = ref.current;
      if (!container) return;

      if (event.key === "Escape") {
        if (onEscapeRef.current) {
          event.preventDefault();
          onEscapeRef.current();
        }
        return;
      }

      if (event.key !== "Tab") return;

      const currentFocusable = getFocusableElements(container);

      if (currentFocusable.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = currentFocusable[0];
      const lastElement = currentFocusable[currentFocusable.length - 1];

      if (event.shiftKey) {
        // Shift + Tab: if on the first element, wrap around to the last element
        if (document.activeElement === firstElement) {
          lastElement.focus();
          event.preventDefault();
        }
      } else {
        // Tab: if on the last element, wrap around to the first element
        if (document.activeElement === lastElement) {
          firstElement.focus();
          event.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the triggering element when deactivated/unmounted
      if (previouslyFocusedElement.current) {
        previouslyFocusedElement.current.focus();
      }
    };
  }, [active, ref]);
}
