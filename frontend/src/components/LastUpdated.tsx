import React, { useEffect, useState } from "react";

interface Props {
  timestamp: number | null;
  onRefresh: () => void;
}

export default function LastUpdated({ timestamp, onRefresh }: Props) {
  const [relativeTime, setRelativeTime] = useState<string>("");

  useEffect(() => {
    if (!timestamp) {
      setRelativeTime("");
      return;
    }

    const updateRelativeTime = () => {
      const seconds = Math.floor((Date.now() - timestamp) / 1000);
      if (seconds < 5) {
        setRelativeTime("just now");
      } else if (seconds < 60) {
        setRelativeTime(`${seconds}s ago`);
      } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        setRelativeTime(`${minutes}m ago`);
      } else {
        const hours = Math.floor(seconds / 3600);
        setRelativeTime(`${hours}h ago`);
      }
    };

    updateRelativeTime();
    // Update every 5 seconds to keep it fresh
    const interval = setInterval(updateRelativeTime, 5000);
    return () => clearInterval(interval);
  }, [timestamp]);

  if (!timestamp) return null;

  return (
    <div className="flex items-center gap-2" data-testid="last-updated">
      <span className="text-sm text-muted">Updated {relativeTime}</span>
      <button 
        onClick={onRefresh} 
        className="btn-secondary" 
        style={{ padding: "4px 8px", fontSize: "0.875rem" }}
        aria-label="Refresh data"
      >
        Refresh
      </button>
    </div>
  );
}
