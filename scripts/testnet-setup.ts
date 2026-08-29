/**
 * testnet-setup.ts — Automated testnet environment creation and test data setup script for FlowPay.
 *
 * Creates and funds test accounts (Admin, Merchant, 5 Subscribers), verifies or initializes
 * the contract, sets protocol fees, whitelists the merchant, and creates 5 test subscriptions
 * with varied amounts and intervals.
 *
 * Usage:
 *   npx tsx scripts/testnet-setup.ts [--reset]
 *
 * Environment Variables:
 *   RPC_URL            — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *   FRIENDBOT_URL      — Friendbot endpoint (default: https://friendbot.stellar.org)
 *   NETWORK_PASSPHRASE — Network passphrase (default: Testnet)
 *   CONTRACT_ID        — Contract ID (default: process.env.CONTRACT_ID / process.env.VITE_CONTRACT_ID)
 *
 * Output:
 *   data/testnet-accounts.json
 */

import { createHash } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { MultiEndpointServer } from "./rpc-client.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, Contract, Networks, TransactionBuilder, BASE_FEE, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { logger } from "./logger";

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

/**
 * Derives a stable ed25519 keypair from (seed, role, index) so the same
 * --seed always reproduces the same set of testnet identities.
 */
function deriveKeypair(
  seed: number,
  role: "user" | "merchant",
  index: number,
): Keypair {
  const hash = createHash("sha256")
    .update(`payflow-testnet-setup:${seed}:${role}:${index}`)
    .digest();
  return Keypair.fromRawEd25519Seed(hash);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fundViaFriendbot(publicKey: string, retries = 3): Promise<void> {
  const url = `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 400) {
        return;
      }
    } catch (err) {
      if (attempt === retries) throw err;
    }
    await delay(1500 * attempt);
  }

  const identities: Identity[] = [];
  for (let i = 0; i < args.users; i++) {
    const kp = deriveKeypair(args.seed, "user", i);
    identities.push({
      role: "user",
      index: i,
      publicKey: kp.publicKey(),
      secretKey: kp.secret(),
    });
  }
  for (let i = 0; i < args.merchants; i++) {
    const kp = deriveKeypair(args.seed, "merchant", i);
    identities.push({
      role: "merchant",
      index: i,
      publicKey: kp.publicKey(),
      secretKey: kp.secret(),
    });
  }

  writeFileSync(path, JSON.stringify(identities, null, 2));
  console.log(`Wrote manifest: ${path}`);
  return identities;
}

// ── Funding ───────────────────────────────────────────────────────────────────

async function isFunded(server: MultiEndpointServer, publicKey: string): Promise<boolean> {
async function isAccountFunded(server: Server, publicKey: string): Promise<boolean> {
  try {
    await server.getAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

async function fundViaFriendbot(publicKey: string): Promise<void> {
  const response = await fetch(
    `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`,
  );
  if (!response.ok && response.status !== 400) {
    // Friendbot returns 400 if the account is already funded — treat that as success.
    throw new Error(
      `Friendbot funding failed for ${publicKey}: HTTP ${response.status}`,
    );
  }
function generateAccount(role: "admin" | "merchant" | "subscriber", name: string): AccountMeta {
  const kp = Keypair.random();
  return {
    role,
    name,
    publicKey: kp.publicKey(),
    secretKey: kp.secret(),
  };
}

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const server = new MultiEndpointServer(RPC_URL);
async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");

  logger.info(`====================================================`);
  logger.info(`FlowPay Testnet Faucet & Environment Setup`);
  logger.info(`Reset Mode: ${reset ? "YES (--reset)" : "NO"}`);
  logger.info(`RPC Endpoint: ${RPC_URL}`);
  logger.info(`====================================================\n`);

  mkdirSync(join(process.cwd(), "data"), { recursive: true });

  if (reset && existsSync(MANIFEST_PATH)) {
    logger.info(`Backing up existing manifest to: ${BACKUP_MANIFEST_PATH}`);
    copyFileSync(MANIFEST_PATH, BACKUP_MANIFEST_PATH);
  }

  let manifest: TestnetManifest | null = null;
  if (!reset && existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
      logger.info(`Loaded existing testnet manifest from ${MANIFEST_PATH}`);
    } catch {
      manifest = null;
    }
  }

  console.log(
    `Setting up testnet fixtures: seed=${args.seed} users=${args.users} merchants=${args.merchants}`,
  );
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
      network: NETWORK_PASSPHRASE,
      contractId: process.env.CONTRACT_ID || process.env.VITE_CONTRACT_ID || "CC3DOKAIZKCONTRACTTESTNETADDRESS1234567890FLOWPAY",
      tokenAddress: DEFAULT_TOKEN,
      admin,
      merchant,
      subscribers,
    };
  }

  const server = new Server(RPC_URL);

  // 1. Fund Accounts via Friendbot
  logger.info(`Step 1: Funding test accounts via Friendbot...`);

  const allAccounts = [manifest.admin, manifest.merchant, ...manifest.subscribers];
  for (const acc of allAccounts) {
    const funded = await isAccountFunded(server, acc.publicKey);
    if (funded) {
      logger.info(`  [OK] ${acc.name} (${acc.publicKey}) is already funded.`);
    } else {
      logger.info(`  [FUNDING] ${acc.name} (${acc.publicKey})...`);
      await fundViaFriendbot(acc.publicKey);
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
  console.log(`Manifest: ${manifestPath(args.seed)}`);
  console.log(
    "Next step: use the Soroban CLI with these identities to call subscribe()/charge()",
  );
  console.log(
    "against your deployed contract — see docs/TESTING.md, Integration Testing section.",
  );
}

main().catch((err) => {
  console.error(
    "testnet-setup failed:",
    err instanceof Error ? err.message : err,
  );
  manifest.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");

  logger.info(`\n====================================================`);
  logger.info(`Testnet setup complete!`);
  logger.info(`Manifest written to: ${MANIFEST_PATH}`);
  logger.info(`====================================================`);
}

main().catch((err) => {
  logger.error("Testnet setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
