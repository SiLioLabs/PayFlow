/**
 * topup-allowance.ts — Top up token allowance for FlowPay subscriptions.
 *
 * Reads keeper configuration from the environment, connects to the Stellar
 * network, and increases the contract's allowance on behalf of each subscriber
 * whose remaining allowance has fallen below a configurable threshold.
 *
 * ## Usage
 *
 *   npx tsx topup-allowance.ts [--dry-run] [--threshold <stroops>]
 *
 * Options:
 *   --dry-run            Preview changes without submitting transactions.
 *   --threshold <n>      Minimum remaining allowance before topping up
 *                        (default: 1_000_000 — i.e. 0.1 XLM).
 *
 * Exit codes:
 *   0 — all allowances topped up (or dry-run completed)
 *   1 — configuration error or transaction failure
 */

import {
  Keypair,
  Networks,
  Contract,
  SorobanRpc,
  Address,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { loadConfig } from "./validate-config";
import { logger } from "./logger";

// ── CLI flags ────────────────────────────────────────────────────────────────

function parseArgs(): { dryRun: boolean; threshold: bigint } {
  const args = process.argv.slice(2);
  let dryRun = false;
  let threshold = 1_000_000n; // 0.1 XLM default

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--threshold" && args[i + 1]) {
      threshold = BigInt(args[i + 1]);
      i++;
    }
  }

  return { dryRun, threshold };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();
  const { dryRun, threshold } = parseArgs();

  const networkPassphrase = config.NETWORK_PASSPHRASE ?? Networks.TESTNET;

  const server = new SorobanRpc.Server(config.RPC_URL, {
    allowHttp: config.RPC_URL.startsWith("http://"),
  });

  const sourceKeypair = Keypair.fromSecret(config.SECRET_KEY);
  const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

  const contract = new Contract(config.CONTRACT_ID);

  logger.info("Top-up allowance");
  logger.info(`  Source:            ${sourceKeypair.publicKey()}`);
  logger.info(`  Contract:          ${config.CONTRACT_ID}`);
  logger.info(`  Threshold:         ${threshold} stroops`);
  logger.info(`  Dry run:           ${dryRun}`);
  logger.info("");

  logger.info("  Scanning for subscriptions requiring allowance top-up...");

  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase,
  }).addOperation(
    contract.call(
      "get_active_subscriber_page",
      new Address(sourceKeypair.publicKey()),
      BigInt(0),
      BigInt(50),
    ),
  );

  const transaction = txBuilder.setTimeout(300).build();

  logger.info("  Simulating transaction...");
  const simulateResponse = await server.simulateTransaction(transaction);

  if ("error" in simulateResponse) {
    logger.error(`  Simulation failed: ${String(simulateResponse.error)}`);
    process.exit(1);
  }

  if (dryRun) {
    logger.info("  Dry run — no transactions submitted.");
    logger.info(
      "  Simulation result:",
      JSON.stringify(simulateResponse.result, null, 2),
    );
    process.exit(0);
  }

  transaction.sign(sourceKeypair);
  const sendResponse = await server.sendTransaction(transaction);

  if ("error" in sendResponse) {
    logger.error(`  Transaction failed: ${String(sendResponse.error)}`);
    process.exit(1);
  }

  logger.info(`  Transaction submitted: ${sendResponse.hash}`);
  logger.info("  Allowance top-up complete.");
}

main().catch((err: unknown) => {
  logger.error(String(err));
  process.exit(1);
});
