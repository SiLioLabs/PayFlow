import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import WalletSelectModal from "../components/WalletSelectModal";
import type { WalletAdapter } from "../services/wallets/WalletAdapter";

// Mock adapters
const createMockAdapter = (
  id: string,
  name: string,
  installed: boolean = true
): WalletAdapter => ({
  id,
  name,
  icon: "🔐",
  isInstalled: vi.fn().mockResolvedValue(installed),
  connect: vi.fn().mockResolvedValue("GTEST..."),
  disconnect: vi.fn().mockResolvedValue(undefined),
  signTransaction: vi.fn().mockResolvedValue("signed_xdr"),
});

describe("WalletSelectModal", () => {
  const mockAdapters = [
    createMockAdapter("freighter", "Freighter", true),
    createMockAdapter("xbull", "xBull", false),
  ];

  it("renders wallet options", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal adapters={mockAdapters} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
      expect(screen.getByText("xBull")).toBeInTheDocument();
    });
  });

  it("shows 'Not Installed' badge for unavailable wallets", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal adapters={mockAdapters} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByText("Not Installed")).toBeInTheDocument();
    });
  });

  it("does not show error UI when connectionStatus is notStarted", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="notStarted"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("wallet-connection-error")).not.toBeInTheDocument();
  });

  it("shows error message when connectionStatus is error", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const errorMessage = "Freighter wallet not found. Please install it.";

    render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="error"
        error={errorMessage}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("wallet-connection-error")).toBeInTheDocument();
    });

    expect(screen.getByText(/Connection Failed:/)).toBeInTheDocument();
    expect(screen.getByText(errorMessage, { exact: false })).toBeInTheDocument();
  });

  it("shows retry button when connection fails", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="notStarted"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
    });

    // User selects a wallet
    const freighterButton = screen.getByTestId("wallet-option-freighter");
    fireEvent.click(freighterButton);

    expect(onSelect).toHaveBeenCalledWith(mockAdapters[0]);

    // Re-render with error state
    const { rerender } = render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="error"
        error="Connection timeout"
      />
    );

    rerender(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="error"
        error="Connection timeout"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("wallet-retry-button")).toBeInTheDocument();
    });
  });

  it("calls onSelect again when retry button is clicked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="notStarted"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
    });

    // User selects a wallet
    const freighterButton = screen.getByTestId("wallet-option-freighter");
    fireEvent.click(freighterButton);

    expect(onSelect).toHaveBeenCalledTimes(1);

    // Simulate error state
    rerender(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="error"
        error="RPC failed"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("wallet-retry-button")).toBeInTheDocument();
    });

    // Click retry
    const retryButton = screen.getByTestId("wallet-retry-button");
    fireEvent.click(retryButton);

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(mockAdapters[0]);
  });

  it("disables wallet buttons when connectionStatus is connecting", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="connecting"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
    });

    const freighterButton = screen.getByTestId("wallet-option-freighter");
    expect(freighterButton).toBeDisabled();
  });

  it("shows connecting indicator on selected wallet", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="notStarted"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
    });

    // User selects a wallet
    const freighterButton = screen.getByTestId("wallet-option-freighter");
    fireEvent.click(freighterButton);

    // Simulate connecting state
    rerender(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="connecting"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("(Connecting...)")).toBeInTheDocument();
    });
  });

  it("has proper ARIA attributes for accessibility", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="error"
        error="Test error"
      />
    );

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "wallet-modal-title");
    });

    const errorAlert = screen.getByRole("alert");
    expect(errorAlert).toHaveAttribute("aria-live", "assertive");
    expect(errorAlert).toHaveTextContent("Test error");
  });

  it("announces error to screen readers", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="error"
        error="Wallet connection timed out"
      />
    );

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveAttribute("aria-live", "assertive");
    });
  });

  it("closes modal when cancel button is clicked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal adapters={mockAdapters} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("distinguishes error from no wallet (notStarted) state", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="notStarted"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
    });

    // No error UI in notStarted state
    expect(screen.queryByTestId("wallet-connection-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wallet-retry-button")).not.toBeInTheDocument();

    // Rerender with error state
    rerender(
      <WalletSelectModal
        adapters={mockAdapters}
        onSelect={onSelect}
        onClose={onClose}
        connectionStatus="error"
        error="Failed to connect"
      />
    );

    // Error UI is visible
    await waitFor(() => {
      expect(screen.getByTestId("wallet-connection-error")).toBeInTheDocument();
    });
  });

  it("closes modal on Escape key press", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal adapters={mockAdapters} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("attaches dialog semantics to the modal-card and presentation to overlay", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    const { container } = render(
      <WalletSelectModal adapters={mockAdapters} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
    });

    const overlay = container.querySelector(".modal-overlay");
    expect(overlay).toHaveAttribute("role", "presentation");

    const card = container.querySelector(".modal-card");
    expect(card).toHaveAttribute("role", "dialog");
    expect(card).toHaveAttribute("aria-modal", "true");
    expect(card).toHaveAttribute("aria-labelledby", "wallet-modal-title");
  });

  it("manages focus inside the dialog with initial focus and tab wrapping", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal adapters={mockAdapters} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("wallet-option-freighter")).toBeInTheDocument();
    });

    const freighterBtn = screen.getByTestId("wallet-option-freighter");
    const cancelBtn = screen.getByText("Cancel");

    // Initial focus is placed on the first focusable element inside the modal
    expect(document.activeElement).toBe(freighterBtn);

    // Tab wrap from last element (cancel button) to first element (freighterBtn)
    cancelBtn.focus();
    expect(document.activeElement).toBe(cancelBtn);

    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(freighterBtn);

    // Shift+Tab wrap from first element (freighterBtn) to last element (cancelBtn)
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancelBtn);
  });

  it("restores focus to previous element when closed", async () => {
    const button = document.createElement("button");
    button.textContent = "Open Modal";
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    const onSelect = vi.fn();
    const onClose = vi.fn();

    const { unmount } = render(
      <WalletSelectModal adapters={mockAdapters} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("wallet-option-freighter")).toBeInTheDocument();
    });

    expect(document.activeElement).not.toBe(button);

    unmount();
    expect(document.activeElement).toBe(button);
    document.body.removeChild(button);
  });

  it("handles empty wallet adapters without checking indefinitely", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal adapters={[]} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByText("No wallets available.")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Checking for available wallets/i)).not.toBeInTheDocument();
  });

  it("preserves healthy adapters if an individual adapter check fails", async () => {
    const failingAdapter = createMockAdapter("broken", "BrokenWallet", false);
    failingAdapter.isInstalled = vi.fn().mockRejectedValue(new Error("Adapter check failed"));

    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal
        adapters={[mockAdapters[0], failingAdapter]}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
      expect(screen.getByText("BrokenWallet")).toBeInTheDocument();
    });

    // The failing adapter is preserved with "Not Installed" rather than crashing/hiding all
    expect(screen.getAllByText("Not Installed")).toHaveLength(1);
    expect(screen.queryByTestId("wallet-discovery-error")).not.toBeInTheDocument();
  });

  it("displays recoverable error state when all adapter checks fail", async () => {
    const fail1 = createMockAdapter("w1", "Wallet1", false);
    fail1.isInstalled = vi.fn().mockRejectedValue(new Error("Fail 1"));
    const fail2 = createMockAdapter("w2", "Wallet2", false);
    fail2.isInstalled = vi.fn().mockRejectedValue(new Error("Fail 2"));

    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <WalletSelectModal adapters={[fail1, fail2]} onSelect={onSelect} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("wallet-discovery-error")).toBeInTheDocument();
    });

    expect(screen.getByText(/Discovery Failed:/i)).toBeInTheDocument();
    expect(screen.getByTestId("wallet-discovery-retry-button")).toBeInTheDocument();

    // Clicking retry attempts check again
    fail1.isInstalled = vi.fn().mockResolvedValue(true);
    fail2.isInstalled = vi.fn().mockResolvedValue(true);

    fireEvent.click(screen.getByTestId("wallet-discovery-retry-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("wallet-discovery-error")).not.toBeInTheDocument();
    });
  });
});
