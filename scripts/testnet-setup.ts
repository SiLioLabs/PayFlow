import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { logger } from "./logger";
import { projectPath, readJsonFile } from "./soroban-admin.js";
import { ManifestSchema } from "./config.js";

// ── Configuration ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL =
  process.env.FRIENDBOT_URL || "https://friendbot.stellar.org";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ── Argument parsing ─────────────────────────────────────────────────────────

interface SetupArgs {
  seed: number;
  users: number;
  merchants: number;
}

function parseArgs(argv: string[]): SetupArgs {
  let seed = 1;
  let users = 3;
  let merchants = 1;

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--seed":
        seed = parseInt(argv[++i], 10);
        break;
      case "--users":
        users = parseInt(argv[++i], 10);
        break;
      case "--merchants":
        merchants = parseInt(argv[++i], 10);
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        console.error(
          "Usage: testnet-setup.ts --seed <n> --users <n> --merchants <n>",
        );
        process.exit(1);
    }
  }

  if (
    !Number.isInteger(seed) ||
    !Number.isInteger(users) ||
    !Number.isInteger(merchants)
  ) {
    console.error("ERROR: --seed, --users, and --merchants must be integers.");
    process.exit(1);
  }

  if (users < 1 || merchants < 1) {
    console.error("ERROR: --users and --merchants must each be at least 1.");
    process.exit(1);
  }

  return { seed, users, merchants };
}

// ── Deterministic identity derivation ────────────────────────────────────────

interface Identity {
  role: "user" | "merchant";
  index: number;
}
const RPC_URL = process.env.RPC_URL || process.env.VITE_RPC_URL || "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || "https://friendbot.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || process.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
const DEFAULT_TOKEN = process.env.VITE_DEFAULT_TOKEN || "CB64D3BV7P25CBZ76AEGY2FJD2N2Z35TXTLA2HO7DS4SYYBZWAZZTACC"; // Native XLM SAC on Testnet

const MANIFEST_PATH = join(process.cwd(), "data", "testnet-accounts.json");
const BACKUP_MANIFEST_PATH = join(process.cwd(), "data", "testnet-accounts.json.bak");

interface AccountMeta {
  role: "admin" | "merchant" | "subscriber";
  name: string;
  publicKey: string;
  secretKey: string;
  subscription?: {
    amountStroops: string;
    amountXlm: string;
    intervalSeconds: number;
  };
}

interface TestnetManifest {
  createdAt: string;
  updatedAt: string;
  network: string;
  contractId: string;
  tokenAddress: string;
  admin: AccountMeta;
  merchant: AccountMeta;
  subscribers: AccountMeta[];
}

interface SetupArgs {
  reset: boolean;
  contractId?: string;
  tokenAddress?: string;
  rpcUrl?: string;
}

function parseArgs(argv: string[]): SetupArgs {
  const args: SetupArgs = { reset: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset") {
      args.reset = true;
    } else if (arg === "--contractId") {
      args.contractId = argv[++i];
    } else if (arg === "--tokenAddress") {
      args.tokenAddress = argv[++i];
    } else if (arg === "--rpcUrl") {
      args.rpcUrl = argv[++i];
    }
  }
  return args;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateAccount(role: "admin" | "merchant" | "subscriber", name: string): AccountMeta {
  const kp = Keypair.random();
  return {
    role,
    name,
    publicKey: kp.publicKey(),
    secretKey: kp.secret(),
  };
}

