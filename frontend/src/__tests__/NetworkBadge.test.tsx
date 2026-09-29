import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

describe("NetworkBadge", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("renders Testnet badge by default", async () => {
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return { ...actual, NETWORK_PASSPHRASE: "Test SDF Network ; September 2015" };
    });
    const { default: NetworkBadge } = await import("../components/NetworkBadge");
    render(<NetworkBadge />);
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveTextContent("Testnet");
    expect(badge).toHaveClass("badge-testnet");
    expect(badge).toHaveAttribute("aria-label", "Network: Testnet");
  });

  it("renders Mainnet badge with mainnet styling", async () => {
    vi.resetModules();
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return { ...actual, NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" };
    });
    // Also need to mock utils/network isMainnetPassphrase to align, but badge uses isMainnetPassphrase on NETWORK_PASSPHRASE directly
    const { default: NetworkBadge2 } = await import("../components/NetworkBadge");
    render(<NetworkBadge2 />);
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveTextContent("Mainnet");
    expect(badge).toHaveClass("badge-mainnet");
    expect(badge).toHaveAttribute("aria-label", "Network: Mainnet");
  });
});
