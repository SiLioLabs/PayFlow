import React from "react";
import { render, screen, act } from "@testing-library/react";
import { useAccessibility } from "../hooks/useAccessibility";

function Test() {
  const { announcement, announce } = useAccessibility();
  return (
    <div>
      <span data-testid="announcement">{announcement}</span>
      <button onClick={() => announce("hello world")}>Announce</button>
    </div>
  );
}

describe("useAccessibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announce sets the announcement after a frame", () => {
    render(<Test />);

    const btn = screen.getByText("Announce");
    act(() => btn.click());

    // immediately after clicking, hook clears then schedules frame
    expect(screen.getByTestId("announcement").textContent).toBe("");

    // advance frames
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByTestId("announcement").textContent).toBe("hello world");
  });
});
