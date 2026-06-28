import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useId } from "react";
import { KeyboardShortcut } from "../hooks/useKeyboardShortcuts";

interface ShortcutRegistryContextType {
  registerShortcuts: (id: string, shortcuts: KeyboardShortcut[]) => void;
  unregisterShortcuts: (id: string) => void;
  shortcuts: KeyboardShortcut[];
}

export const ShortcutRegistryContext = createContext<ShortcutRegistryContextType | undefined>(undefined);

export function ShortcutRegistryProvider({ children }: { children: React.ReactNode }) {
  const [registry, setRegistry] = useState<Record<string, KeyboardShortcut[]>>({});

  const registerShortcuts = useCallback((id: string, newShortcuts: KeyboardShortcut[]) => {
    setRegistry((prev) => ({
      ...prev,
      [id]: newShortcuts,
    }));
  }, []);

  const unregisterShortcuts = useCallback((id: string) => {
    setRegistry((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }, []);

  // Compute and deduplicate shortcuts by key
  const shortcuts = useMemo(() => {
    const map = new Map<string, KeyboardShortcut>();
    Object.values(registry).forEach((shortcutsGroup) => {
      shortcutsGroup.forEach((shortcut) => {
        map.set(shortcut.key.toLowerCase(), shortcut);
      });
    });
    return Array.from(map.values());
  }, [registry]);

  const value = useMemo(
    () => ({
      registerShortcuts,
      unregisterShortcuts,
      shortcuts,
    }),
    [registerShortcuts, unregisterShortcuts, shortcuts]
  );

  return (
    <ShortcutRegistryContext.Provider value={value}>
      {children}
    </ShortcutRegistryContext.Provider>
  );
}

/**
 * Hook to dynamically register keyboard shortcuts inside a component.
 */
export function useRegisterShortcuts(shortcuts: KeyboardShortcut[]) {
  const context = useContext(ShortcutRegistryContext);
  const id = useId();

  useEffect(() => {
    if (!context) return;
    context.registerShortcuts(id, shortcuts);
    return () => {
      context.unregisterShortcuts(id);
    };
  }, [id, shortcuts, context]);
}
