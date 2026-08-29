/**
 * useNetworkStatus — detects online/offline connectivity via navigator.onLine
 * and window online/offline events.
 *
 * Acceptance Criteria (Issue #668):
 *  - Returns the current online status (true = online, false = offline)
 *  - Initialises from navigator.onLine so the page-load-while-offline case is handled
 *  - Automatically updates when the browser fires "online"/"offline" events
 *  - No dependencies on RPC calls — purely browser navigator API
 */
import { useEffect, useState } from "react";

/**
 * Returns `true` when the browser believes it has internet connectivity,
 * `false` when offline.
 *
 * Note: navigator.onLine can return `true` even when there is no actual
 * internet access (e.g. connected to a router but no upstream). This is
 * a known browser limitation — we treat it as online per the spec.
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
