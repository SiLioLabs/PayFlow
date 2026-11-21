import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "../hooks/useTheme";

const STORAGE_KEY = "flowpay_theme";

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark and applies data-theme to the document root", () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggles to light, updates data-theme, and persists to localStorage", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggle());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify("light"));
  });

  it("toggles back to dark from light", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify("light"));
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggle());

    expect(result.current.theme).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify("dark"));
  });

  it("reads a persisted theme from localStorage on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify("light"));

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("falls back to dark when localStorage contains an unparseable value", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json");

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");
  });
});
