import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useVirtualList } from "../hooks/useVirtualList";

describe("useVirtualList", () => {
  const itemHeight = 40;
  const containerHeight = 200;
  const initialItems = Array.from({ length: 50 }, (_, i) => `item-${i}`);

  it("calculates initial visible items starting at index 0", () => {
    const { result } = renderHook(() =>
      useVirtualList(initialItems, itemHeight, containerHeight)
    );

    expect(result.current.offsetY).toBe(0);
    expect(result.current.visibleItems[0].index).toBe(0);
    expect(result.current.totalHeight).toBe(50 * 40);
  });

  it("updates scrollTop and visible items on scroll event", () => {
    const { result } = renderHook(() =>
      useVirtualList(initialItems, itemHeight, containerHeight)
    );

    const mockContainer = { scrollTop: 400 } as HTMLElement;
    act(() => {
      result.current.onScroll({
        currentTarget: mockContainer,
      } as unknown as React.UIEvent);
    });

    // At scrollTop = 400, firstVisibleIndex is 10.
    // With OVERSCAN_ROWS = 3, startIndex is 7 (offsetY = 7 * 40 = 280)
    expect(result.current.offsetY).toBe(280);
    expect(result.current.visibleItems[0].index).toBe(7);
  });

  it("resets scrollTop and container element scroll when items array changes", () => {
    const mockContainer = { scrollTop: 400 } as HTMLElement;

    const { result, rerender } = renderHook(
      ({ items }) => useVirtualList(items, itemHeight, containerHeight),
      {
        initialProps: { items: initialItems },
      }
    );

    // Simulate scroll
    act(() => {
      result.current.onScroll({
        currentTarget: mockContainer,
      } as unknown as React.UIEvent);
    });

    expect(result.current.offsetY).toBe(280);
    expect(mockContainer.scrollTop).toBe(400);

    // Provide a new items array (e.g. filtered or sorted)
    const newItems = ["filtered-1", "filtered-2", "filtered-3"];
    rerender({ items: newItems });

    // Internal scroll and element scrollTop should be reset to 0
    expect(result.current.offsetY).toBe(0);
    expect(result.current.visibleItems[0].index).toBe(0);
    expect(mockContainer.scrollTop).toBe(0);
  });

  it("resets containerRef scrollTop when provided", () => {
    const containerRef = { current: { scrollTop: 500 } as unknown as HTMLElement };

    const { result, rerender } = renderHook(
      ({ items }) => useVirtualList(items, itemHeight, containerHeight, containerRef),
      {
        initialProps: { items: initialItems },
      }
    );

    // Container was scrolled
    expect(containerRef.current.scrollTop).toBe(0); // reset on mount

    containerRef.current.scrollTop = 300;
    rerender({ items: [...initialItems, "item-51"] });

    expect(containerRef.current.scrollTop).toBe(0);
    expect(result.current.offsetY).toBe(0);
  });

  it("provides resetScroll method to manually reset scroll position", () => {
    const mockContainer = { scrollTop: 600 } as HTMLElement;

    const { result } = renderHook(() =>
      useVirtualList(initialItems, itemHeight, containerHeight)
    );

    act(() => {
      result.current.onScroll({
        currentTarget: mockContainer,
      } as unknown as React.UIEvent);
    });

    expect(mockContainer.scrollTop).toBe(600);

    act(() => {
      result.current.resetScroll();
    });

    expect(mockContainer.scrollTop).toBe(0);
    expect(result.current.offsetY).toBe(0);
  });
});
