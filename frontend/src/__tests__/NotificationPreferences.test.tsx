import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../context/ToastContext";
import { useToast } from "../hooks/useToast";
import NotificationCenter from "../components/NotificationCenter";

function NotificationPreferencesHarness() {
  const {
    notifications,
    unreadCount,
    toasts,
    addToast,
    markAllRead,
    clearNotifications,
    notificationPreferences,
    setNotificationPreference,
  } = useToast();

  return (
    <>
      <button onClick={() => addToast("Action succeeded", "success")}>Add success</button>
      <span data-testid="notification-count">{notifications.length}</span>
      <span data-testid="toast-count">{toasts.length}</span>
      <NotificationCenter
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
        onClearAll={clearNotifications}
        notificationPreferences={notificationPreferences}
        onNotificationPreferenceChange={setNotificationPreference}
      />
    </>
  );
}

describe("notification preferences", () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("suppresses disabled categories and persists preferences across provider remounts", () => {
    const firstRender = render(
      <ToastProvider>
        <NotificationPreferencesHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId("notification-bell"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Successful transactions" }));
    firstRender.unmount();

    render(
      <ToastProvider>
        <NotificationPreferencesHarness />
      </ToastProvider>
    );
    fireEvent.click(screen.getByTestId("notification-bell"));
    expect(screen.getByRole("checkbox", { name: "Successful transactions" })).not.toBeChecked();
    fireEvent.click(screen.getByText("Add success"));

    expect(screen.getByTestId("notification-count")).toHaveTextContent("0");
    expect(screen.getByTestId("toast-count")).toHaveTextContent("0");
    expect(localStorage.getItem("flowpay_notification_preferences")).toBe(
      JSON.stringify({ success: false, error: true, info: true })
    );
  });
});
