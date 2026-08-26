#!/usr/bin/env tsx
/**
 * deploy-pipeline.ts — Reproducible FlowPay deployment pipeline.
 *
 * Usage:
 *   npx tsx scripts/deploy-pipeline.ts [--dry-run]
 *
 * Config:
 *   deployments/config.json
 *
 * Environment:
 *   DEPLOYER_SECRET_KEY                       Required for live deployment.
 *   ADMIN_SECRET_KEY                          Required for admin-signed post-deploy steps.
 *   RPC_URL / VITE_RPC_URL                    Optional override.
 *   NETWORK_PASSPHRASE / VITE_NETWORK_PASSPHRASE
 *                                            Optional override.
 */

import { isAbsolute, resolve } from "node:path";
import {
  addressToScVal,
  createServer,
  invokeContract,
  isValidStellarAddress,
  loadSorobanConfig,
  nativeToScVal,
  projectPath,
  readContractValue,
  readJsonFile,
  retry,
  runCommand,
  scValToNative,
  vecAddressToScVal,
  writeJsonFile,
} from "./soroban-admin.js";

interface DeploymentConfig {
  network: string;
  networkPassphrase: string;
  rpcUrl: string;
  tokenAddress: string;
  adminAddress: string;
  feeBps: number;
  feeCollector: string;
  initialMerchants: string[];
  wasmPath?: string;
}

interface DeploymentManifest {
  contractId: string | null;
  deployedAt: string | null;
  network: string;
  deployer: string | null;
  steps: {
    build: boolean;
    deploy: boolean;
    initialize: boolean;
    fee: boolean;
    merchants: boolean;
  };
  lastUpdatedAt: string;
}

const CONFIG_PATH = projectPath("deployments", "config.json");
const MANIFEST_PATH = projectPath("deployments", "manifest.json");

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes("--dry-run") };
}

function validateConfig(config: DeploymentConfig): void {
  if (!config.networkPassphrase) {
    throw new Error("deployments/config.json must define networkPassphrase.");
  }
  if (!isValidStellarAddress(config.tokenAddress)) {
    throw new Error("tokenAddress must be a valid Stellar address.");
  }
  if (!isValidStellarAddress(config.adminAddress)) {
    throw new Error("adminAddress must be a valid Stellar address.");
  }
  if (!isValidStellarAddress(config.feeCollector)) {
    throw new Error("feeCollector must be a valid Stellar address.");
  }
  for (const merchant of config.initialMerchants) {
    if (!isValidStellarAddress(merchant)) {
      throw new Error(`Invalid initial merchant address: ${merchant}`);
    }
  }
}

function defaultManifest(config: DeploymentConfig): DeploymentManifest {
  return {
    contractId: null,
    deployedAt: null,
    network: config.network,
    deployer: null,
    steps: {
      build: false,
      deploy: false,
      initialize: false,
      fee: false,
      merchants: false,
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

async function saveManifest(manifest: DeploymentManifest): Promise<void> {
  manifest.lastUpdatedAt = new Date().toISOString();
  await writeJsonFile(MANIFEST_PATH, manifest);
}

async function loadConfig(): Promise<DeploymentConfig> {
  const config = await readJsonFile<DeploymentConfig | null>(CONFIG_PATH, null);
  if (!config) {
    throw new Error(`Missing deployment config at ${CONFIG_PATH}`);
  }
  validateConfig(config);
  return config;
}

async function buildWasm(dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log("[dry-run] Would build contract WASM.");
    return;
  }
  await runCommand("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"], projectPath("contract"));
}

async function deployContract(config: DeploymentConfig, dryRun: boolean): Promise<string> {
  if (dryRun) {
    console.log("[dry-run] Would deploy contract.");
    return "DRY_RUN_CONTRACT_ID";
  }

  const deployerSecretKey = process.env.DEPLOYER_SECRET_KEY ?? "";
  if (!deployerSecretKey) {
    throw new Error("DEPLOYER_SECRET_KEY is required for live deployment.");
  }

  const configuredWasmPath =
    config.wasmPath ?? projectPath("contract", "target", "wasm32-unknown-unknown", "release", "flow_pay.wasm");
  const wasmPath = isAbsolute(configuredWasmPath) ? configuredWasmPath : resolve(process.cwd(), configuredWasmPath);
  const output = await retry(
    3,
    () =>
      runCommand(
        "stellar",
        [
          "contract",
          "deploy",
          "--wasm",
          wasmPath,
          "--source",
          deployerSecretKey,
          "--rpc-url",
          config.rpcUrl,
          "--network-passphrase",
          config.networkPassphrase,
        ],
        process.cwd()
      ),
    "deploy contract"
  );

  const contractId = output.split(/\s+/).find((token) => token.startsWith("C"));
  if (!contractId) {
    throw new Error(`Could not parse contract ID from deploy output: ${output}`);
  }

  return contractId;
}

async function verifyInitialized(contractId: string, config: DeploymentConfig): Promise<boolean> {
  const sorobanConfig = loadSorobanConfig({
    contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
  });
  const server = createServer(sorobanConfig);

  const retval = await readContractValue<Record<string, unknown>>(
    sorobanConfig,
    server,
    "contract_health_check",
    [],
    (value) => (value ? (scValToNative(value) as Record<string, unknown>) : {})
  );

  return retval.admin_configured === true && retval.token_configured === true;
}

async function initializeContract(contractId: string, config: DeploymentConfig, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log("[dry-run] Would initialize contract.");
    return;
  }

  const sorobanConfig = loadSorobanConfig({
    contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
  });
  const server = createServer(sorobanConfig);
  const alreadyInitialized = await verifyInitialized(contractId, config);
  if (alreadyInitialized) {
    return;
  }
  await invokeContract(sorobanConfig, server, "initialize", [
    addressToScVal(config.tokenAddress),
    addressToScVal(config.adminAddress),
  ]);
}

