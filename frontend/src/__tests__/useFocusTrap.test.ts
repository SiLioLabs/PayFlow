import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useFocusTrap } from "../hooks/useFocusTrap";

describe("useFocusTrap", () => {
  it("focuses the first focusable element when active", () => {
    const container = document.createElement("div");
    const button1 = document.createElement("button");
    const button2 = document.createElement("button");
    container.appendChild(button1);
    container.appendChild(button2);
    document.body.appendChild(container);

    const ref = { current: container };

    renderHook(() => useFocusTrap(ref, true));

    expect(document.activeElement).toBe(button1);

    document.body.removeChild(container);
  });

  it("calls onEscape when Escape key is pressed", () => {
    const onEscape = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const ref = { current: container };

    renderHook(() => useFocusTrap(ref, true, onEscape));

    const escEvent = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(escEvent);

    expect(onEscape).toHaveBeenCalledTimes(1);

    document.body.removeChild(container);
  });

  it("does not steal focus when onEscape changes and uses the latest callback", () => {
    const oldOnEscape = vi.fn();
    const newOnEscape = vi.fn();
    const container = document.createElement("div");
    const firstButton = document.createElement("button");
    const textInput = document.createElement("input");
    container.append(firstButton, textInput);
    document.body.appendChild(container);
    const ref = { current: container };

    const { rerender, unmount } = renderHook(
      ({ onEscape }) => useFocusTrap(ref, true, onEscape),
      { initialProps: { onEscape: oldOnEscape } }
    );

    textInput.focus();
    rerender({ onEscape: newOnEscape });

    expect(document.activeElement).toBe(textInput);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(oldOnEscape).not.toHaveBeenCalled();
    expect(newOnEscape).toHaveBeenCalledTimes(1);

    unmount();
    document.body.removeChild(container);
  });

  it("skips disabled controls and includes editable and controlled media elements", () => {
    const container = document.createElement("div");
    const disabledButton = document.createElement("button");
    disabledButton.disabled = true;
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const audio = document.createElement("audio");
    audio.setAttribute("controls", "");
    container.append(disabledButton, editable, audio);
    document.body.appendChild(container);
    const ref = { current: container };

    const { unmount } = renderHook(() => useFocusTrap(ref, true));

    expect(document.activeElement).toBe(editable);

    unmount();
    document.body.removeChild(container);
  });

  it("restores focus to previously active element on cleanup", () => {
    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    const container = document.createElement("div");
    const modalBtn = document.createElement("button");
    container.appendChild(modalBtn);
    document.body.appendChild(container);

    const ref = { current: container };

    const { unmount } = renderHook(() => useFocusTrap(ref, true));
    expect(document.activeElement).toBe(modalBtn);

    unmount();
    expect(document.activeElement).toBe(triggerBtn);

    document.body.removeChild(triggerBtn);
    document.body.removeChild(container);
  });

  it("traps Tab key navigation and loops focus inside container", () => {
    const container = document.createElement("div");
    const btn1 = document.createElement("button");
    const btn2 = document.createElement("button");
    container.appendChild(btn1);
    container.appendChild(btn2);
    document.body.appendChild(container);

    const ref = { current: container };
    renderHook(() => useFocusTrap(ref, true));

    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    // Tab forward on the last element wraps around to the first element
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab" });
    const preventDefaultSpy = vi.fn();
    Object.defineProperty(tabEvent, "preventDefault", { value: preventDefaultSpy });
    window.dispatchEvent(tabEvent);

    expect(document.activeElement).toBe(btn1);
    expect(preventDefaultSpy).toHaveBeenCalled();

    // Shift + Tab on the first element wraps around to the last element
    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    const shiftTabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true });
    const preventDefaultShiftSpy = vi.fn();
    Object.defineProperty(shiftTabEvent, "preventDefault", { value: preventDefaultShiftSpy });
    window.dispatchEvent(shiftTabEvent);

    expect(document.activeElement).toBe(btn2);
    expect(preventDefaultShiftSpy).toHaveBeenCalled();

    document.body.removeChild(container);
  });
});
