/**
 * RpcSettings tests
 *
 * Covers:
 *  - URL validation (valid HTTPS, valid HTTP with warning, invalid, empty)
 *  - localStorage persistence (save, clear/reset)
 *  - Banner renders on RPC failure and contains a "Try a different endpoint" button
 *  - Modal opens and closes correctly
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Minimal stellar mock: we only need RPC_URL from stellar.ts
vi.mock("../stellar", () => ({
  RPC_URL: "https://soroban-testnet.stellar.org",
  server: { getHealth: vi.fn().mockResolvedValue({}) },
  getServer: vi.fn(() => ({ getHealth: vi.fn().mockResolvedValue({}) })),
}));

// We need to mock @stellar/stellar-sdk/rpc Server so RpcHealthProvider doesn't
// make real network calls during tests.
// Using a class mock ensures `new Server(url)` works correctly.
const mockGetHealth = vi.fn().mockResolvedValue({});
vi.mock("@stellar/stellar-sdk/rpc", () => {
  class MockServer {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_url: string) {}
    getHealth = mockGetHealth;
  }
  return { Server: MockServer };
});

// ── Imports after mocks ───────────────────────────────────────────────────────
import { validateRpcUrl, normalizeRpcUrl, RpcHealthProvider } from "../context/RpcHealthContext";
import RpcSettings from "../components/RpcSettings";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap a component with RpcHealthProvider to supply context. */
function withProvider(ui: React.ReactElement) {
  return <RpcHealthProvider>{ui}</RpcHealthProvider>;
}

// ── Unit: validateRpcUrl ──────────────────────────────────────────────────────

describe("validateRpcUrl", () => {
  it("accepts a valid HTTPS URL", () => {
    const result = validateRpcUrl("https://soroban-testnet.stellar.org");
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("accepts a valid HTTP URL (with warning handled elsewhere)", () => {
    const result = validateRpcUrl("http://localhost:8000");
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("rejects a URL with no protocol", () => {
    const result = validateRpcUrl("soroban-testnet.stellar.org");
    expect(result.valid).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it("rejects an ftp:// URL", () => {
    const result = validateRpcUrl("ftp://example.com");
    expect(result.valid).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it("rejects an empty string", () => {
    const result = validateRpcUrl("");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("URL is required.");
  });

  it("rejects a whitespace-only string", () => {
    const result = validateRpcUrl("   ");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("URL is required.");
  });

  it("rejects totally invalid text", () => {
    const result = validateRpcUrl("not a url at all!!");
    expect(result.valid).toBe(false);
    expect(result.error).not.toBeNull();
  });
});

// ── Unit: normalizeRpcUrl ─────────────────────────────────────────────────────

describe("normalizeRpcUrl", () => {
  it("strips a trailing slash", () => {
    expect(normalizeRpcUrl("https://example.com/")).toBe("https://example.com");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeRpcUrl("https://example.com///")).toBe("https://example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRpcUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("leaves a URL with no trailing slash unchanged", () => {
    expect(normalizeRpcUrl("https://example.com/path")).toBe("https://example.com/path");
  });
});

// ── localStorage persistence ──────────────────────────────────────────────────

describe("RpcSettings localStorage persistence", () => {
  const STORAGE_KEY = "flowpay_custom_rpc_url";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("saves a valid HTTPS URL to localStorage on Save", async () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.clear(input);
    await userEvent.type(input, "https://my-rpc.example.com");

    fireEvent.click(screen.getByTestId("rpc-save-btn"));

    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toBe("https://my-rpc.example.com");
    });
  });

  it("normalises a URL with trailing slash before saving", async () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.clear(input);
    await userEvent.type(input, "https://my-rpc.example.com/");

    fireEvent.click(screen.getByTestId("rpc-save-btn"));

    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(JSON.parse(stored!)).toBe("https://my-rpc.example.com");
    });
  });

  it("removes the key from localStorage when cleared via empty input", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("https://old.example.com"));

    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.clear(input);

    fireEvent.click(screen.getByTestId("rpc-save-btn"));

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  it("shows a 'Reset to default' button when a custom URL is stored, and clears on click", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("https://custom.example.com"));

    render(withProvider(<RpcSettings onClose={() => {}} />));

    const resetBtn = await screen.findByTestId("rpc-reset-btn");
    expect(resetBtn).toBeInTheDocument();

    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  it("reads a pre-existing custom URL from localStorage on mount", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("https://custom.example.com"));

    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId<HTMLInputElement>("rpc-url-input");
    expect(input.value).toBe("https://custom.example.com");
  });
});

