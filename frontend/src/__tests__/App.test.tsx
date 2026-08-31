import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Stellar BEFORE importing App
vi.mock("../stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  RPC_URL: "https://soroban-testnet.stellar.org",
  CONTRACT_ID: "",
  TOKEN_CONTRACT_ID: "",
  server: { sendTransaction: vi.fn() },
  getContractAdmin: vi.fn().mockResolvedValue(null),
}));

// Mock WalletBar so it does not pull in heavy deps
vi.mock("../components/WalletBar", () => ({
  default: ({ publicKey, onDisconnect }: { publicKey: string; onDisconnect: () => void }) => (
    <div data-testid="wallet-bar">
      <span>{publicKey}</span>
      <button onClick={onDisconnect}>Disconnect</button>
    </div>
  ),
}));

// Mock child components that make network calls
vi.mock("../components/Dashboard", () => ({
  default: () => <div data-testid="dashboard" />,
}));
vi.mock("../components/SubscribeForm", () => ({
  default: () => <div data-testid="subscribe-form" />,
}));
vi.mock("../components/MerchantDashboard", () => ({
  default: () => <div data-testid="merchant-dashboard" />,
}));
vi.mock("../pages/AdminDashboard", () => ({
  default: () => <div data-testid="admin-dashboard" />,
}));

