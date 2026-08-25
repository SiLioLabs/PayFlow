/**
 * OfflineBanner — displays a full-width warning when the user is offline.
 *
 * Acceptance Criteria (Issue #668):
 *  - Renders a full-width banner: "You are offline. Wallet actions are unavailable."
 *  - Auto-dismisses (disappears) when connectivity is restored
 *  - ARIA role="alert" so screen readers announce the message immediately
 *  - Keyboard-accessible dismiss button
 */
import React from "react";

interface OfflineBannerProps {
  /** When true the banner is visible; when false it is not rendered. */
  visible: boolean;
}

/**
 * Full-width offline notification banner.
 * Mount this near the top of the application shell and control visibility
 * via the `visible` prop (driven by `useNetworkStatus`).
 */
export default function OfflineBanner({ visible }: OfflineBannerProps) {
  if (!visible) return null;

  return (
    <div
      className="offline-banner"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="offline-banner"
    >
      <span className="offline-banner__icon" aria-hidden="true">
        📡
      </span>
      <span className="offline-banner__message">
        You are offline. Wallet actions are unavailable.
      </span>
    </div>
  );
}
