import { loadConfig, ConfigValidationError, AppConfigSchema } from "./config.js";

function printHelp(): void {
  console.log(`PayFlow Configuration Validator

Usage:
  validate-config [--strict] [--require-keeper] [--require-indexer] [--require-alerts] [--require-health]
  validate-config --explain
  validate-config --json

Flags:
  --strict             Parse env in strict mode (reject unknown keys inside structured configs)
  --require-keeper     KEEPER block (PRIVATE_KEY, etc.) must be present
  --require-indexer    INDEXER block (DB_URL, etc.) must be present
  --require-alerts     ALERTS block (at least one channel) must be present
  --require-health     HEALTH block must be present
  --json               Emit final config as JSON (redacts secrets)
  --explain            Print human-readable explanation of required env vars

Exit codes:
  0  config valid
  1  config invalid
  2  invocation error (unknown flag)
`);
}

function parseArgs(argv: string[]): {
  strict: boolean;
  requireKeeper: boolean;
  requireIndexer: boolean;
  requireAlerts: boolean;
  requireHealth: boolean;
  json: boolean;
  explain: boolean;
  help: boolean;
} {
  const out = {
    strict: false,
    requireKeeper: false,
    requireIndexer: false,
    requireAlerts: false,
    requireHealth: false,
    json: false,
    explain: false,
    help: false,
  };
  for (const arg of argv) {
    switch (arg) {
      case "--strict":
        out.strict = true;
        break;
      case "--require-keeper":
        out.requireKeeper = true;
        break;
      case "--require-indexer":
        out.requireIndexer = true;
        break;
      case "--require-alerts":
        out.requireAlerts = true;
        break;
      case "--require-health":
        out.requireHealth = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--explain":
        out.explain = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        console.error(`Unknown flag: ${arg}`);
        process.exit(2);
    }
  }
  return out;
}

function printExplain(): void {
  console.log(`== PayFlow Config Variables ==

Core (always required):
  STELLAR_NETWORK    testnet | mainnet | futurenet | standalone
  RPC_URL            Full HTTP(S) URL to Soroban RPC endpoint
  CONTRACT_ID        PayFlow contract address (G...)

Keeper (--require-keeper):
  PRIVATE_KEY        Stellar secret key (S...) for charge signer
  MAX_BATCH_SIZE     Max users per batch_charge (default 100)
  POLL_INTERVAL_MS   Milliseconds between charge runs (default 60000)
  DRY_RUN            true/false, skip actual on-chain writes

Indexer (--require-indexer):
  DB_URL             Postgres/DB connection string
  START_LEDGER       First ledger to index from
  INDEXER_BATCH_SIZE Events per DB insert batch

Alerts (--require-alerts, at least one):
  SLACK_WEBHOOK_URL  Slack incoming webhook URL
  PAGERDUTY_ROUTING_KEY PagerDuty events API key
  ALERT_EMAIL        Email address for admin alerts
  FEE_BPS_THRESHOLD  Alert when proposed fee exceeds this many bps

Health (--require-health):
  HEALTH_PORT        HTTP port for /health endpoint
  RPC_TIMEOUT_MS     RPC call timeout
  EXPECTED_ACTIVE_SUBS_MIN  Fail health if active subs below this value
`);
}

function redactSecrets(config: ReturnType<typeof loadConfig>): object {
  const cfg = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const keeper = cfg.KEEPER as Record<string, unknown> | undefined;
  if (keeper?.PRIVATE_KEY && typeof keeper.PRIVATE_KEY === "string") {
    const s = keeper.PRIVATE_KEY;
    keeper.PRIVATE_KEY = s.slice(0, 4) + "*".repeat(Math.max(s.length - 8, 0)) + s.slice(-4);
  }
  return cfg;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (opts.explain) {
    printExplain();
    process.exit(0);
  }

  try {
    const config = loadConfig({
      strict: opts.strict,
      requireKeeper: opts.requireKeeper,
      requireIndexer: opts.requireIndexer,
      requireAlerts: opts.requireAlerts,
      requireHealth: opts.requireHealth,
      scriptName: "validate-config",
    });

    if (opts.json) {
      console.log(JSON.stringify(redactSecrets(config), null, 2));
    } else {
      const network = config.STELLAR_NETWORK;
      const cid = config.CONTRACT_ID;
      console.log(`[validate-config] OK (network=${network}, contract=${cid.slice(0, 8)}...)`);
      const extras = [];
      if (config.KEEPER) extras.push("keeper");
      if (config.INDEXER) extras.push("indexer");
      if (config.ALERTS) extras.push("alerts");
      if (config.HEALTH) extras.push("health");
      if (extras.length) console.log(`  sub-configs: ${extras.join(", ")}`);
      void AppConfigSchema;
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

main();