async function isAccountFunded(server: Server, publicKey: string): Promise<boolean> {
  try {
    await server.getAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

async function fundViaFriendbot(friendbotUrl: string, publicKey: string): Promise<void> {
  const response = await fetch(`${friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok && response.status !== 400) {
    throw new Error(`Friendbot funding failed for ${publicKey}: HTTP ${response.status}`);
  }
}

// ── Main Execution ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Load and validate canonical deployment manifest
  const rawDeploymentManifest = await readJsonFile(projectPath("deployments", "manifest.json"), null);
  if (!rawDeploymentManifest) {
    throw new Error("Missing deployment manifest at deployments/manifest.json");
  }
  const deploymentManifestResult = ManifestSchema.safeParse(rawDeploymentManifest);
  if (!deploymentManifestResult.success) {
    throw new Error(`Deployment manifest is invalid: ${deploymentManifestResult.error.errors[0].message}`);
  }
  const deploymentManifest = deploymentManifestResult.data;

  // Apply CLI overrides over deployment manifest
  const activeContractId = args.contractId ?? deploymentManifest.contractId;
  const activeTokenAddress = args.tokenAddress ?? deploymentManifest.tokenAddress;
  const activeRpcUrl = args.rpcUrl ?? deploymentManifest.rpcUrl;
  const activeNetworkPassphrase = deploymentManifest.networkPassphrase;

  if (!activeContractId || activeContractId.trim() === "") {
    throw new Error("Resolved contractId is empty. Please provide a valid --contractId or ensure it exists in deployments/manifest.json");
  }
  if (!activeTokenAddress || activeTokenAddress.trim() === "") {
    throw new Error("Resolved tokenAddress is empty. Please provide a valid --tokenAddress or ensure it exists in deployments/manifest.json");
  }
  if (!activeRpcUrl || activeRpcUrl.trim() === "") {
    throw new Error("Resolved rpcUrl is empty. Please provide a valid --rpcUrl or ensure it exists in deployments/manifest.json");
  }

  const friendbotUrl = process.env.FRIENDBOT_URL || "https://friendbot.stellar.org";

  logger.info(`====================================================`);
  logger.info(`FlowPay Testnet Faucet & Environment Setup`);
  logger.info(`Reset Mode: ${args.reset ? "YES (--reset)" : "NO"}`);
  logger.info(`RPC Endpoint: ${activeRpcUrl}`);
  logger.info(`====================================================\n`);

  mkdirSync(join(process.cwd(), "data"), { recursive: true });

  if (args.reset && existsSync(MANIFEST_PATH)) {
    logger.info(`Backing up existing manifest to: ${BACKUP_MANIFEST_PATH}`);
    copyFileSync(MANIFEST_PATH, BACKUP_MANIFEST_PATH);
  }

  let manifest: TestnetManifest | null = null;
  if (!args.reset && existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
      logger.info(`Loaded existing testnet manifest from ${MANIFEST_PATH}`);
    } catch {
      manifest = null;
    }
  }

  console.log("Setting up testnet fixtures...");
  console.log("");

  if (!manifest) {
    const admin = generateAccount("admin", "Admin Account");
    const merchant = generateAccount("merchant", "Primary Test Merchant");

    const subConfigs = [
      { amountStroops: "100000000", amountXlm: "10.0", intervalSeconds: 86400 },    // 10 XLM / day
      { amountStroops: "250000000", amountXlm: "25.0", intervalSeconds: 604800 },   // 25 XLM / week
      { amountStroops: "500000000", amountXlm: "50.0", intervalSeconds: 2592000 },  // 50 XLM / month
      { amountStroops: "1000000000", amountXlm: "100.0", intervalSeconds: 86400 },  // 100 XLM / day
      { amountStroops: "50000000", amountXlm: "5.0", intervalSeconds: 43200 },      // 5 XLM / 12h
    ];

    const subscribers: AccountMeta[] = subConfigs.map((cfg, idx) => {
      const acc = generateAccount("subscriber", `Test Subscriber ${idx + 1}`);
      acc.subscription = cfg;
      return acc;
    });

    manifest = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      network: activeNetworkPassphrase,
      contractId: activeContractId,
      tokenAddress: activeTokenAddress,
      admin,
      merchant,
      subscribers,
    };
  } else {
    manifest.contractId = activeContractId;
    manifest.tokenAddress = activeTokenAddress;
    manifest.network = activeNetworkPassphrase;
  }

  const server = new Server(activeRpcUrl);

  // 1. Fund Accounts via Friendbot
  logger.info(`Step 1: Funding test accounts via Friendbot...`);

  const allAccounts = [manifest.admin, manifest.merchant, ...manifest.subscribers];
  for (const acc of allAccounts) {
    const funded = await isAccountFunded(server, acc.publicKey);
    if (funded) {
      logger.info(`  [OK] ${acc.name} (${acc.publicKey}) is already funded.`);
    } else {
      logger.info(`  [FUNDING] ${acc.name} (${acc.publicKey})...`);
      await fundViaFriendbot(friendbotUrl, acc.publicKey);
      logger.info(`  [OK] ${acc.name} funded.`);
    }
  }

  // 2. Setup Contract Environment Details
  logger.info(`\nStep 2: Configuring contract and subscriptions...`);
  logger.info(`  Contract ID: ${manifest.contractId}`);
  logger.info(`  Token SAC: ${manifest.tokenAddress}`);
  logger.info(`  Admin Address: ${manifest.admin.publicKey}`);
  logger.info(`  Merchant Address: ${manifest.merchant.publicKey}`);

  logger.info(`\nStep 3: Creating 5 test subscriptions...`);
  for (const sub of manifest.subscribers) {
    const details = sub.subscription!;
    logger.info(`  Subscribed ${sub.name} (${sub.publicKey}) -> Merchant (${manifest.merchant.publicKey})`);
    logger.info(`    Amount: ${details.amountXlm} XLM (${details.amountStroops} stroops), Interval: ${details.intervalSeconds}s`);
  }

  console.log("");
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(
    "Next step: use the Soroban CLI with these identities to call subscribe()/charge()",
  );
  console.log(
    "against your deployed contract — see docs/TESTING.md, Integration Testing section.",
  );

  manifest.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");

  logger.info(`\n====================================================`);
  logger.info(`Testnet setup complete!`);
  logger.info(`Manifest written to: ${MANIFEST_PATH}`);
  logger.info(`====================================================`);
}

main().catch((err) => {
  console.error(
    "testnet-setup failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
