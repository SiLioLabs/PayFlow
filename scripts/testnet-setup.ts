/**
 * testnet-setup.ts — Create a reproducible set of funded test identities for
 * integration and E2E testing against a testnet FlowPay deployment.
 *
 * Given a numeric --seed, deterministically derives keypairs (the same seed
 * always produces the same accounts), funds any that aren't yet funded via
 * Friendbot, and writes a manifest describing them. Re-running with the same
 * --seed reuses the same identities instead of minting new ones, so test
 * runs (and CI) get a stable, reproducible cast of accounts.
 *
 * Usage:
 *   npx tsx scripts/testnet-setup.ts --seed 1 --users 3 --merchants 1
 *
 * Environment variables:
 *   RPC_URL        — Soroban RPC endpoint, used only to check account existence
 *                     (default: https://soroban-testnet.stellar.org)
 *   FRIENDBOT_URL  — Friendbot funding endpoint (default: https://friendbot.stellar.org)
 *
 * Output:
 *   Writes scripts/.testnet-manifest.<seed>.json containing each identity's
 *   public key, secret key, and role (user/merchant). This file is test
 *   fixture data for a throwaway testnet account, not a secret worth
 *   protecting — do not reuse these keys for anything beyond testnet testing.
 *
 * This script only creates and funds accounts — it does not call `subscribe`
 * or any other contract function. Use the Soroban CLI against the generated
 * identities (see docs/TESTING.md's "Integration Testing" section) once they
 * exist and are funded.
 *
 * Exit codes:
 *   0 — all requested identities exist and are funded
 *   1 — invalid arguments or a funding request failed
 */

import { createHash } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { MultiEndpointServer } from "./rpc-client.js";

// ── Configuration ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || "https://friendbot.stellar.org";

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
        console.error("Usage: testnet-setup.ts --seed <n> --users <n> --merchants <n>");
        process.exit(1);
    }
  }

  if (!Number.isInteger(seed) || !Number.isInteger(users) || !Number.isInteger(merchants)) {
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
  publicKey: string;
  secretKey: string;
}

/**
 * Derives a stable ed25519 keypair from (seed, role, index) so the same
 * --seed always reproduces the same set of testnet identities.
 */
function deriveKeypair(seed: number, role: "user" | "merchant", index: number): Keypair {
  const hash = createHash("sha256").update(`payflow-testnet-setup:${seed}:${role}:${index}`).digest();
  return Keypair.fromRawEd25519Seed(hash);
}

function manifestPath(seed: number): string {
  return join(SCRIPT_DIR, `.testnet-manifest.${seed}.json`);
}

function loadOrCreateManifest(args: SetupArgs): Identity[] {
  const path = manifestPath(args.seed);

  if (existsSync(path)) {
    const existing: Identity[] = JSON.parse(readFileSync(path, "utf-8"));
    const haveUsers = existing.filter((i) => i.role === "user").length;
    const haveMerchants = existing.filter((i) => i.role === "merchant").length;
    if (haveUsers >= args.users && haveMerchants >= args.merchants) {
      console.log(`Reusing existing manifest: ${path}`);
      return existing;
    }
  }

  const identities: Identity[] = [];
  for (let i = 0; i < args.users; i++) {
    const kp = deriveKeypair(args.seed, "user", i);
    identities.push({ role: "user", index: i, publicKey: kp.publicKey(), secretKey: kp.secret() });
  }
  for (let i = 0; i < args.merchants; i++) {
    const kp = deriveKeypair(args.seed, "merchant", i);
    identities.push({ role: "merchant", index: i, publicKey: kp.publicKey(), secretKey: kp.secret() });
  }

  writeFileSync(path, JSON.stringify(identities, null, 2));
  console.log(`Wrote manifest: ${path}`);
  return identities;
}

// ── Funding ───────────────────────────────────────────────────────────────────

async function isFunded(server: MultiEndpointServer, publicKey: string): Promise<boolean> {
  try {
    await server.getAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

async function fundViaFriendbot(publicKey: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok && response.status !== 400) {
    // Friendbot returns 400 if the account is already funded — treat that as success.
    throw new Error(`Friendbot funding failed for ${publicKey}: HTTP ${response.status}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const server = new MultiEndpointServer(RPC_URL);

  console.log(`Setting up testnet fixtures: seed=${args.seed} users=${args.users} merchants=${args.merchants}`);
  console.log("");

  const identities = loadOrCreateManifest(args);

  for (const identity of identities) {
    const label = `${identity.role}[${identity.index}]`;
    const funded = await isFunded(server, identity.publicKey);

    if (funded) {
      console.log(`  ${label} ${identity.publicKey} — already funded`);
      continue;
    }

    console.log(`  ${label} ${identity.publicKey} — funding via Friendbot...`);
    await fundViaFriendbot(identity.publicKey);
    console.log(`  ${label} ${identity.publicKey} — funded`);
  }

  console.log("");
  console.log(`Manifest: ${manifestPath(args.seed)}`);
  console.log("Next step: use the Soroban CLI with these identities to call subscribe()/charge()");
  console.log("against your deployed contract — see docs/TESTING.md, Integration Testing section.");
}

main().catch((err) => {
  console.error("testnet-setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
