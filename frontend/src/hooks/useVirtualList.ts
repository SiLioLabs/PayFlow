/**
 * useVirtualList - Renders only the visible portion of a large list for performance.
 *
 * Calculates visible items, total scroll height, and scroll offset based on
 * container dimensions and item height. Supports overscan to reduce blank space
 * during fast scrolling.
 *
 * @template T
 * @param {T[]} items - The full list of items to virtualize
 * @param {number} itemHeight - Fixed height of each row in pixels
 * @param {number} containerHeight - Height of the scrollable container in pixels
 * @returns {Object} Virtual list calculations and event handlers
 * @returns {VirtualListItem<T>[]} returns.visibleItems - Items currently in the viewport (+ overscan)
 * @returns {number} returns.totalHeight - Total height of all items combined
 * @returns {number} returns.offsetY - CSS translateY offset for the visible slice
 * @returns {Function} returns.onScroll - Scroll event handler to attach to the container
 *
 * @example
 * const { visibleItems, totalHeight, offsetY, onScroll } = useVirtualList(
 *   items,
 *   itemHeight = 48,
 *   containerHeight = 600
 * );
 *
 * return (
 *   <div onScroll={onScroll} style={{ height: 600, overflow: "auto" }}>
 *     <div style={{ height: totalHeight, position: "relative" }}>
 *       <div style={{ transform: `translateY(${offsetY}px)` }}>
 *         {visibleItems.map(({ item, index }) => (
 *           <div key={index} style={{ height: 48 }}>{item}</div>
 *         ))}
 *       </div>
 *     </div>
 *   </div>
 * );
 */
import { useCallback, useMemo, useState, type UIEvent } from "react";

const OVERSCAN_ROWS = 3;

export interface VirtualListItem<T> {
  item: T;
  index: number;
}

interface VirtualListResult<T> {
  visibleItems: VirtualListItem<T>[];
  totalHeight: number;
  offsetY: number;
  onScroll: (event: UIEvent) => void;
}

export function useVirtualList<T>(
  items: T[],
  itemHeight: number,
  containerHeight: number
): VirtualListResult<T> {
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback((event: UIEvent) => {
    setScrollTop((event.currentTarget as { scrollTop: number }).scrollTop);
  }, []);

  return useMemo(() => {
    const totalHeight = items.length * itemHeight;

    if (items.length === 0 || itemHeight <= 0 || containerHeight <= 0) {
      return {
        visibleItems: [],
        totalHeight,
        offsetY: 0,
        onScroll,
      };
    }

    const maxFirstVisibleIndex = Math.max(items.length - 1, 0);
    const firstVisibleIndex = Math.min(Math.floor(scrollTop / itemHeight), maxFirstVisibleIndex);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const startIndex = Math.max(firstVisibleIndex - OVERSCAN_ROWS, 0);
    const endIndex = Math.min(firstVisibleIndex + visibleCount + OVERSCAN_ROWS, items.length);
    const visibleItems = items
      .slice(startIndex, endIndex)
      .map((item, offset) => ({ item, index: startIndex + offset }));

    return {
      visibleItems,
      totalHeight,
      offsetY: startIndex * itemHeight,
      onScroll,
    };
  }, [containerHeight, itemHeight, items, onScroll, scrollTop]);
}
