import { loadConfig, ConfigValidationError } from "./config.js";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const json = args.includes("--json");

try {
  const config = loadConfig({ strict, scriptName: "stats" });

  if (json) {
    console.log(
      JSON.stringify(
        {
          network: config.STELLAR_NETWORK,
          contract: config.CONTRACT_ID,
          rpc: config.RPC_URL,
          keeper_enabled: !!config.KEEPER,
          indexer_enabled: !!config.INDEXER,
          alerts_enabled: !!config.ALERTS,
          health_enabled: !!config.HEALTH,
          generated_at: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } else {
    console.log(`[stats] network=${config.STELLAR_NETWORK}`);
    console.log(`[stats] contract_id=${config.CONTRACT_ID}`);
    console.log(`[stats] rpc=${config.RPC_URL}`);
    console.log(`[stats] components:`);
    console.log(`  - keeper:  ${config.KEEPER ? "enabled" : "disabled"}`);
    console.log(`  - indexer: ${config.INDEXER ? "enabled" : "disabled"}`);
    console.log(`  - alerts:  ${config.ALERTS ? "enabled" : "disabled"}`);
    console.log(`  - health:  ${config.HEALTH ? "enabled" : "disabled"}`);
  }
  process.exit(0);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
