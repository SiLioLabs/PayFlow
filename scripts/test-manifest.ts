#!/usr/bin/env tsx
import { ManifestSchema } from "./config.js";

function assertThrows(fn: () => void, messageIncludes: string) {
  try {
    fn();
    throw new Error("Expected function to throw, but it succeeded");
  } catch (err) {
    if (err instanceof Error && !err.message.includes(messageIncludes)) {
      throw new Error(`Expected error message to include '${messageIncludes}', but got '${err.message}'`);
    }
  }
}

function runTests() {
  console.log("Testing valid manifest...");
  const validManifest = {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    adminAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    network: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015"
  };
  ManifestSchema.parse(validManifest);

  console.log("Testing missing fields...");
  assertThrows(() => {
    ManifestSchema.parse({ ...validManifest, contractId: undefined });
  }, "contractId is required in manifest");

  console.log("Testing invalid url...");
  assertThrows(() => {
    ManifestSchema.parse({ ...validManifest, rpcUrl: "not-a-url" });
  }, "rpcUrl must be a valid URL");

  console.log("All manifest tests passed!");
}

runTests();
