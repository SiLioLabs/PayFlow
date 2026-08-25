import { loadConfig, ConfigValidationError } from "./config.js";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const dryRun = args.includes("--dry-run");
const merchantArg = args.find((a) => a.startsWith("--merchant="))?.split("=")[1];

try {
  const config = loadConfig({ strict, scriptName: "revenue-reset" });
  console.log(
    `[revenue-reset] network=${config.STELLAR_NETWORK} contract=${config.CONTRACT_ID.slice(0, 8)}...`
  );
  if (merchantArg) {
    console.log(`[revenue-reset] target merchant=${merchantArg}`);
  } else {
    console.log("[revenue-reset] target all merchants");
  }
  if (dryRun) {
    console.log("[revenue-reset] DRY RUN: no on-chain changes");
  }
  process.exit(0);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
