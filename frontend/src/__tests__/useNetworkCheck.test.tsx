import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { useNetworkCheck } from "../hooks/useNetworkCheck";
import { NETWORK_PASSPHRASE } from "../stellar";

function Test() {
  const { networkMatch, walletNetwork } = useNetworkCheck();

  return (
    <div>
      <span data-testid="network-match">{String(networkMatch)}</span>
      <span data-testid="wallet-network">{walletNetwork}</span>
    </div>
  );
}

function mockFreighterNetwork(networkPassphrase: string) {
  window.freighter = {
    isConnected: vi.fn().mockResolvedValue(true),
    getPublicKey: vi.fn().mockResolvedValue("GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"),
    getNetwork: vi.fn().mockResolvedValue({
      network: "TESTNET",
      networkPassphrase,
    }),
    signTransaction: vi.fn().mockResolvedValue("mock-xdr"),
  } as unknown as typeof window.freighter;
}

describe("useNetworkCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.freighter;
  });

  it("matching network -> networkMatch = true", async () => {
    mockFreighterNetwork(NETWORK_PASSPHRASE);

    render(<Test />);

    await waitFor(() => {
      expect(screen.getByTestId("network-match")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("wallet-network")).toHaveTextContent("TESTNET");
  });

  it("mismatched network -> networkMatch = false", async () => {
    mockFreighterNetwork("Public Global Stellar Network ; September 2015");

    render(<Test />);

    await waitFor(() => {
      expect(screen.getByTestId("network-match")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("wallet-network")).toHaveTextContent("TESTNET");
  });
});
