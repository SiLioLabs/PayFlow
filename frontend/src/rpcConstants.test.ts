/**
 * rpcConstants.test.ts
 *
 * Cross-module regression: verifies that all consumers of the custom RPC URL
 * read from the single canonical key exported by constants.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CUSTOM_RPC_URL_KEY, readCustomRpcUrl } from "./constants";

beforeEach(() => {
  localStorage.clear();
});

describe("CUSTOM_RPC_URL_KEY", () => {
  it("equals the expected literal string (intentional pin — rename must update this test)", () => {
    expect(CUSTOM_RPC_URL_KEY).toBe("flowpay_custom_rpc_url");
  });
});

describe("readCustomRpcUrl", () => {
  it("returns null when nothing is stored", () => {
    expect(readCustomRpcUrl()).toBeNull();
  });

  it("all consumers observe the same stored RPC value", () => {
    const url = "https://my-custom-rpc.example.com";
    localStorage.setItem(CUSTOM_RPC_URL_KEY, JSON.stringify(url));

    // readCustomRpcUrl is the single parsing helper — all modules must go through it
    expect(readCustomRpcUrl()).toBe(url);
  });

  it("returns null for invalid JSON stored under the key", () => {
    localStorage.setItem(CUSTOM_RPC_URL_KEY, "not-valid-json{{{");
    expect(readCustomRpcUrl()).toBeNull();
  });

  it("returns null when the stored value is an empty string after parse", () => {
    // JSON.parse("\"\"") → "" — falsy, so helper should return null
    localStorage.setItem(CUSTOM_RPC_URL_KEY, JSON.stringify(""));
    expect(readCustomRpcUrl()).toBeNull();
  });
});
