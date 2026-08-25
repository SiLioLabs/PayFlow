import { loadConfig, ConfigValidationError } from "./config.js";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const command = args.find((a) => !a.startsWith("--")) ?? "info";

try {
  const config = loadConfig({ strict, scriptName: "deploy-helper" });
  switch (command) {
    case "info":
      console.log(`[deploy-helper] network=${config.STELLAR_NETWORK}`);
      console.log(`[deploy-helper] rpc=${config.RPC_URL}`);
      console.log(`[deploy-helper] contract_id=${config.CONTRACT_ID}`);
      break;
    case "env-template":
      console.log("# PayFlow required env");
      console.log("STELLAR_NETWORK=testnet");
      console.log("RPC_URL=https://soroban-testnet.stellar.org:443");
      console.log("CONTRACT_ID=G...");
      break;
    case "check":
      console.log("[deploy-helper] config parsed OK; network reachability not verified here");
      break;
    default:
      console.error(`[deploy-helper] unknown command: ${command}`);
      console.error("usage: deploy-helper [info|env-template|check] [--strict]");
      process.exit(2);
  }
  process.exit(0);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
