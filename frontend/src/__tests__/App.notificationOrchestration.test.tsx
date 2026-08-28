import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import NotificationCenter from "../components/NotificationCenter";
import type { Notification } from "../hooks/useToast";

// Mock Stellar BEFORE importing App — useNetworkCheck imports NETWORK_PASSPHRASE
// from here at module load time, so the real @stellar/stellar-sdk must not load.
vi.mock("../stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  RPC_URL: "https://soroban-testnet.stellar.org",
  CONTRACT_ID: "",
  TOKEN_CONTRACT_ID: "",
  server: { sendTransaction: vi.fn() },
  getContractAdmin: vi.fn().mockResolvedValue(null),
}));

// Mock useWallet so wallet-connected state is controllable per test.
vi.mock("../hooks/useWallet", () => ({
  AVAILABLE_WALLETS: [],
  useWallet: vi.fn(() => ({
    publicKey: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signAndSubmit: vi.fn(),
    error: null,
    connecting: false,
    ready: true,
    activeAdapter: null,
  })),
}));

// Mock useAdmin — irrelevant to notification/pause orchestration.
vi.mock("../hooks/useAdmin", () => ({
  useAdmin: vi.fn(() => ({
    isAdmin: false,
    adminAddress: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));

// Mock useContractPaused — the single source of truth this test suite exercises.
vi.mock("../hooks/useContractPaused", () => ({
  useContractPaused: vi.fn(() => ({ isPaused: false, loading: false })),
}));

// Mock heavy child components so this suite stays focused on App-level wiring.
vi.mock("../components/SubscribeForm", () => ({
  default: () => <div data-testid="subscribe-form" />,
}));
vi.mock("../pages/AdminDashboard", () => ({
  default: () => <div data-testid="admin-dashboard" />,
}));
vi.mock("../components/Dashboard", () => ({
  default: (props: { isPaused?: boolean }) => (
    <div data-testid="dashboard" data-is-paused={String(props.isPaused)} />
  ),
}));
vi.mock("../components/MerchantDashboard", () => ({
  default: (props: { isPaused?: boolean }) => (
    <div data-testid="merchant-dashboard" data-is-paused={String(props.isPaused)} />
  ),
}));

// WalletBar renders NotificationCenter internally in the real app; mock it
// down to that same wiring so we can verify App -> WalletBar -> NotificationCenter
// prop flow without pulling in WalletBar's heavier deps (balance/network badges).
vi.mock("../components/WalletBar", () => {
  return {
    default: (props: {
      publicKey: string;
      onDisconnect: () => void;
      notifications?: Notification[];
      unreadCount?: number;
      onMarkAllRead?: () => void;
      onClearNotifications?: () => void;
    }) => {
      return (
        <div data-testid="wallet-bar">
          <span>{props.publicKey}</span>
          <NotificationCenter
            notifications={props.notifications ?? []}
            unreadCount={props.unreadCount ?? 0}
            onMarkAllRead={props.onMarkAllRead ?? (() => {})}
            onClearAll={props.onClearNotifications ?? (() => {})}
          />
          <button onClick={props.onDisconnect}>Disconnect</button>
        </div>
      );
    },
  };
});

import App from "../App";
import { useWallet } from "../hooks/useWallet";
import { useContractPaused } from "../hooks/useContractPaused";

function mockWallet(publicKey: string | null) {
  (useWallet as ReturnType<typeof vi.fn>).mockReturnValue({
    publicKey,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signAndSubmit: vi.fn(),
    error: null,
    connecting: false,
    ready: true,
    activeAdapter: publicKey ? { id: "freighter", name: "Freighter", icon: "🚢" } : null,
  });
}

function mockPaused(isPaused: boolean) {
  (useContractPaused as ReturnType<typeof vi.fn>).mockReturnValue({ isPaused, loading: false });
}

describe("App — notification priority orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWallet(null);
    mockPaused(false);
  });

  it("renders the contract pause banner when the contract is paused", () => {
    mockPaused(true);
    render(<App />);
    const banner = screen.getByTestId("contract-pause-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "alert");
  });

  it("does not render the contract pause banner when the contract is not paused", () => {
    mockPaused(false);
    render(<App />);
    expect(screen.queryByTestId("contract-pause-banner")).not.toBeInTheDocument();
  });

  it("renders the pause banner before any other app content in the DOM", () => {
    mockPaused(true);
    mockWallet("GABCDEF1234567890");
    render(<App />);
    const banner = screen.getByTestId("contract-pause-banner");
    const walletBar = screen.getByTestId("wallet-bar");
    // compareDocumentPosition: banner precedes walletBar in document order.
    const position = banner.compareDocumentPosition(walletBar);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("threads isPaused=true down to Dashboard", () => {
    mockPaused(true);
    mockWallet("GABCDEF1234567890");
    render(<App />);
    expect(screen.getByTestId("dashboard")).toHaveAttribute("data-is-paused", "true");
  });

  it("threads isPaused=false down to Dashboard", () => {
    mockPaused(false);
    mockWallet("GABCDEF1234567890");
    render(<App />);
    expect(screen.getByTestId("dashboard")).toHaveAttribute("data-is-paused", "false");
  });

  it("threads isPaused down to MerchantDashboard", () => {
    mockPaused(true);
    mockWallet("GABCDEF1234567890");
    render(<App />);
    // Dashboard is the default tab; switch to Merchant to render MerchantDashboard.
    fireEvent.click(screen.getByRole("tab", { name: "Merchant" }));
    expect(screen.getByTestId("merchant-dashboard")).toHaveAttribute("data-is-paused", "true");
  });

  it("mounts NotificationCenter (bell trigger) once a wallet is connected", () => {
    mockWallet("GABCDEF1234567890");
    render(<App />);
    expect(screen.getByTestId("notification-bell")).toBeInTheDocument();
  });

  it("does not render NotificationCenter before a wallet is connected", () => {
    mockWallet(null);
    render(<App />);
    expect(screen.queryByTestId("notification-bell")).not.toBeInTheDocument();
  });
});
