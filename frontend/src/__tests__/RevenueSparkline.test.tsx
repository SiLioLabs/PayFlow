import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RevenueSparkline from "../components/RevenueSparkline";

describe("RevenueSparkline", () => {
  it("renders nothing / fallback when history is empty", () => {
    render(<RevenueSparkline history={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders SVG with correct number of polyline/circle points matching history length", () => {
    const history = [10000000n, 20000000n, 30000000n];
    const { container } = render(<RevenueSparkline history={history} />);

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-describedby", "revenue-data-table");

    const polyline = container.querySelector("polyline");
    expect(polyline).toBeInTheDocument();
    expect(polyline).toHaveAttribute("points");

    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(3);
  });

  it("every point is keyboard focusable", () => {
    const history = [10000000n, 20000000n];
    const { container } = render(<RevenueSparkline history={history} />);

    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(2);
    circles.forEach((circle) => {
      expect(circle).toHaveAttribute("tabindex", "0");
    });
  });

  it("every point contains a title tooltip with formatted XLM values", () => {
    const history = [10000000n, 20000000n];
    const { container } = render(<RevenueSparkline history={history} />);

    const titles = container.querySelectorAll("circle title");
    expect(titles).toHaveLength(2);
    expect(titles[0]).toHaveTextContent("1.0000000 XLM");
    expect(titles[1]).toHaveTextContent("2.0000000 XLM");
  });

  it("accessible data table contains one row per revenue entry", () => {
    const history = [10000000n, 20000000n, 30000000n];
    const { container } = render(<RevenueSparkline history={history} />);

    const table = container.querySelector("table#revenue-data-table");
    expect(table).toBeInTheDocument();
    expect(table).toHaveClass("sr-only");

    const rows = container.querySelectorAll("table#revenue-data-table tbody tr");
    expect(rows).toHaveLength(3);

    expect(rows[0]).toHaveTextContent("Day 1");
    expect(rows[0]).toHaveTextContent("1.0000000 XLM");
  });

  it("React.memo wraps the component", () => {
    expect(RevenueSparkline.$$typeof).toBe(Symbol.for("react.memo"));
  });
});
