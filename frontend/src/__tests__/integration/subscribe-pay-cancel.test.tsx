import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import App from "../../App";
import { mockFreighter } from "../__mocks__/freighter";
import * as stellarMocks from "../../stellar";

// Mock the wallet explicitly since we don't know the exact resolution path
const mockAnnounce = vi.fn();
vi.mock("../../hooks/useAccessibility", () => ({
  useAccessibility: () => ({
    announcement: "",
    announce: mockAnnounce,
  }),
}));

// Automatic mocking based on the __mocks__ directory
vi.mock("../../stellar");

describe("Integration: Subscribe -> Pay-Per-Use -> Cancel", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock fetch to prevent outbound network traffic
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as any);

    // Mock Freighter on the window object
    window.freighter = mockFreighter;

    // Reset stellar mocks to base states
    vi.mocked(stellarMocks.getSubscription).mockResolvedValue(null);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it("exercises the complete application flow", async () => {
    render(<App />);

    // 1. Connect Wallet
    const connectBtn = await screen.findByRole("button", { name: /Connect Wallet/i });
    fireEvent.click(connectBtn);

    // Wait for the Dashboard to appear
    const dashboardTitle = await screen.findByText(/No active subscription found./i);
    expect(dashboardTitle).toBeInTheDocument();

    // 2. Create Subscription
    // Switch to Subscribe tab
    const subscribeTab = await screen.findByRole("button", { name: /Subscribe/i });
    fireEvent.click(subscribeTab);

    // Fill the required form fields
    const merchantInput = await screen.findByLabelText(/Merchant Address/i);
    const amountInput = await screen.findByLabelText(/Amount \(XLM\)/i);
    
    fireEvent.change(merchantInput, { target: { value: "GB_MOCK_MERCHANT_ADDR" } });
    fireEvent.change(amountInput, { target: { value: "50" } });

    // Submit the subscription
    const submitBtn = await screen.findByRole("button", { name: /Subscribe Now/i });
    fireEvent.click(submitBtn);

    // Advance fake timers so transactions process
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Check announcement triggers for subscribe
    expect(mockAnnounce).toHaveBeenCalledWith("Transaction submitted");
    expect(mockAnnounce).toHaveBeenCalledWith("Transaction confirmed");

    // The component switches to Dashboard automatically, but we need to mock the subscription so it displays it
    vi.mocked(stellarMocks.getSubscription).mockResolvedValue({
      merchant: "GB_MOCK_MERCHANT_ADDR",
      amount: "500000000",
      interval: 86400,
      last_charged: Math.floor(Date.now() / 1000),
      active: true,
      paused: false,
    });

    // Advance polling loops so usePolling hits getSubscription
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    // Verify Dashboard displays the new subscription
    const activeSubText = await screen.findByText(/Active Subscription/i);
    expect(activeSubText).toBeInTheDocument();

    // 3. Execute Pay-Per-Use
    const ppuInput = await screen.findByPlaceholderText(/Amount in XLM/i);
    fireEvent.change(ppuInput, { target: { value: "5" } });

    // Advance debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const payNowBtn = await screen.findByRole("button", { name: /Pay now/i });
    fireEvent.click(payNowBtn);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Verify PP announcement triggers
    expect(mockAnnounce).toHaveBeenCalledWith("Transaction submitted");
    expect(mockAnnounce).toHaveBeenCalledWith("Transaction confirmed");

    // Verify success toast appears
    const toast = await screen.findByText(/Paid!/i);
    expect(toast).toBeInTheDocument();

    // 4. Cancel Subscription
    const cancelBtn = await screen.findByRole("button", { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    const confirmModalBtn = await screen.findByRole("button", { name: /Confirm/i });
    fireEvent.click(confirmModalBtn);

    // Provide empty subscription to mimic cancellation on next poll
    vi.mocked(stellarMocks.getSubscription).mockResolvedValue(null);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Verify cancel announcement triggers
    expect(mockAnnounce).toHaveBeenCalledWith("Transaction submitted");
    expect(mockAnnounce).toHaveBeenCalledWith("Transaction confirmed");

    // Advance polling loop to reload dashboard
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    // Verify Dashboard updates and displays no active subscription
    const noActiveSubText = await screen.findByText(/No active subscription found./i);
    expect(noActiveSubText).toBeInTheDocument();

    // Verify exactly 6 announcements occurred
    expect(mockAnnounce).toHaveBeenCalledTimes(6);

    // Verify zero real fetch requests were sent
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
