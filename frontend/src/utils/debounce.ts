/**
 * debounce - Creates a debounced function that delays invoking `fn` until after
 * `wait` milliseconds have elapsed since the last time the debounced function was invoked.
 *
 * @template T
 * @param {T} fn - The function to debounce
 * @param {number} [wait=300] - Delay in milliseconds
 * @returns Debounced function with `.cancel()` and `.flush()` methods
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  wait: number = 300
): ((...args: Parameters<T>) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = (...args: Parameters<T>) => {
    lastArgs = args;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs !== null) {
        fn(...lastArgs);
        lastArgs = null;
      }
    }, wait);
  };

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timer !== null && lastArgs !== null) {
      clearTimeout(timer);
      timer = null;
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  return debounced;
}
