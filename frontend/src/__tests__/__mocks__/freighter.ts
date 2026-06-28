import { vi } from "vitest";

export const mockFreighter = {
  isConnected: vi.fn().mockResolvedValue(true),
  getPublicKey: vi.fn().mockResolvedValue("GA_MOCK_USER_PUBLIC_KEY"),
  getNetwork: vi.fn().mockResolvedValue({
    network: "TESTNET",
    networkPassphrase: "Test SDF Network ; September 2015"
  }),
  // "Valid-looking XDR stub" as per acceptance criteria
  signTransaction: vi.fn().mockResolvedValue("AAAAAgAAAABmock-signed-xdr-AAAAA="),
};