async function configureFee(contractId: string, config: DeploymentConfig, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log("[dry-run] Would propose and commit fee.");
    return;
  }

  const sorobanConfig = loadSorobanConfig({
    contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
  });
  const server = createServer(sorobanConfig);

  const existing = await readContractValue<[string, number] | null>(
    sorobanConfig,
    server,
    "get_fee",
    [],
    (value) => (value ? (scValToNative(value) as [string, number]) : null)
  );

  if (existing && existing[0] === config.feeCollector && Number(existing[1]) === config.feeBps) {
    return;
  }

  await invokeContract(sorobanConfig, server, "propose_fee", [
    addressToScVal(config.feeCollector),
    nativeToScVal(config.feeBps, { type: "u32" }),
  ]);
  await invokeContract(sorobanConfig, server, "commit_fee", []);
}

async function whitelistInitialMerchants(contractId: string, config: DeploymentConfig, dryRun: boolean): Promise<void> {
  if (config.initialMerchants.length === 0) {
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] Would whitelist ${config.initialMerchants.length} merchant(s).`);
    return;
  }

  const sorobanConfig = loadSorobanConfig({
    contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
  });
  const server = createServer(sorobanConfig);
  const missing: string[] = [];

  for (const merchant of config.initialMerchants) {
    const whitelisted = await readContractValue<boolean>(
      sorobanConfig,
      server,
      "is_merchant_whitelisted",
      [addressToScVal(merchant)],
      (value) => Boolean(value?.b())
    );
    if (!whitelisted) {
      missing.push(merchant);
    }
  }

  if (missing.length === 0) {
    return;
  }

  await invokeContract(sorobanConfig, server, "whitelist_batch_add", [vecAddressToScVal(missing)]);
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv);
  const config = await loadConfig();

  const envPassphrase = process.env.NETWORK_PASSPHRASE ?? process.env.VITE_NETWORK_PASSPHRASE;
  if (envPassphrase && envPassphrase !== config.networkPassphrase) {
    throw new Error("NETWORK_PASSPHRASE does not match deployments/config.json.");
  }

  const manifest = await readJsonFile<DeploymentManifest>(MANIFEST_PATH, defaultManifest(config));

  if (!manifest.steps.build) {
    await buildWasm(dryRun);
    manifest.steps.build = true;
    await saveManifest(manifest);
  }

  if (!manifest.steps.deploy) {
    manifest.contractId = await deployContract(config, dryRun);
    manifest.deployedAt = new Date().toISOString();
    manifest.deployer = dryRun ? "DRY_RUN" : "DEPLOYER_SECRET_KEY";
    manifest.steps.deploy = true;
    await saveManifest(manifest);
  }

  if (!manifest.contractId) {
    throw new Error("Manifest does not contain a contractId after deploy step.");
  }

  if (!manifest.steps.initialize) {
    await initializeContract(manifest.contractId, config, dryRun);
    if (!dryRun) {
      const healthy = await verifyInitialized(manifest.contractId, config);
      if (!healthy) {
        throw new Error("Initialization verification failed.");
      }
    }
    manifest.steps.initialize = true;
    await saveManifest(manifest);
  }

  if (!manifest.steps.fee) {
    await configureFee(manifest.contractId, config, dryRun);
    manifest.steps.fee = true;
    await saveManifest(manifest);
  }

  if (!manifest.steps.merchants) {
    await whitelistInitialMerchants(manifest.contractId, config, dryRun);
    manifest.steps.merchants = true;
    await saveManifest(manifest);
  }

  console.log(`Deployment pipeline complete. Manifest: ${MANIFEST_PATH}`);
  if (!dryRun) {
    console.log(`Contract ID: ${manifest.contractId}`);
  }
}

main().catch((error) => {
  console.error("deploy-pipeline failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
