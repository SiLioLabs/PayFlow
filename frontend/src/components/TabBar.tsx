import React from "react";
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

  return (
    <nav
      className={`tab-bar${isMobile ? " tab-bar--mobile" : ""}`}
      aria-label="Main navigation"
      role="tablist"
    >
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          onClick={() => onTabChange(t)}
          className={`tab-button${activeTab === t ? " tab-button--active" : ""}`}
          aria-current={activeTab === t ? "page" : undefined}
          aria-selected={activeTab === t}
          // Inline style ensures minimum 44×44px touch target per WCAG 2.5.5
          // even if CSS is not yet loaded
          style={{ minHeight: 44, minWidth: 44 }}
        >
          {TAB_LABELS[t]}
        </button>
      ))}
    </nav>
  );
}
