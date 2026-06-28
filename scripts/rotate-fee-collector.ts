import { parseArgs } from "util";
import readline from "readline";

// Mocking contract invocation wrapper based on project standard patterns
// Replace these placeholders with your actual contract client import if available
async function get_fee(): Promise<{ collector: string; fee_bps: number }> {
  // Simulates fetching current fee config
  console.log("Fetching current fee configuration...");
  return { collector: "GDQW...OLD_ADDRESS", fee_bps: 250 }; 
}

async function set_fee(newCollector: string, feeBps: number): Promise<void> {
  // Simulates executing the contract transaction
  console.log(`Executing set_fee with Collector: ${newCollector}, BPS: ${feeBps}...`);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

async function main() {
  // 1. Parse CLI arguments using standard node utility
  const { values } = parseArgs({
    options: {
      "new-collector": { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });

  const newCollector = values["new-collector"];
  const autoConfirm = values.yes;

  // Acceptance Criteria: Requires --new-collector argument
  if (!newCollector) {
    console.error("Error: Missing required argument --new-collector");
    process.exit(1);
  }

  // Acceptance Criteria: Reads and displays current fee collector before change
  const currentFee = await get_fee();
  console.log("\n=== Current Fee Configuration ===");
  console.log(`Collector: ${currentFee.collector}`);
  console.log(`Fee BPS:  ${currentFee.fee_bps}\n`);

  console.log(`Target New Collector: ${newCollector}`);

  // Acceptance Criteria: Prompts for confirmation (unless --yes flag)
  if (!autoConfirm) {
    const answer = await question("Are you sure you want to rotate the fee collector? (y/N): ");
    rl.close();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.log("Operation aborted by user.");
      process.exit(0);
    }
  } else {
    rl.close();
    console.log("--yes flag detected. Skipping interactive confirmation.");
  }

  // Acceptance Criteria: Calls set_fee preserving existing fee_bps
  console.log("\nInitiating rotation...");
  await set_fee(newCollector, currentFee.fee_bps);
  console.log("Transaction successfully confirmed on-chain.");

  // Acceptance Criteria: Verifies change by reading get_fee after update
  console.log("\n=== Verifying On-Chain Update ===");
  const updatedFee = await get_fee();
  
  if (updatedFee.collector === newCollector) {
    console.log("✅ Success: Fee collector rotated correctly!");
    console.log(`New Verification -> Collector: ${updatedFee.collector}, BPS: ${updatedFee.fee_bps}`);
  } else {
    console.error("❌ Error: Verification failed. Collector address does not match expected update.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal execution error:", err);
  process.exit(1);
});
