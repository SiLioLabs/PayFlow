import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlbedoAdapter } from "../services/wallets/AlbedoAdapter";
import { RabetAdapter } from "../services/wallets/RabetAdapter";
import { WalletConnectAdapter } from "../services/wallets/WalletConnectAdapter";

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";
const KEY = "GTESTPUBLICKEY";
const XDR = "AAAAAgAAAAB0ZXN0";

describe("new wallet adapters", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "albedo");
    Reflect.deleteProperty(window, "rabet");
    Reflect.deleteProperty(window, "walletConnect");
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "albedo");
    Reflect.deleteProperty(window, "rabet");
    Reflect.deleteProperty(window, "walletConnect");
    vi.restoreAllMocks();
  });

  describe("AlbedoAdapter", () => {
    const adapter = new AlbedoAdapter();

    it("advertises install guidance", () => {
      expect(adapter.id).toBe("albedo");
      expect(adapter.name).toBe("Albedo");
      expect(adapter.installUrl).toBe("https://albedo.link");
      expect(adapter.installHint).toMatch(/install/i);
    });

    it("reports not installed and throws guidance when the provider is missing", async () => {
      await expect(adapter.isInstalled()).resolves.toBe(false);
      await expect(adapter.connect()).rejects.toThrow(/albedo\.link/i);
      await expect(adapter.signTransaction(XDR, TESTNET)).rejects.toThrow(/not available/i);
    });

    it("connects and signs through the injected provider", async () => {
      const getPublicKey = vi.fn().mockResolvedValue(KEY);
      const signTransaction = vi.fn().mockResolvedValue("signed-albedo");
      window.albedo = { getPublicKey, signTransaction };

      await expect(adapter.isInstalled()).resolves.toBe(true);
      await expect(adapter.connect()).resolves.toBe(KEY);
      await expect(adapter.signTransaction(XDR, TESTNET)).resolves.toBe("signed-albedo");
      expect(signTransaction).toHaveBeenCalledWith({ xdr: XDR, networkPassphrase: TESTNET });
    });

    it("uses the default passphrase when none is supplied", async () => {
      const signTransaction = vi.fn().mockResolvedValue("signed");
      window.albedo = { getPublicKey: vi.fn(), signTransaction };

      await adapter.signTransaction(XDR);
      expect(signTransaction).toHaveBeenCalledWith({ xdr: XDR, networkPassphrase: TESTNET });
    });
  });

  describe("RabetAdapter", () => {
    const adapter = new RabetAdapter();

    it("advertises install guidance", () => {
      expect(adapter.id).toBe("rabet");
      expect(adapter.name).toBe("Rabet");
      expect(adapter.installUrl).toBe("https://rabet.io");
      expect(adapter.installHint).toMatch(/install/i);
    });

    it("reports not installed and throws guidance when the provider is missing", async () => {
      await expect(adapter.isInstalled()).resolves.toBe(false);
      await expect(adapter.connect()).rejects.toThrow(/rabet\.io/i);
      await expect(adapter.signTransaction(XDR, TESTNET)).rejects.toThrow(/not available/i);
    });

    it("connects and signs through the injected provider", async () => {
      const connect = vi.fn().mockResolvedValue(undefined);
      const getPublicKey = vi.fn().mockResolvedValue(KEY);
      const signTransaction = vi.fn().mockResolvedValue("signed-rabet");
      window.rabet = { connect, getPublicKey, signTransaction };

      await expect(adapter.isInstalled()).resolves.toBe(true);
      await expect(adapter.connect()).resolves.toBe(KEY);
      expect(connect).toHaveBeenCalledOnce();

      await expect(adapter.signTransaction(XDR, TESTNET)).resolves.toBe("signed-rabet");
      expect(signTransaction).toHaveBeenCalledWith({ xdr: XDR, network: "testnet" });

      await adapter.signTransaction(XDR, PUBLIC);
      expect(signTransaction).toHaveBeenLastCalledWith({ xdr: XDR, network: "public" });
    });
  });

  describe("WalletConnectAdapter", () => {
    const adapter = new WalletConnectAdapter();

    it("advertises install guidance", () => {
      expect(adapter.id).toBe("walletconnect");
      expect(adapter.name).toBe("WalletConnect");
      expect(adapter.installUrl).toBe("https://walletconnect.com");
      expect(adapter.installHint).toMatch(/mobile/i);
    });

    it("reports not installed and throws guidance when the bridge is missing", async () => {
      await expect(adapter.isInstalled()).resolves.toBe(false);
      await expect(adapter.connect()).rejects.toThrow(/walletconnect-enabled/i);
      await expect(adapter.signTransaction(XDR, TESTNET)).rejects.toThrow(/not available/i);
    });

    it("connects, signs and disconnects through the injected bridge", async () => {
      const connect = vi.fn().mockResolvedValue(KEY);
      const disconnect = vi.fn().mockResolvedValue(undefined);
      const sign = vi.fn().mockResolvedValue("signed-wc");
      window.walletConnect = { connect, disconnect, signTransaction: sign };

      await expect(adapter.isInstalled()).resolves.toBe(true);
      await expect(adapter.connect()).resolves.toBe(KEY);
      await expect(adapter.signTransaction(XDR, TESTNET)).resolves.toBe("signed-wc");
      expect(sign).toHaveBeenCalledWith(XDR, TESTNET);

      await adapter.disconnect();
      expect(disconnect).toHaveBeenCalledOnce();
    });

    it("disconnect is a no-op when the bridge is absent", async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });
});