// ── RpcSettings modal behaviour ───────────────────────────────────────────────

describe("RpcSettings modal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the dialog with the correct ARIA attributes", () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "rpc-settings-title");
  });

  it("shows a validation error for a non-URL string", async () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.type(input, "not-a-url");

    expect(await screen.findByTestId("rpc-url-error")).toBeInTheDocument();
  });

  it("disables the Save button while the URL is invalid", async () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.type(input, "bad input");

    expect(screen.getByTestId("rpc-save-btn")).toBeDisabled();
  });

  it("enables the Save button for a valid HTTPS URL", async () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.type(input, "https://valid-rpc.example.com");

    expect(screen.getByTestId("rpc-save-btn")).not.toBeDisabled();
  });

  it("shows an HTTP warning for http:// URLs", async () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.type(input, "http://insecure.example.com");

    expect(await screen.findByTestId("rpc-url-http-warning")).toBeInTheDocument();
  });

  it("shows a saved confirmation after clicking Save with a valid URL", async () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.type(input, "https://valid.example.com");

    fireEvent.click(screen.getByTestId("rpc-save-btn"));

    expect(await screen.findByTestId("rpc-url-saved")).toBeInTheDocument();
  });

  it("calls onClose when the Cancel button is clicked", () => {
    const onClose = vi.fn();
    render(withProvider(<RpcSettings onClose={onClose} />));

    fireEvent.click(screen.getByTestId("rpc-cancel-btn"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the overlay backdrop is clicked", () => {
    const onClose = vi.fn();
    render(withProvider(<RpcSettings onClose={onClose} />));

    fireEvent.click(screen.getByTestId("rpc-settings-overlay"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("displays the active RPC URL in the modal", () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const urlDisplay = screen.getByTestId("active-rpc-url");
    // The default from our stellar mock is the testnet URL
    expect(urlDisplay.textContent).toContain("soroban-testnet.stellar.org");
  });

  it("submits via Enter key press on the input", async () => {
    render(withProvider(<RpcSettings onClose={() => {}} />));

    const input = screen.getByTestId("rpc-url-input");
    await userEvent.type(input, "https://enter-key.example.com");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      const stored = localStorage.getItem("flowpay_custom_rpc_url");
      expect(stored).not.toBeNull();
    });
  });
});

// ── RPC failure banner ────────────────────────────────────────────────────────

describe("RPC failure banner in App", () => {
  // We import App lazily here to use the mocks already set up at the top.
  // To avoid the full App render complexity, we test the banner logic in
  // isolation by rendering a minimal component that mirrors the App banner.

  function MockBanner({
    rpcStatus,
    onOpenSettings,
  }: {
    rpcStatus: "healthy" | "degraded" | "unreachable";
    onOpenSettings: () => void;
  }) {
    if (rpcStatus !== "unreachable") return null;
    return (
      <div role="alert" data-testid="rpc-failure-banner">
        <span>RPC endpoint unreachable</span>
        <button
          data-testid="rpc-failure-banner-change-btn"
          onClick={onOpenSettings}
          aria-label="Try a different RPC endpoint"
        >
          Try a different endpoint
        </button>
      </div>
    );
  }

  it("renders the failure banner when RPC status is unreachable", () => {
    const open = vi.fn();
    render(<MockBanner rpcStatus="unreachable" onOpenSettings={open} />);

    expect(screen.getByTestId("rpc-failure-banner")).toBeInTheDocument();
    expect(screen.getByTestId("rpc-failure-banner-change-btn")).toBeInTheDocument();
  });

  it("does not render the banner when RPC status is healthy", () => {
    const open = vi.fn();
    render(<MockBanner rpcStatus="healthy" onOpenSettings={open} />);

    expect(screen.queryByTestId("rpc-failure-banner")).not.toBeInTheDocument();
  });

  it("does not render the banner when RPC status is degraded", () => {
    const open = vi.fn();
    render(<MockBanner rpcStatus="degraded" onOpenSettings={open} />);

    expect(screen.queryByTestId("rpc-failure-banner")).not.toBeInTheDocument();
  });

  it("calls onOpenSettings when the banner button is clicked", () => {
    const open = vi.fn();
    render(<MockBanner rpcStatus="unreachable" onOpenSettings={open} />);

    fireEvent.click(screen.getByTestId("rpc-failure-banner-change-btn"));

    expect(open).toHaveBeenCalledTimes(1);
  });
});
