import { useEffect, useContext } from "react";
import { ShortcutRegistryContext } from "../context/ShortcutRegistry";

export interface KeyboardShortcut {
  key: string;
  description: string;
  action: () => void;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  shortcuts?: KeyboardShortcut[];
}

/**
 * Hook that enables keyboard shortcuts for navigation and actions.
 *
 * @param options - Configuration object with shortcuts and enabled flag
 * @returns Array of shortcuts for documentation/help display
 */
export function useKeyboardShortcuts(options?: UseKeyboardShortcutsOptions): KeyboardShortcut[] {
  const enabled = options?.enabled !== false;
  const context = useContext(ShortcutRegistryContext);

  const shortcuts = context ? context.shortcuts : (options?.shortcuts ?? []);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        context?.isModalActive() ||
        (target instanceof Element &&
          (target.closest(
            'input, textarea, select, [role="textbox"], [role="combobox"], [contenteditable]'
          ) !== null ||
            (target as HTMLElement).isContentEditable))
      ) {
        return;
      }

      // Find and execute matching shortcut
      const shortcut = shortcuts.find((s) => s.key.toLowerCase() === event.key.toLowerCase());

      if (shortcut) {
        event.preventDefault();
        shortcut.action();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [context, enabled, shortcuts]);

  return shortcuts;
}
