import type { Page } from "@playwright/test";

export const TEST_USER_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
export const TEST_MERCHANT_KEY = "GCXO7NWYDZJGGZZIZK3VJLMY276XKV5ZOONULFCRUBCCOCVX5F5M36CR";

/**
 * Injects a mock window.freighter wallet adapter into the browser page.
 */
export async function injectFakeWallet(page: Page, userKey = TEST_USER_KEY) {
  await page.addInitScript(({ key }) => {
    (window as any).freighter = {
      isConnected: async () => true,
      isAllowed: async () => true,
      getUserInfo: async () => ({ publicKey: key }),
      getPublicKey: async () => key,
      getNetwork: async () => ({
        network: "testnet",
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
      signTransaction: async (xdr: string) => xdr,
      signAuthEntry: async (entry: string) => entry,
    };
  }, { key: userKey });
}
