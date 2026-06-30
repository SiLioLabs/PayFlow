import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { useFreighterAvailable } from "../hooks/useFreighterAvailable";

function Test() {
  const avail = useFreighterAvailable();
  return (
    <div>
      <span>available:{String(avail.available)}</span>
      <span>install:{avail.installUrl}</span>
    </div>
  );
}

describe("useFreighterAvailable", () => {
  afterEach(() => {
    // clean up any global we set
    try {
      delete (global as any).window.freighter;
    } catch {}
  });

  it("reports available when window.freighter exists", async () => {
    (global as any).window = global.window || {};
    (window as any).freighter = {
      isConnected: async () => true,
      getPublicKey: async () => "GABC",
      getNetwork: async () => ({ network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" }),
      signTransaction: async (xdr: string) => xdr,
    };

    render(<Test />);

    await waitFor(() => expect(screen.getByText(/available:true/)).toBeTruthy());
    expect(screen.getByText(/install:/)).toBeTruthy();
  });

  it("reports not available when window.freighter is missing", async () => {
    (global as any).window = global.window || {};
    delete (global as any).window.freighter;

    render(<Test />);

    await waitFor(() => expect(screen.getByText(/available:false/)).toBeTruthy());
    expect(screen.getByText(/install:https:\/\/freighter.app/)).toBeTruthy();
  });
});
