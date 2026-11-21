import React, { useCallback, useRef } from "react";
import { useResponsive } from "../hooks/useResponsive";

type Tab = "dashboard" | "subscribe" | "merchant" | "admin";

const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Dashboard",
  subscribe: "Subscribe",
  merchant: "Merchant",
  admin: "Admin",
};

interface Props {
  tabs: readonly Tab[];
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export default function TabBar({ tabs, activeTab, onTabChange }: Props) {
  const { isMobile } = useResponsive();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      let newIndex = index;
      const tabCount = tabs.length;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          newIndex = (index + 1) % tabCount;
          break;
        case "ArrowLeft":
          event.preventDefault();
          newIndex = (index - 1 + tabCount) % tabCount;
          break;
        case "Home":
          event.preventDefault();
          newIndex = 0;
          break;
        case "End":
          event.preventDefault();
          newIndex = tabCount - 1;
          break;
        default:
          return;
      }

      tabRefs.current[newIndex]?.focus();
      onTabChange(tabs[newIndex]);
    },
    [tabs, onTabChange]
  );

  return (
    <nav
      className={`tab-bar${isMobile ? " tab-bar--mobile" : ""}`}
      aria-label="Main navigation"
      role="tablist"
    >
      {tabs.map((t, index) => {
        const isActive = activeTab === t;
        return (
          <button
            key={t}
            ref={(el) => (tabRefs.current[index] = el)}
            role="tab"
            onClick={() => onTabChange(t)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`tab-button${isActive ? " tab-button--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            aria-selected={isActive}
            aria-controls={`panel-${t}`}
            id={`tab-${t}`}
            tabIndex={isActive ? 0 : -1}
            // Inline style ensures minimum 44×44px touch target per WCAG 2.5.5
            // even if CSS is not yet loaded
            style={{ minHeight: 44, minWidth: 44 }}
          >
            {TAB_LABELS[t]}
          </button>
        );
      })}
    </nav>
  );
}
