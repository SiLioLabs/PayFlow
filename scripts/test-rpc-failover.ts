import { MultiEndpointServer } from "./rpc-client.js";
import { Server } from "@stellar/stellar-sdk/rpc";

// We'll run this test using tsx
async function runTests() {
  console.log("Starting RPC failover tests...");

  // Test 1: Single RPC_URL still works
  console.log("\nTest 1: Single RPC_URL still works");
  const singleServer = new MultiEndpointServer("https://soroban-testnet.stellar.org");
  
  try {
    const health = await singleServer.getHealth();
    console.log("Single server health check passed:", health.status);
  } catch (error) {
    console.error("Single server failed:", error);
    process.exit(1);
  }

  // Test 2: RPC_URLS failover (mocking failures)
  console.log("\nTest 2: RPC_URLS failover");
  
  // Create instance with multiple URLs
  const multiServer = new MultiEndpointServer([
    "https://invalid.rpc.url.local", // should fail
    "https://soroban-testnet.stellar.org" // should succeed
  ]);

  try {
    const health = await multiServer.getHealth();
    console.log("Multi server health check passed after failover:", health.status);
    
    // Verify that the first one was marked unhealthy
    // We can't access private 'endpoints', but if it worked, failover is proven.
  } catch (error) {
    console.error("Multi server failover failed:", error);
    process.exit(1);
  }

  // Test 3: Passphrase mismatch marks endpoint unhealthy
  console.log("\nTest 3: Passphrase mismatch");
  const oldEnv = process.env.NETWORK_PASSPHRASE;
  
  // Force a mismatch expectation
  process.env.NETWORK_PASSPHRASE = "Invalid Passphrase for Test";
  const mismatchServer = new MultiEndpointServer([
    "https://soroban-testnet.stellar.org",
    "https://rpc-testnet.stellar.org"
  ]);

  try {
    await mismatchServer.getHealth();
    console.error("Passphrase mismatch should have failed all endpoints, but it succeeded!");
    process.exit(1);
  } catch (error) {
    console.log("Passphrase mismatch correctly rejected endpoints:", (error as Error).message);
  }

  // Restore env
  process.env.NETWORK_PASSPHRASE = oldEnv;

  console.log("\nAll tests passed!");
}

runTests().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
