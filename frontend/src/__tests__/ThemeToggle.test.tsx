import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ThemeToggle from "../components/ThemeToggle";

const STORAGE_KEY = "flowpay_theme";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders a light-mode action when the theme is dark (default)", () => {
    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: /switch to light mode/i })
    ).toBeInTheDocument();
  });

  it("toggles the theme and persists the preference on click", async () => {
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button"));

    expect(
      screen.getByRole("button", { name: /switch to dark mode/i })
    ).toBeInTheDocument();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify("light"));
  });

  it("renders a dark-mode action when a light theme is already persisted", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify("light"));

    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: /switch to dark mode/i })
    ).toBeInTheDocument();
  });
});
