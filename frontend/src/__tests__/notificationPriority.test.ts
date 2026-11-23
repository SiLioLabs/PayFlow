import { describe, it, expect } from "vitest";
import { shouldShowToastWhilePaused } from "../utils/notificationPriority";

describe("shouldShowToastWhilePaused", () => {
  it("allows info toasts when not paused", () => {
    expect(shouldShowToastWhilePaused("info", false)).toBe(true);
  });

  it("allows success toasts when not paused", () => {
    expect(shouldShowToastWhilePaused("success", false)).toBe(true);
  });

  it("allows error toasts when not paused", () => {
    expect(shouldShowToastWhilePaused("error", false)).toBe(true);
  });

  it("suppresses info toasts while paused", () => {
    expect(shouldShowToastWhilePaused("info", true)).toBe(false);
  });

  it("allows success toasts while paused", () => {
    expect(shouldShowToastWhilePaused("success", true)).toBe(true);
  });

  it("allows error toasts while paused", () => {
    expect(shouldShowToastWhilePaused("error", true)).toBe(true);
  });
});
