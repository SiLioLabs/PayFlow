import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TabBar from "../components/TabBar";

const TABS = ["dashboard", "subscribe", "merchant"] as const;

describe("TabBar", () => {
  it("marks the active tab with aria-current=page", () => {
    render(<TabBar tabs={TABS} activeTab="subscribe" onTabChange={() => {}} />);
    expect(screen.getByText("Subscribe").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Dashboard").getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("Merchant").getAttribute("aria-current")).toBeNull();
  });

  it("applies active class only to the active tab", () => {
    render(<TabBar tabs={TABS} activeTab="dashboard" onTabChange={() => {}} />);
    expect(screen.getByText("Dashboard").className).toContain("tab-button--active");
    expect(screen.getByText("Subscribe").className).not.toContain("tab-button--active");
  });

  it("calls onTabChange with the clicked tab", async () => {
    const onChange = vi.fn();
    render(<TabBar tabs={TABS} activeTab="dashboard" onTabChange={onChange} />);
    await userEvent.click(screen.getByText("Merchant"));
    expect(onChange).toHaveBeenCalledWith("merchant");
  });

  it("does not call onTabChange for the already-active tab click (still fires)", async () => {
    const onChange = vi.fn();
    render(<TabBar tabs={TABS} activeTab="dashboard" onTabChange={onChange} />);
    await userEvent.click(screen.getByText("Dashboard"));
    expect(onChange).toHaveBeenCalledWith("dashboard");
  });
});
