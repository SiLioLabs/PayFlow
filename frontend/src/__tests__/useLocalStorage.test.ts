import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLocalStorage } from "../hooks/useLocalStorage";

describe("useLocalStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads initial value from localStorage", () => {
    window.localStorage.setItem("flowpay_test_key", JSON.stringify("saved-value"));

    const { result } = renderHook(() => useLocalStorage("flowpay_test_key", "default-value"));

    expect(result.current[0]).toBe("saved-value");
  });

  it("updates localStorage on state change", () => {
    const { result } = renderHook(() => useLocalStorage("flowpay_test_key", "default-value"));

    act(() => {
      result.current[1]("updated-value");
    });

    expect(result.current[0]).toBe("updated-value");
    expect(window.localStorage.getItem("flowpay_test_key")).toBe(JSON.stringify("updated-value"));
  });

  it("falls back to default value when localStorage contains invalid JSON", () => {
    window.localStorage.setItem("flowpay_test_key", "not-json");

    const { result } = renderHook(() => useLocalStorage("flowpay_test_key", "default-value"));

    expect(result.current[0]).toBe("default-value");
  });
});
