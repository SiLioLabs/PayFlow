// useClipboard: writes text to the system clipboard and exposes a timed `copied` flag (#56)
import { useState, useCallback } from "react";

export function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
      } catch {
        // clipboard API unavailable
      }
    },
    [timeout],
  );

  return { copied, copy };
}
