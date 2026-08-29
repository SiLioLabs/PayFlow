import React, { useRef, useEffect, useState } from "react";
import type { Notification, ToastVariant } from "../hooks/useToast";

interface Props {
  notifications: Notification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  /** Base URL for the Stellar explorer. Defaults to testnet. */
  explorerBase?: string;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function BellIcon({ hasUnread }: { hasUnread: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={hasUnread ? "var(--color-primary)" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function variantIcon(variant: ToastVariant): string {
  if (variant === "success") return "✅";
  if (variant === "error") return "❌";
  return "ℹ️";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Long-message expand ───────────────────────────────────────────────────────

const MAX_MSG_LENGTH = 120;

function NotificationMessage({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  if (message.length <= MAX_MSG_LENGTH) {
    return <span>{message}</span>;
  }
  return (
    <span>
      {expanded ? message : `${message.slice(0, MAX_MSG_LENGTH)}…`}{" "}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-primary)",
          fontSize: "inherit",
          padding: 0,
        }}
        aria-label={expanded ? "Collapse message" : "Expand message"}
      >
        {expanded ? "less" : "more"}
      </button>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function NotificationCenter({
  notifications,
  unreadCount,
  onMarkAllRead,
  onClearAll,
  explorerBase = "https://stellar.expert/explorer/testnet",
}: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Mark all read whenever the panel is opened
  useEffect(() => {
    if (open && unreadCount > 0) {
      onMarkAllRead();
    }
  }, [open, unreadCount, onMarkAllRead]);

  function togglePanel() {
    setOpen((prev) => !prev);
  }

  return (
    <div className="notification-center" style={{ position: "relative", display: "inline-block" }}>
      {/* Bell trigger button */}
      <button
        ref={triggerRef}
        className="btn-secondary notification-center__trigger"
        onClick={togglePanel}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="notification-bell"
        style={{ position: "relative" }}
      >
        <BellIcon hasUnread={unreadCount > 0} />
        {unreadCount > 0 && (
          <span
            className="notification-center__badge"
            data-testid="notification-badge"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              minWidth: "16px",
              height: "16px",
              padding: "0 4px",
              borderRadius: "8px",
              background: "var(--color-danger)",
              color: "#fff",
              fontSize: "0.65rem",
              fontWeight: 700,
              lineHeight: "16px",
              textAlign: "center",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Notification panel */}
      {open && (
        <div
          ref={panelRef}
          className="notification-center__panel card"
          role="dialog"
          aria-label="Notification centre"
          aria-modal="false"
          data-testid="notification-panel"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "340px",
            maxHeight: "480px",
            overflowY: "auto",
            zIndex: 200,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}
        >
          {/* Panel header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "var(--space-3)",
              paddingBottom: "var(--space-2)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Notifications</h4>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              {notifications.length > 0 && (
                <button
                  className="btn-secondary"
                  onClick={onClearAll}
                  data-testid="clear-all-notifications"
                  style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                  aria-label="Clear all notifications"
                >
                  Clear all
                </button>
              )}
              <button
                className="btn-secondary"
                onClick={() => setOpen(false)}
                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                aria-label="Close notifications"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Notification list */}
          {notifications.length === 0 ? (
            <p
              data-testid="notifications-empty"
              style={{
                textAlign: "center",
                opacity: 0.6,
                fontSize: "0.875rem",
                padding: "var(--space-4) 0",
              }}
            >
              No notifications yet.
            </p>
          ) : (
            <ul
              style={{ listStyle: "none", margin: 0, padding: 0 }}
              data-testid="notification-list"
            >
              {notifications.map((n) => (
                <li
                  key={n.id}
                  data-testid={`notification-item-${n.id}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    padding: "var(--space-2) 0",
                    borderBottom: "1px solid var(--color-border)",
                    opacity: n.read ? 0.8 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                    <span aria-hidden="true">{variantIcon(n.variant)}</span>
                    <span style={{ flex: 1, fontSize: "0.875rem" }}>
                      <NotificationMessage message={n.message} />
                    </span>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        opacity: 0.6,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {formatTime(n.timestamp)}
                    </span>
                  </div>
                  {n.txHash && (
                    <a
                      href={`${explorerBase}/tx/${n.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--color-primary)",
                        marginLeft: "26px",
                      }}
                      data-testid={`notification-explorer-link-${n.id}`}
                    >
                      View on Explorer ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
