import React from "react";
import { render, screen, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import NextChargeCountdown from "../components/NextChargeCountdown";

describe("NextChargeCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows days/hours/minutes until next charge", () => {
    const base = new Date(Date.UTC(2026, 4, 29, 0, 0, 0));
    vi.setSystemTime(base);

    const deltaMs = (1 * 24 + 2) * 60 * 60 * 1000 + 30 * 60 * 1000; // 1d 2h 30m
    const nextTs = Math.floor((base.getTime() + deltaMs) / 1000);

    render(React.createElement(NextChargeCountdown, { nextChargeTimestamp: nextTs }));

    expect(screen.getByText("1d 2h 30m")).toBeTruthy();
  });

  it("shows overdue when timestamp is in the past and updates on interval", () => {
    const base = new Date(Date.UTC(2026, 4, 29, 0, 0, 0));
    vi.setSystemTime(base);

    const nextTs = Math.floor((base.getTime() - 60_000) / 1000);

    render(React.createElement(NextChargeCountdown, { nextChargeTimestamp: nextTs }));

    expect(screen.getByText(/Overdue/)).toBeTruthy();

    // Now test interval-based update: set a future time and advance timers
    const future = Math.floor((base.getTime() + 2 * 60_000) / 1000); // 2 minutes ahead
    // re-render with new prop
    render(React.createElement(NextChargeCountdown, { nextChargeTimestamp: future }));

    expect(screen.getByText("0d 0h 2m")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("0d 0h 1m")).toBeTruthy();
  });
});
