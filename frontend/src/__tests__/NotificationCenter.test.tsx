import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NotificationCenter from "../components/NotificationCenter";
import { useToast } from "../hooks/useToast";
import type { Notification } from "../hooks/useToast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNotification(
  id: number,
  message: string,
  opts: Partial<Notification> = {}
): Notification {
  return {
    id,
    message,
    variant: "info",
    timestamp: new Date("2024-01-15T10:00:00Z"),
    read: false,
    ...opts,
  };
}

function renderCenter(
  notifications: Notification[],
  {
    unreadCount = 0,
    onMarkAllRead = vi.fn(),
    onClearAll = vi.fn(),
  }: {
    unreadCount?: number;
    onMarkAllRead?: () => void;
    onClearAll?: () => void;
  } = {}
) {
  return render(
    <NotificationCenter
      notifications={notifications}
      unreadCount={unreadCount}
      onMarkAllRead={onMarkAllRead}
      onClearAll={onClearAll}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("NotificationCenter", () => {
  // ── Bell icon ─────────────────────────────────────────────────────────────

  it("renders the bell button", () => {
    renderCenter([]);
    expect(screen.getByTestId("notification-bell")).toBeInTheDocument();
  });

  it("shows no badge when unreadCount is 0", () => {
    renderCenter([], { unreadCount: 0 });
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();
  });

  it("shows badge with unread count", () => {
    renderCenter([], { unreadCount: 3 });
    const badge = screen.getByTestId("notification-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("3");
  });

  it("badge count increments reflect prop changes", () => {
    const { rerender } = renderCenter([], { unreadCount: 1 });
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("1");

    rerender(
      <NotificationCenter
        notifications={[]}
        unreadCount={4}
        onMarkAllRead={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("4");
  });

  it("caps badge display at 99+", () => {
    renderCenter([], { unreadCount: 150 });
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("99+");
  });

  // ── Panel open/close ──────────────────────────────────────────────────────

  it("panel is hidden initially", () => {
    renderCenter([]);
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();
  });

  it("clicking bell opens the panel", () => {
    renderCenter([]);
    fireEvent.click(screen.getByTestId("notification-bell"));
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();
  });

  it("clicking bell again closes the panel", () => {
    renderCenter([]);
    fireEvent.click(screen.getByTestId("notification-bell"));
    fireEvent.click(screen.getByTestId("notification-bell"));
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();
  });

  it("panel renders all notifications", () => {
    const notes = [
      makeNotification(1, "Subscription created"),
      makeNotification(2, "Charge failed"),
      makeNotification(3, "Payment confirmed"),
    ];
    renderCenter(notes);
    fireEvent.click(screen.getByTestId("notification-bell"));

    expect(screen.getByText("Subscription created")).toBeInTheDocument();
    expect(screen.getByText("Charge failed")).toBeInTheDocument();
    expect(screen.getByText("Payment confirmed")).toBeInTheDocument();
  });

  it("shows empty state when there are no notifications", () => {
    renderCenter([]);
    fireEvent.click(screen.getByTestId("notification-bell"));
    expect(screen.getByTestId("notifications-empty")).toBeInTheDocument();
  });

  // ── Explorer link ─────────────────────────────────────────────────────────

  it("shows View on Explorer link for notifications with txHash", () => {
    const notes = [makeNotification(1, "Tx confirmed", { txHash: "abc123" })];
    renderCenter(notes);
    fireEvent.click(screen.getByTestId("notification-bell"));

    const link = screen.getByTestId("notification-explorer-link-1");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", expect.stringContaining("abc123"));
    expect(link).toHaveTextContent("View on Explorer");
  });

  it("does not show explorer link when txHash is absent", () => {
    const notes = [makeNotification(1, "Info message")];
    renderCenter(notes);
    fireEvent.click(screen.getByTestId("notification-bell"));

    expect(screen.queryByTestId("notification-explorer-link-1")).not.toBeInTheDocument();
  });

  // ── Clear all ─────────────────────────────────────────────────────────────

  it("clear-all button calls onClearAll", () => {
    const onClearAll = vi.fn();
    const notes = [makeNotification(1, "Hello")];
    renderCenter(notes, { onClearAll });
    fireEvent.click(screen.getByTestId("notification-bell"));

    fireEvent.click(screen.getByTestId("clear-all-notifications"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("clear-all button is absent when notification list is empty", () => {
    renderCenter([]);
    fireEvent.click(screen.getByTestId("notification-bell"));
    expect(screen.queryByTestId("clear-all-notifications")).not.toBeInTheDocument();
  });

  // ── Mark all read ─────────────────────────────────────────────────────────

  it("opening the panel calls onMarkAllRead when there are unread items", () => {
    const onMarkAllRead = vi.fn();
    renderCenter([], { unreadCount: 2, onMarkAllRead });
    fireEvent.click(screen.getByTestId("notification-bell"));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("opening the panel does not call onMarkAllRead when unreadCount is 0", () => {
    const onMarkAllRead = vi.fn();
    renderCenter([], { unreadCount: 0, onMarkAllRead });
    fireEvent.click(screen.getByTestId("notification-bell"));
    expect(onMarkAllRead).not.toHaveBeenCalled();
  });
});

// ── useToast integration ──────────────────────────────────────────────────────

describe("useToast — notification accumulation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("adds a toast and auto-dismisses after 5s", () => {
    function Test() {
      const { toasts, addToast } = useToast();
      return (
        <div>
          <button onClick={() => addToast("hello", "info")}>add</button>
          <div data-testid="list">
            {toasts.map((t) => (
              <div key={t.id} data-testid={`toast-${t.id}`}>
                {t.message}
              </div>
            ))}
          </div>
        </div>
      );
    }

    render(<Test />);
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByTestId(/toast-/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId(/toast-/)).toBeNull();
  });

  it("toast is auto-dismissed but persists in notifications", () => {
    function Test() {
      const { toasts, notifications, addToast } = useToast();
      return (
        <div>
          <button onClick={() => addToast("tx done", "success", "hash123")}>add</button>
          <span data-testid="toast-count">{toasts.length}</span>
          <span data-testid="notif-count">{notifications.length}</span>
        </div>
      );
    }

    render(<Test />);
    fireEvent.click(screen.getByText("add"));

    expect(screen.getByTestId("toast-count")).toHaveTextContent("1");
    expect(screen.getByTestId("notif-count")).toHaveTextContent("1");

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Toast gone, notification persists
    expect(screen.getByTestId("toast-count")).toHaveTextContent("0");
    expect(screen.getByTestId("notif-count")).toHaveTextContent("1");
  });

  it("unreadCount increments with each new notification", () => {
    function Test() {
      const { unreadCount, addToast } = useToast();
      return (
        <div>
          <button onClick={() => addToast("msg", "info")}>add</button>
          <span data-testid="unread">{unreadCount}</span>
        </div>
      );
    }

    render(<Test />);
    expect(screen.getByTestId("unread")).toHaveTextContent("0");

    fireEvent.click(screen.getByText("add"));
    expect(screen.getByTestId("unread")).toHaveTextContent("1");

    fireEvent.click(screen.getByText("add"));
    expect(screen.getByTestId("unread")).toHaveTextContent("2");
  });

  it("markAllRead sets unreadCount to 0", () => {
    function Test() {
      const { unreadCount, addToast, markAllRead } = useToast();
      return (
        <div>
          <button onClick={() => addToast("msg", "info")}>add</button>
          <button onClick={markAllRead}>mark read</button>
          <span data-testid="unread">{unreadCount}</span>
        </div>
      );
    }

    render(<Test />);
    fireEvent.click(screen.getByText("add"));
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByTestId("unread")).toHaveTextContent("2");

    fireEvent.click(screen.getByText("mark read"));
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
  });

  it("clearNotifications empties the notification list", () => {
    function Test() {
      const { notifications, addToast, clearNotifications } = useToast();
      return (
        <div>
          <button onClick={() => addToast("msg", "info")}>add</button>
          <button onClick={clearNotifications}>clear</button>
          <span data-testid="count">{notifications.length}</span>
        </div>
      );
    }

    render(<Test />);
    fireEvent.click(screen.getByText("add"));
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByTestId("count")).toHaveTextContent("2");

    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});
