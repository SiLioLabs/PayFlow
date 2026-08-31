import { parseArgs } from "node:util";
import { logger } from "./logger";
import {
  loadSorobanConfig,
  createServer,
  readContractValue,
  invokeContract,
  addressToScVal,
  nativeToScVal,
  simulateRead,
} from "./soroban-admin";

export interface RotateContext {
  readContractValue: typeof readContractValue;
  simulateRead: typeof simulateRead;
  invokeContract: typeof invokeContract;
  loadSorobanConfig: typeof loadSorobanConfig;
  createServer: typeof createServer;
}

export const defaultContext: RotateContext = {
  readContractValue,
  simulateRead,
  invokeContract,
  loadSorobanConfig,
  createServer,
};

export async function rotateFeeCollector(argv: string[], ctx: RotateContext = defaultContext) {
  const { values } = parseArgs({
    args: argv,
    options: {
      propose: { type: "string" },
      commit: { type: "boolean" },
      bps: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const config = ctx.loadSorobanConfig();
  const server = ctx.createServer(config);

  const isPropose = !!values.propose;
  const isCommit = !!values.commit;
  const dryRun = !!values["dry-run"];

  if (isPropose && isCommit) {
    logger.error("Error: Cannot specify both --propose and --commit");
    process.exitCode = 1;
    throw new Error("Cannot specify both --propose and --commit");
  }

  if (!isPropose && !isCommit) {
    logger.error("Error: Must specify either --propose <address> or --commit");
    process.exitCode = 1;
    throw new Error("Must specify either --propose <address> or --commit");
  }

  if (isPropose) {
    const newCollector = values.propose as string;
    
    // Read bounds
    const bounds = await ctx.readContractValue<[number, number]>(config, server, "get_fee_bounds", []);
    const minBps = bounds ? bounds[0] : 0;
    const maxBps = bounds ? bounds[1] : 10000;

    let bps: number;
    if (values.bps) {
      bps = parseInt(values.bps, 10);
    } else {
      bps = await ctx.readContractValue<number>(config, server, "get_fee_bps", []) ?? 0;
    }

    if (bps < minBps || bps > maxBps) {
      logger.error(`Error: Proposed BPS ${bps} is outside bounds [${minBps}, ${maxBps}]`);
      process.exitCode = 1;
      throw new Error(`Proposed BPS ${bps} is outside bounds [${minBps}, ${maxBps}]`);
    }

    logger.info(`Proposing fee collector: ${newCollector} with ${bps} BPS`);

    if (dryRun) {
      logger.info("[Dry Run] Simulating propose_fee...");
      await ctx.simulateRead(config, server, "propose_fee", [
        addressToScVal(newCollector),
        nativeToScVal(bps, { type: "u32" }),
      ]);
      logger.info("[Dry Run] propose_fee simulation successful. tx intended.");
    } else {
      logger.info("Invoking propose_fee on-chain...");
      const tx = await ctx.invokeContract(config, server, "propose_fee", [
        addressToScVal(newCollector),
        nativeToScVal(bps, { type: "u32" }),
      ]);
      logger.info(`✅ Success: Fee proposed in tx ${tx.hash}`);
    }
  }

  // Acceptance Criteria: Calls set_fee preserving existing fee_bps
  logger.info("\nInitiating rotation...");
  await set_fee(newCollector, currentFee.fee_bps);
  logger.info("Transaction successfully confirmed on-chain.");

  // Acceptance Criteria: Verifies change by reading get_fee after update
  logger.info("\n=== Verifying On-Chain Update ===");
  const updatedFee = await get_fee();

  if (updatedFee.collector === newCollector) {
    console.log("✅ Success: Fee collector rotated correctly!");
    console.log(
    logger.info("✅ Success: Fee collector rotated correctly!");
    logger.info(`New Verification -> Collector: ${updatedFee.collector}, BPS: ${updatedFee.fee_bps}`);
  } else {
    logger.error("❌ Error: Verification failed. Collector address does not match expected update.");
    process.exit(1);
  if (isCommit) {
    logger.info("Committing pending fee proposal...");

    // Verify pending before commit
    try {
      await ctx.simulateRead(config, server, "commit_fee", []);
    } catch (e: any) {
      if (e.message && e.message.includes("NoPendingProposal")) {
        logger.error("❌ Error: Missing pending fee proposal (NoPendingProposal).");
        process.exitCode = 1;
        throw new Error("Missing pending fee proposal (NoPendingProposal).");
      }
      if (e.message && e.message.includes("FeeOutOfBoundsAtCommit")) {
        logger.error("❌ Error: Pending proposal is out of bounds.");
        process.exitCode = 1;
        throw new Error("Pending proposal is out of bounds.");
      }
      logger.error(`❌ Error verifying pending commit: ${e.message}`);
      process.exitCode = 1;
      throw e;
    }

    try {
      const response = await server.getEvents({
        startLedger: 0,
        filters: [{
          type: "contract",
          contractIds: [config.contractId],
          topics: [
            [nativeToScVal("fee", { type: "symbol" }).toXDR("base64")],
            [nativeToScVal("proposed", { type: "symbol" }).toXDR("base64")]
          ]
        }],
        limit: 10
      });
      if (response && response.records && response.records.length > 0) {
        const latestEvent = response.records[response.records.length - 1];
        logger.info(`Found fee_proposed event in ledger ${latestEvent.ledger}`);
      }
    } catch (e) {
      logger.info("Could not fetch events to verify value, but simulation passed.");
    }

    if (dryRun) {
      logger.info("[Dry Run] commit_fee simulation successful. tx intended.");
    } else {
      logger.info("Invoking commit_fee on-chain...");
      const tx = await ctx.invokeContract(config, server, "commit_fee", []);
      logger.info(`✅ Success: Fee committed in tx ${tx.hash}`);
    }
  }
}

import { fileURLToPath } from "node:url";

const isMain = process.argv[1] && import.meta.url.startsWith("file:") && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  rotateFeeCollector(process.argv.slice(2)).catch((err) => {
    logger.error("Fatal execution error:", err);
    process.exit(1);
  });
}