// Mock useAdmin so we can control admin state
vi.mock("../hooks/useAdmin", () => ({
  useAdmin: vi.fn(() => ({
    isAdmin: false,
    adminAddress: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));

// Mock useWallet so we control wallet state in all tests
vi.mock("../hooks/useWallet", () => {
  const AVAILABLE_WALLETS = [
    {
      id: "freighter",
      name: "Freighter",
      icon: "🚢",
      isInstalled: vi.fn().mockResolvedValue(true),
      connect: vi.fn(),
      disconnect: vi.fn(),
      signTransaction: vi.fn(),
    },
    {
      id: "xbull",
      name: "xBull",
      icon: "🐂",
      isInstalled: vi.fn().mockResolvedValue(true),
      connect: vi.fn(),
      disconnect: vi.fn(),
      signTransaction: vi.fn(),
    },
    {
      id: "lobstr",
      name: "Lobstr",
      icon: "🦞",
      isInstalled: vi.fn().mockResolvedValue(true),
      connect: vi.fn(),
      disconnect: vi.fn(),
      signTransaction: vi.fn(),
    },
    {
      id: "hana",
      name: "Hana",
      icon: "🌸",
      isInstalled: vi.fn().mockResolvedValue(true),
      connect: vi.fn(),
      disconnect: vi.fn(),
      signTransaction: vi.fn(),
    },
  ];

  return {
    AVAILABLE_WALLETS,
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
  };
});

import App from "../App";
import { useWallet, AVAILABLE_WALLETS } from "../hooks/useWallet";
import { useAdmin } from "../hooks/useAdmin";

// ── helpers ──────────────────────────────────────────────────────────────────

function mockUseWallet(overrides: Partial<ReturnType<typeof useWallet>>) {
  (useWallet as ReturnType<typeof vi.fn>).mockReturnValue({
    publicKey: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signAndSubmit: vi.fn(),
    error: null,
    connecting: false,
    ready: true,
    activeAdapter: null,
    ...overrides,
  });
}

function mockUseAdmin(isAdmin: boolean) {
  (useAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
    isAdmin,
    adminAddress: isAdmin ? "GABCDEF1234567890" : null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  });
}

const CONNECTED_STATE = {
  publicKey: "GABCDEF1234567890",
  activeAdapter: AVAILABLE_WALLETS[0],
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("App — wallet connect UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWallet({});
    mockUseAdmin(false);
  });

  it("renders without crashing", () => {
    render(<App />);
    expect(document.body).toBeTruthy();
  });

  it("shows Connect Wallet button when disconnected", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });

  it("does NOT show Freighter-only copy when disconnected", () => {
    render(<App />);
    // The old "Connect your Freighter wallet" copy must be gone
    expect(screen.queryByText(/freighter/i)).not.toBeInTheDocument();
  });

  it("shows generic 'Connect a wallet' prompt instead of Freighter-only copy", () => {
    render(<App />);
    expect(screen.getByText(/connect a wallet to get started/i)).toBeInTheDocument();
  });

  it("opens wallet selector modal when Connect Wallet is clicked", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /connect wallet/i })).toBeInTheDocument()
    );
  });

  it("renders all four wallet adapters in the modal", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument();
      expect(screen.getByText("xBull")).toBeInTheDocument();
      expect(screen.getByText("Lobstr")).toBeInTheDocument();
      expect(screen.getByText("Hana")).toBeInTheDocument();
    });
  });

  it("calls connect with Freighter adapter when Freighter is selected in modal", async () => {
    const mockConnect = vi.fn();
    mockUseWallet({ connect: mockConnect });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() => expect(screen.getByText("Freighter")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Freighter").closest("button")!);

    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ id: "freighter" }));
  });

  it("calls connect with xBull adapter when xBull is selected in modal", async () => {
    const mockConnect = vi.fn();
    mockUseWallet({ connect: mockConnect });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() => expect(screen.getByText("xBull")).toBeInTheDocument());

    fireEvent.click(screen.getByText("xBull").closest("button")!);

    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ id: "xbull" }));
  });

  it("closes the modal when Cancel is clicked", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() => expect(screen.getByText("Freighter")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByText("Freighter")).not.toBeInTheDocument());
  });

  it("shows error message when connect fails", () => {
    mockUseWallet({ error: "Freighter wallet not found. Install it from freighter.app" });
    render(<App />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/freighter wallet not found/i);
  });

  it("shows Connecting… label and disables button while connecting", () => {
    mockUseWallet({ connecting: true });
    render(<App />);
    const btn = screen.getByRole("button", { name: /connecting/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("shows WalletBar when connected", () => {
    mockUseWallet(CONNECTED_STATE);
    render(<App />);
    expect(screen.getByTestId("wallet-bar")).toBeInTheDocument();
    expect(screen.getByText("GABCDEF1234567890")).toBeInTheDocument();
  });

  it("calls disconnect when Disconnect is clicked in WalletBar", () => {
    const mockDisconnect = vi.fn();
    mockUseWallet({ ...CONNECTED_STATE, disconnect: mockDisconnect });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it("does not render the wallet modal before Connect is clicked", () => {
    render(<App />);
    expect(screen.queryByRole("heading", { name: /connect wallet/i })).not.toBeInTheDocument();
  });
});

describe("App — tab shell navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAdmin(false);
  });

  it("shows TabBar with Dashboard, Subscribe, Merchant tabs when connected (non-admin)", () => {
    mockUseWallet(CONNECTED_STATE);
    render(<App />);
    expect(screen.getByRole("tab", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Subscribe" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Merchant" })).toBeInTheDocument();
  });

  it("does NOT show Admin tab for non-admin wallet", () => {
    mockUseWallet(CONNECTED_STATE);
    mockUseAdmin(false);
    render(<App />);
    expect(screen.queryByRole("tab", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("shows Admin tab when connected wallet is contract admin", () => {
    mockUseWallet(CONNECTED_STATE);
    mockUseAdmin(true);
    render(<App />);
    expect(screen.getByRole("tab", { name: "Admin" })).toBeInTheDocument();
  });

  it("renders Dashboard view by default when connected", () => {
    mockUseWallet(CONNECTED_STATE);
    render(<App />);
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
  });

  it("switches to Subscribe view when Subscribe tab is clicked", () => {
    mockUseWallet(CONNECTED_STATE);
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Subscribe" }));
    expect(screen.getByTestId("subscribe-form")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("switches to Merchant view when Merchant tab is clicked", () => {
    mockUseWallet(CONNECTED_STATE);
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Merchant" }));
    expect(screen.getByTestId("merchant-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("switches to Admin view when Admin tab is clicked by an admin", () => {
    mockUseWallet(CONNECTED_STATE);
    mockUseAdmin(true);
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Admin" }));
    expect(screen.getByTestId("admin-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("does not render TabBar when disconnected", () => {
    mockUseWallet({});
    render(<App />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});
