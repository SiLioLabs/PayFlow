import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDirtyPreroute } from "../hooks/useDirtyPreroute";

describe("useDirtyPreroute", () => {
  let windowAddSpy: any;
  let windowRemoveSpy: any;
  let documentAddSpy: any;
  let documentRemoveSpy: any;
  let confirmSpy: any;

  beforeEach(() => {
    windowAddSpy = vi.spyOn(window, "addEventListener");
    windowRemoveSpy = vi.spyOn(window, "removeEventListener");
    documentAddSpy = vi.spyOn(document, "addEventListener");
    documentRemoveSpy = vi.spyOn(document, "removeEventListener");
    confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not attach event listeners when form is clean", () => {
    const { unmount } = renderHook(() => useDirtyPreroute(false));

    expect(windowAddSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(documentAddSpy).not.toHaveBeenCalledWith("click", expect.any(Function), { capture: true });

    unmount();
  });

  it("attaches beforeunload and click listeners when dirty", () => {
    const { unmount } = renderHook(() => useDirtyPreroute(true));

    expect(windowAddSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(documentAddSpy).toHaveBeenCalledWith("click", expect.any(Function), { capture: true });

    unmount();

    expect(windowRemoveSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(documentRemoveSpy).toHaveBeenCalledWith("click", expect.any(Function), { capture: true });
  });

  it("beforeunload sets returnValue to prompt when dirty", () => {
    renderHook(() => useDirtyPreroute(true));

    const beforeUnloadCall = windowAddSpy.mock.calls.find((c: any) => c[0] === "beforeunload");
    expect(beforeUnloadCall).toBeDefined();
    
    const handler = beforeUnloadCall[1];
    const eventMock = {
      preventDefault: vi.fn(),
      returnValue: undefined as string | undefined,
    } as unknown as BeforeUnloadEvent;

    handler(eventMock);

    expect(eventMock.preventDefault).toHaveBeenCalled();
    expect(eventMock.returnValue).toBe("");
  });

  it("intercepts internal navigation clicks and prompts user", () => {
    renderHook(() => useDirtyPreroute(true));

    const clickCall = documentAddSpy.mock.calls.find((c: any) => c[0] === "click");
    expect(clickCall).toBeDefined();
    
    const handler = clickCall[1];
    
    // Create a mock anchor element to simulate navigation
    const a = document.createElement("a");
    a.href = "/dashboard";
    
    const eventMock = {
      target: a,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    handler(eventMock);

    expect(confirmSpy).toHaveBeenCalledWith("You have unsaved changes. Are you sure you want to leave?");
    expect(eventMock.preventDefault).toHaveBeenCalled();
    expect(eventMock.stopPropagation).toHaveBeenCalled();
  });

  it("allows internal navigation if user confirms they want to leave", () => {
    confirmSpy.mockImplementation(() => true);
    renderHook(() => useDirtyPreroute(true));

    const clickCall = documentAddSpy.mock.calls.find((c: any) => c[0] === "click");
    const handler = clickCall[1];
    
    const tabButton = document.createElement("button");
    tabButton.setAttribute("role", "tab");
    
    const eventMock = {
      target: tabButton,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    handler(eventMock);

    expect(confirmSpy).toHaveBeenCalled();
    expect(eventMock.preventDefault).not.toHaveBeenCalled();
    expect(eventMock.stopPropagation).not.toHaveBeenCalled();
  });

  it("ignores clicks on elements that are not navigation triggers", () => {
    renderHook(() => useDirtyPreroute(true));

    const clickCall = documentAddSpy.mock.calls.find((c: any) => c[0] === "click");
    const handler = clickCall[1];
    
    const div = document.createElement("div"); // Not a link or tab
    
    const eventMock = {
      target: div,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    handler(eventMock);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(eventMock.preventDefault).not.toHaveBeenCalled();
    expect(eventMock.stopPropagation).not.toHaveBeenCalled();
  });

  it("returns true immediately from confirmLeave when clean", () => {
    const { result } = renderHook(() => useDirtyPreroute(false));
    
    const canLeave = result.current();
    expect(canLeave).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("prompts via confirmLeave when dirty", () => {
    confirmSpy.mockImplementation(() => false);
    const { result } = renderHook(() => useDirtyPreroute(true));
    
    const canLeave = result.current();
    expect(canLeave).toBe(false);
    expect(confirmSpy).toHaveBeenCalled();
  });
});
