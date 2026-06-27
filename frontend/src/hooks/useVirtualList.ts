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
    const firstVisibleIndex = Math.min(
      Math.floor(scrollTop / itemHeight),
      maxFirstVisibleIndex
    );
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const startIndex = Math.max(firstVisibleIndex - OVERSCAN_ROWS, 0);
    const endIndex = Math.min(
      firstVisibleIndex + visibleCount + OVERSCAN_ROWS,
      items.length
    );
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
