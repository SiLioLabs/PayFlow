import type { Page, Route } from "@playwright/test";
import { TEST_USER_KEY, TEST_MERCHANT_KEY } from "./wallet-mock";

export interface MockSubscriptionState {
  hasSubscription: boolean;
  isPaused: boolean;
  merchant: string;
  amount: string;
  interval: number;
}

/**
 * Sets up network interceptors for Soroban RPC JSON-RPC 2.0 endpoints
 * and Horizon REST endpoints.
 */
export async function mockSorobanRpc(page: Page, state: MockSubscriptionState) {
  // Mock Horizon account balances
  await page.route("**/horizon*/**", async (route: Route) => {
    const url = route.request().url();
    if (url.includes(`/accounts/${TEST_USER_KEY}`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: TEST_USER_KEY,
          sequence: "1000",
          balances: [
            { asset_type: "native", balance: "150.0000000" },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // Mock Soroban JSON-RPC calls
  await page.route("**/soroban*/**", async (route: Route) => {
    const req = route.request();
    if (req.method() !== "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }

    let json: any = {};
    try {
      json = req.postDataJSON() || {};
    } catch {
      json = {};
    }

    const { id, method } = json;

    switch (method) {
      case "getHealth":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jsonrpc: "2.0", id, result: { status: "healthy" } }),
        });
        return;

      case "getAccount":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { id: TEST_USER_KEY, sequence: "1000" },
          }),
        });
        return;

      case "simulateTransaction":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              status: "SUCCESS",
              minResourceFee: "100",
              transactionData: "AAAAAA==",
              events: [],
            },
          }),
        });
        return;

      case "sendTransaction":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              status: "PENDING",
              hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            },
          }),
        });
        return;

      case "getTransaction":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              status: "SUCCESS",
              events: [],
            },
          }),
        });
        return;

      case "getEvents":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              events: [],
              latestLedger: 100,
            },
          }),
        });
        return;

      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jsonrpc: "2.0", id, result: {} }),
        });
    }
  });
}
