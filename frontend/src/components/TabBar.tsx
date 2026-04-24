import React from "react";

type Tab = "dashboard" | "subscribe";

const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Dashboard",
  subscribe: "Subscribe",
};

interface Props {
  tabs: readonly Tab[];
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export default function TabBar({ tabs, activeTab, onTabChange }: Props) {
  return (
    <nav className="tab-bar" aria-label="Main navigation">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onTabChange(t)}
          className={`tab-button${activeTab === t ? " tab-button--active" : ""}`}
          aria-current={activeTab === t ? "page" : undefined}
        >
          {TAB_LABELS[t]}
        </button>
      ))}
    </nav>
  );
}
