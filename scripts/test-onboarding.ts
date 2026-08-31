#!/usr/bin/env tsx
import { nativeToScVal, Keypair, StrKey, Account } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { onboardMerchant } from "./onboard-merchant.js";
import { SorobanConfig } from "./soroban-admin.js";

const adminKp = Keypair.random();
const merchantKp = Keypair.random();
const mockContractId = StrKey.encodeContract(Buffer.alloc(32));

const mockConfig: SorobanConfig = {
  contractId: mockContractId,
  rpcUrl: "http://localhost:8000",
  networkPassphrase: "Test SDF Network ; September 2015",
  adminSecretKey: adminKp.secret(),
};

function createMockServer(options: {
  isFrozen: boolean;
  initialWhitelisted: boolean;
}) {
  let whitelisted = options.initialWhitelisted;
  let txSubmitted = false;

  const server = {
    simulateTransaction: async (tx: any) => {
      const xdrStr = tx.toEnvelope().toXDR().toString("utf-8");
      if (xdrStr.includes("is_merchant_frozen")) {
        return { result: { retval: nativeToScVal(options.isFrozen, { type: "bool" }) } };
      } else if (xdrStr.includes("is_merchant_whitelisted")) {
        return { result: { retval: nativeToScVal(whitelisted, { type: "bool" }) } };
      }
      return { result: { retval: nativeToScVal(false, { type: "bool" }) } };
    },
    getAccount: async (publicKey: string) => {
      return new Account(publicKey, "1");
    },
    prepareTransaction: async (tx: any) => tx,
    sendTransaction: async (tx: any) => {
      txSubmitted = true;
      whitelisted = true; // simulate successful whitelist add
      return { hash: "mock-tx-hash" };
    },
    getTransaction: async (hash: string) => ({ status: "SUCCESS" }),
    wasTxSubmitted: () => txSubmitted,
  } as any;

  return server;
}

async function runTests() {
  const merchantAddress = merchantKp.publicKey();

  console.log("Testing successful merchant onboarding (first time)...");
  const server1 = createMockServer({ isFrozen: false, initialWhitelisted: false });
  const outcome1 = await onboardMerchant(mockConfig, server1, merchantAddress);
  if (outcome1.status !== "onboarded") throw new Error(`Expected status to be onboarded, got ${outcome1.status}`);
  if (!server1.wasTxSubmitted()) throw new Error("Expected whitelist transaction to be submitted");

  console.log("Testing idempotent onboarding (already whitelisted)...");
  const server2 = createMockServer({ isFrozen: false, initialWhitelisted: true });
  const outcome2 = await onboardMerchant(mockConfig, server2, merchantAddress);
  if (outcome2.status !== "already_whitelisted") throw new Error(`Expected status to be already_whitelisted, got ${outcome2.status}`);
  if (server2.wasTxSubmitted()) throw new Error("Expected no transaction to be submitted for already whitelisted merchant");

  console.log("Testing onboarding blocked when merchant is frozen...");
  const server3 = createMockServer({ isFrozen: true, initialWhitelisted: false });
  const outcome3 = await onboardMerchant(mockConfig, server3, merchantAddress);
  if (outcome3.status !== "frozen") throw new Error(`Expected status to be frozen, got ${outcome3.status}`);
  if (server3.wasTxSubmitted()) throw new Error("Expected no transaction to be submitted for frozen merchant");

  console.log("All merchant onboarding idempotency tests passed!");
  process.exit(0);
}

runTests().catch(console.error);
