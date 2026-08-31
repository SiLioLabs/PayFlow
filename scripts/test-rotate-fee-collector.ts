#!/usr/bin/env tsx
import assert from "node:assert";
import { rotateFeeCollector, RotateContext } from "./rotate-fee-collector";

// Define a test context to inject
function createMockContext(): RotateContext {
  return {
    readContractValue: async (config, server, method, args) => {
      if (method === "get_fee_bounds") return [100, 500];
      if (method === "get_fee_bps") return 250;
      return null;
    },
    simulateRead: async () => null,
    invokeContract: async () => ({ hash: "mock-tx-hash", status: "SUCCESS" }),
    loadSorobanConfig: () => ({ contractId: "C123", adminSecretKey: "secret", rpcUrl: "mock", networkPassphrase: "mock" }),
    createServer: () => ({
      getEvents: async () => ({ records: [] })
    }) as any,
  };
}

async function runTests() {
  console.log("Running rotate-fee-collector tests...");

  // Test 1: Propose fee respects bounds
  try {
    const ctx = createMockContext();
    
    // Proposing 50 BPS should fail (below 100)
    let errorThrown = false;
    try {
      await rotateFeeCollector(["--propose", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "--bps", "50"], ctx);
    } catch (e: any) {
      errorThrown = true;
      assert(e.message.includes("outside bounds"));
    }
    assert(errorThrown, "Expected error when bps < min_bps");
    console.log("✅ Propose respects lower bounds");
  } catch(e) {
    console.error("Test 1 failed:", e);
    process.exit(1);
  }

  // Test 2: Commit fee verifies pending
  try {
    const ctx = createMockContext();
    ctx.simulateRead = async (_config: any, _server: any, method: string) => {
      if (method === "commit_fee") {
        throw new Error("Simulation failed for commit_fee: NoPendingProposal");
      }
      return null;
    };

    let errorThrown = false;
    try {
      await rotateFeeCollector(["--commit"], ctx);
    } catch (e: any) {
      errorThrown = true;
      assert(e.message.includes("NoPendingProposal"));
    }
    assert(errorThrown, "Expected error when missing pending proposal");
    console.log("✅ Commit verifies pending proposal via simulation");
  } catch(e) {
    console.error("Test 2 failed:", e);
    process.exit(1);
  }

  // Test 3: Dry run does not invoke contract
  try {
    const ctx = createMockContext();
    let invoked = false;
    ctx.invokeContract = async () => { invoked = true; return { hash: "hash", status: "SUCCESS" }; };

    await rotateFeeCollector(["--propose", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "--bps", "200", "--dry-run"], ctx);
    assert(!invoked, "Expected invokeContract NOT to be called in dry-run mode");

    await rotateFeeCollector(["--commit", "--dry-run"], ctx);
    assert(!invoked, "Expected invokeContract NOT to be called in dry-run mode");

    console.log("✅ Dry-run works correctly");
  } catch (e) {
    console.error("Test 3 failed:", e);
    process.exit(1);
  }

  console.log("All tests passed!");
}

runTests().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
