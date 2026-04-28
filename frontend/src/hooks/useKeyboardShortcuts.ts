import { useEffect } from "react";

export interface KeyboardShortcut {
  key: string;
  description: string;
  action: () => void;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  shortcuts: KeyboardShortcut[];
}

/**
 * Hook that enables keyboard shortcuts for navigation and actions.
 * 
 * @param options - Configuration object with shortcuts and enabled flag
 * @returns Array of shortcuts for documentation/help display
 */
export function useKeyboardShortcuts({
  enabled = true,
  shortcuts,
}: UseKeyboardShortcutsOptions): KeyboardShortcut[] {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      // Ignore shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Find and execute matching shortcut
      const shortcut = shortcuts.find(
        (s) => s.key.toLowerCase() === event.key.toLowerCase()
      );

      if (shortcut) {
        event.preventDefault();
        shortcut.action();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, shortcuts]);

  return shortcuts;
}
