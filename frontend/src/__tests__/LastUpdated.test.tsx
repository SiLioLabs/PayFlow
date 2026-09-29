import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import LastUpdated from "../components/LastUpdated";

describe("LastUpdated component", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders nothing if timestamp is null", () => {
    const { container } = render(<LastUpdated timestamp={null} onRefresh={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'just now' when timestamp is fresh (< 5 seconds)", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    
    render(<LastUpdated timestamp={now - 2000} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Updated just now/i)).toBeInTheDocument();
  });

  it("shows 'Xs ago' when timestamp is stale (>= 5 seconds)", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    
    render(<LastUpdated timestamp={now - 10000} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Updated 10s ago/i)).toBeInTheDocument();
  });

  it("shows 'Xm ago' when timestamp is older than 60 seconds", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    
    render(<LastUpdated timestamp={now - 120000} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Updated 2m ago/i)).toBeInTheDocument();
  });

  it("shows 'Xh ago' when timestamp is older than 1 hour", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    
    render(<LastUpdated timestamp={now - 3600 * 1000 * 2} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Updated 2h ago/i)).toBeInTheDocument();
  });

  it("updates indicator relative string automatically over time", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    
    render(<LastUpdated timestamp={now} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Updated just now/i)).toBeInTheDocument();

    // Advance time by 10 seconds, which should trigger the interval
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    
    expect(screen.getByText(/Updated 10s ago/i)).toBeInTheDocument();
    
    // Advance time by 60 more seconds
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    
    expect(screen.getByText(/Updated 1m ago/i)).toBeInTheDocument();
  });

  it("calls onRefresh when the refresh button is clicked", () => {
    const onRefresh = vi.fn();
    const now = Date.now();
    vi.setSystemTime(now);
    
    render(<LastUpdated timestamp={now} onRefresh={onRefresh} />);
    
    const button = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(button);
    
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
