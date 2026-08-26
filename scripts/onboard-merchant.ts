#!/usr/bin/env tsx
/**
 * onboard-merchant.ts — Admin merchant onboarding automation for FlowPay.
 *
 * Usage:
 *   npx tsx scripts/onboard-merchant.ts G...
 *   npx tsx scripts/onboard-merchant.ts --batch merchants.csv
 *
 * Environment:
 *   CONTRACT_ID or VITE_CONTRACT_ID          Required. FlowPay contract ID.
 *   ADMIN_SECRET_KEY                         Required. Admin secret for signed whitelist txs.
 *   RPC_URL or VITE_RPC_URL                  Optional. Soroban RPC URL.
 *   NETWORK_PASSPHRASE or VITE_NETWORK_PASSPHRASE
 *                                            Optional. Stellar network passphrase.
 *   MERCHANT_ONBOARD_WEBHOOK_URL             Optional. Webhook to notify after onboarding.
 */

import { readFile } from "node:fs/promises";
import {
  appendJsonLine,
  addressToScVal,
  createServer,
  invokeContract,
  isValidStellarAddress,
  loadSorobanConfig,
  projectPath,
  readContractValue,
  vecAddressToScVal,
} from "./soroban-admin.js";

interface CliArgs {
  address?: string;
  batchFile?: string;
}

interface MerchantOutcome {
  address: string;
  status: "onboarded" | "already_whitelisted" | "frozen" | "invalid";
  txHash: string | null;
  message: string;
}

const LOG_PATH = projectPath("data", "merchants.jsonl");

const config = loadSorobanConfig();
const server = createServer(config);

function parseArgs(argv: string[]): CliArgs {
  let address: string | undefined;
  let batchFile: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--batch") {
      batchFile = argv[++i];
    } else if (!address) {
      address = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!address && !batchFile) {
    throw new Error("Provide a merchant address or --batch merchants.csv.");
  }

  return { address, batchFile };
}

async function loadBatchAddresses(csvPath: string): Promise<string[]> {
  const content = await readFile(csvPath, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [firstCell] = line.split(",");
      return firstCell.trim();
    })
    .filter((value) => value.toLowerCase() !== "address");
}

async function isMerchantFrozen(address: string): Promise<boolean> {
  return readContractValue<boolean>(
    config,
    server,
    "is_merchant_frozen",
    [addressToScVal(address)],
    (value) => (value ? Boolean(value.b()) : false)
  );
}

async function isMerchantWhitelisted(address: string): Promise<boolean> {
  return readContractValue<boolean>(
    config,
    server,
    "is_merchant_whitelisted",
    [addressToScVal(address)],
    (value) => (value ? Boolean(value.b()) : false)
  );
}

async function notifyWebhook(address: string, txHash: string | null, status: MerchantOutcome["status"]): Promise<void> {
  const url = process.env.MERCHANT_ONBOARD_WEBHOOK_URL;
  if (!url) {
    return;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address,
      tx_hash: txHash,
      status,
      onboarded_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned HTTP ${response.status}`);
  }
}

async function logMerchant(address: string, txHash: string | null): Promise<void> {
  await appendJsonLine(LOG_PATH, {
    address,
    onboarded_at: new Date().toISOString(),
    tx_hash: txHash,
  });
}

async function onboardMerchant(address: string): Promise<MerchantOutcome> {
  if (!isValidStellarAddress(address)) {
    return {
      address,
      status: "invalid",
      txHash: null,
      message: "Invalid Stellar address; skipped.",
    };
  }

  const frozen = await isMerchantFrozen(address);
  if (frozen) {
    return {
      address,
      status: "frozen",
      txHash: null,
      message: "Merchant is frozen; onboarding blocked.",
    };
  }

  const alreadyWhitelisted = await isMerchantWhitelisted(address);
  if (alreadyWhitelisted) {
    await logMerchant(address, null);
    await notifyWebhook(address, null, "already_whitelisted");
    return {
      address,
      status: "already_whitelisted",
      txHash: null,
      message: "Merchant already whitelisted; no transaction sent.",
    };
  }

  const tx = await invokeContract(config, server, "whitelist_batch_add", [vecAddressToScVal([address])]);
  const verified = await isMerchantWhitelisted(address);
  if (!verified) {
    throw new Error(`Whitelist verification failed after tx ${tx.hash}`);
  }

  await logMerchant(address, tx.hash);
  await notifyWebhook(address, tx.hash, "onboarded");

  return {
    address,
    status: "onboarded",
    txHash: tx.hash,
    message: `Merchant whitelisted successfully in tx ${tx.hash}.`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const addresses = args.batchFile ? await loadBatchAddresses(args.batchFile) : [args.address as string];
  const outcomes: MerchantOutcome[] = [];
  let hadExecutionError = false;

  for (const address of addresses) {
    try {
      const outcome = await onboardMerchant(address);
      outcomes.push(outcome);
      console.log(`${address}: ${outcome.message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hadExecutionError = true;
      console.error(`${address}: ${message}`);
    }
  }

  const failures = outcomes.filter((outcome) => outcome.status === "invalid" || outcome.status === "frozen");
  if (failures.length > 0) {
    console.error(`Completed with ${failures.length} blocked or invalid merchant(s).`);
  }
  if (hadExecutionError) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("onboard-merchant failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
