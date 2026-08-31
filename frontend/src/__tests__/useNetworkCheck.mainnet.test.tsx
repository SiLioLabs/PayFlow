import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("useNetworkCheck mainnet confirmation (testnet unaffected, mainnet requires confirm)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.resetModules();
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).freighter;
  });

  it("testnet: isMainnet false, requiresMainnetConfirm false", async () => {
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return { ...actual, NETWORK_PASSPHRASE: "Test SDF Network ; September 2015" };
    });
    // need to re-import after mock — use dynamic import inside test
    vi.resetModules();
    const { useNetworkCheck: useNetworkCheckFresh } = await import("../hooks/useNetworkCheck");
    function FreshHarness() {
      const v = useNetworkCheckFresh();
      return (
        <div>
          <span data-testid="isMainnet">{String(v.isMainnet)}</span>
          <span data-testid="requiresMainnetConfirm">{String(v.requiresMainnetConfirm)}</span>
        </div>
      );
    }
    render(<FreshHarness />);
    await waitFor(() => {
      expect(screen.getByTestId("isMainnet")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("requiresMainnetConfirm")).toHaveTextContent("false");
  });

  it("mainnet: requires confirmation initially, then confirmed after confirmMainnet (once per session)", async () => {
    vi.resetModules();
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return { ...actual, NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" };
    });
    const { useNetworkCheck: useNetworkCheckMainnet } = await import("../hooks/useNetworkCheck");
    function Harness() {
      const v = useNetworkCheckMainnet();
      return (
        <div>
          <span data-testid="isMainnet">{String(v.isMainnet)}</span>
          <span data-testid="isMainnetConfirmed">{String(v.isMainnetConfirmed)}</span>
          <span data-testid="requiresMainnetConfirm">{String(v.requiresMainnetConfirm)}</span>
          <button onClick={v.confirmMainnet} data-testid="confirm-btn">
            confirm
          </button>
        </div>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("isMainnet")).toHaveTextContent("true"));
    expect(screen.getByTestId("isMainnetConfirmed")).toHaveTextContent("false");
    expect(screen.getByTestId("requiresMainnetConfirm")).toHaveTextContent("true");

    await userEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => expect(screen.getByTestId("isMainnetConfirmed")).toHaveTextContent("true"));
    expect(screen.getByTestId("requiresMainnetConfirm")).toHaveTextContent("false");
    expect(sessionStorage.getItem("flowpay_mainnet_confirmed")).toBe("true");

    // Remount should stay confirmed (session persistence)
    const { useNetworkCheck: secondImport } = await import("../hooks/useNetworkCheck");
    function SecondHarness() {
      const v = secondImport();
      return <span data-testid="second-requires">{String(v.requiresMainnetConfirm)}</span>;
    }
    render(<SecondHarness />);
    await waitFor(() => expect(screen.getByTestId("second-requires")).toHaveTextContent("false"));
  });

  it("badge visible via App shell: App renders network badge always", async () => {
    // Mock wallet/state so App renders header
    vi.doMock("../hooks/useWallet", () => ({
      useWallet: () => ({
        publicKey: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        signAndSubmit: vi.fn(),
        error: null,
        connecting: false,
        activeAdapter: null,
      }),
      AVAILABLE_WALLETS: [],
    }));
    vi.doMock("../hooks/useNetworkCheck", async () => {
      const actual = (await vi.importActual("../hooks/useNetworkCheck")) as Record<string, unknown>;
      return actual;
    });
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return { ...actual, NETWORK_PASSPHRASE: "Test SDF Network ; September 2015" };
    });
    vi.resetModules();
    const { default: App } = await import("../App");
    render(<App />);
    expect(screen.getByTestId("network-badge")).toBeInTheDocument();
  });
});
