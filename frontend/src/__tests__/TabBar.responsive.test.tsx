import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import TabBar from "../components/TabBar";

const TABS = ["dashboard", "subscribe", "merchant"] as const;

// ─── responsive mock helpers ─────────────────────────────────────────────────
function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      (query.includes("max-width: 639px") && width <= 639) ||
      (query.includes("max-width: 768px") && width <= 768),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("TabBar – responsive & accessibility", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders tab-bar--mobile class on mobile viewport (375px)", () => {
    setViewport(375);
    const { container } = render(
      <TabBar tabs={TABS} activeTab="dashboard" onTabChange={() => {}} />
    );
    expect(container.querySelector(".tab-bar--mobile")).toBeTruthy();
  });

  it("does not render tab-bar--mobile on desktop (1024px)", () => {
    setViewport(1024);
    const { container } = render(
      <TabBar tabs={TABS} activeTab="dashboard" onTabChange={() => {}} />
    );
    expect(container.querySelector(".tab-bar--mobile")).toBeNull();
  });

  it("every tab button has minimum 44px touch target (WCAG 2.5.5)", () => {
    setViewport(375);
    render(<TabBar tabs={TABS} activeTab="dashboard" onTabChange={() => {}} />);
    const buttons = screen.getAllByRole("tab");
    buttons.forEach((btn) => {
      // inline style sets minHeight: 44 on every button
      expect(btn.style.minHeight).toBe("44px");
      expect(btn.style.minWidth).toBe("44px");
    });
  });

  it("uses role=tablist on the nav element", () => {
    setViewport(375);
    render(<TabBar tabs={TABS} activeTab="dashboard" onTabChange={() => {}} />);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });

  it("each button has role=tab", () => {
    setViewport(375);
    render(<TabBar tabs={TABS} activeTab="dashboard" onTabChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(TABS.length);
  });

  it("active tab has aria-selected=true", () => {
    setViewport(375);
    render(<TabBar tabs={TABS} activeTab="subscribe" onTabChange={() => {}} />);
    const subscribeTab = screen.getByText("Subscribe");
    expect(subscribeTab).toHaveAttribute("aria-selected", "true");
  });

  it("inactive tabs have aria-selected=false", () => {
    setViewport(375);
    render(<TabBar tabs={TABS} activeTab="subscribe" onTabChange={() => {}} />);
    const dashboardTab = screen.getByText("Dashboard");
    expect(dashboardTab).toHaveAttribute("aria-selected", "false");
  });
});
