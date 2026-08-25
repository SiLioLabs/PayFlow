import { loadConfig, ConfigValidationError } from "./config.js";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const outDir = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "./snapshots";

try {
  const config = loadConfig({ strict, scriptName: "snapshot" });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `payflow-snapshot-${config.STELLAR_NETWORK}-${ts}.json`;
  const filePath = path.resolve(outDir, fileName);
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    generated_at: ts,
    network: config.STELLAR_NETWORK,
    contract_id: config.CONTRACT_ID,
    rpc_url: config.RPC_URL,
    subs_snapshot: [],
    merchant_revenue: [],
    charge_history: [],
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  console.log(`[snapshot] wrote ${filePath} (${JSON.stringify(payload).length} bytes)`);
  process.exit(0);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
