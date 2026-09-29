import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const execFileAsync = promisify(execFile);

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface SorobanConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  adminSecretKey: string;
}

export interface TxResult {
  hash: string;
  status: string;
}

export function getNetworkPassphrase(
  networkPassphrase = process.env.NETWORK_PASSPHRASE ??
    process.env.VITE_NETWORK_PASSPHRASE,
): string {
  return networkPassphrase ?? Networks.TESTNET;
}

export function loadSorobanConfig(
  overrides: Partial<SorobanConfig> = {},
): SorobanConfig {
  const contractId =
    overrides.contractId ??
    process.env.CONTRACT_ID ??
    process.env.VITE_CONTRACT_ID ??
    "";
  const rpcUrl =
    overrides.rpcUrl ??
    process.env.RPC_URL ??
    process.env.VITE_RPC_URL ??
    DEFAULT_RPC_URL;
  const networkPassphrase =
    overrides.networkPassphrase ?? getNetworkPassphrase();
  const adminSecretKey =
    overrides.adminSecretKey ?? process.env.ADMIN_SECRET_KEY ?? "";

  if (!contractId) {
    throw new Error("CONTRACT_ID or VITE_CONTRACT_ID is required.");
  }
  if (!adminSecretKey) {
    throw new Error(
      "ADMIN_SECRET_KEY is required for admin-signed operations.",
    );
  }

  return { contractId, rpcUrl, networkPassphrase, adminSecretKey };
}

export function createServer(config: Pick<SorobanConfig, "rpcUrl">): Server {
  return new Server(config.rpcUrl);
}

export function parseStellarAddress(address: string): Address {
  return Address.fromString(address);
}

export function isValidStellarAddress(address: string): boolean {
  try {
    parseStellarAddress(address);
    return true;
  } catch {
    return false;
  }
}

export function addressToScVal(address: string): xdr.ScVal {
  return nativeToScVal(parseStellarAddress(address), { type: "address" });
}

export function vecAddressToScVal(addresses: string[]): xdr.ScVal {
  return nativeToScVal(
    addresses.map((address) => parseStellarAddress(address)),
    { type: "vec" },
  );
}

async function loadSimulationAccount(server: Server): Promise<Account> {
  try {
    return await server.getAccount(SIMULATION_SOURCE);
  } catch {
    return new Account(SIMULATION_SOURCE, "0");
  }
}

export async function simulateRead(
  config: Pick<SorobanConfig, "contractId" | "networkPassphrase">,
  server: Server,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<xdr.ScVal | null> {
  const account = await loadSimulationAccount(server);
  const contract = new Contract(config.contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) {
    throw new Error(`Simulation failed for ${method}: ${result.error}`);
  }

  return (result as { result?: { retval?: xdr.ScVal } }).result?.retval ?? null;
}

export async function readContractValue<T>(
  config: Pick<SorobanConfig, "contractId" | "networkPassphrase">,
  server: Server,
  method: string,
  args: xdr.ScVal[] = [],
  decode?: (value: xdr.ScVal | null) => T,
): Promise<T> {
  const retval = await simulateRead(config, server, method, args);
  if (decode) {
    return decode(retval);
  }

  if (!retval) {
    return null as T;
  }

  return scValToNative(retval) as T;
}

export async function invokeContract(
  config: SorobanConfig,
  server: Server,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<TxResult> {
  const keypair = Keypair.fromSecret(config.adminSecretKey);
  const sourceAccount = await server.getAccount(keypair.publicKey());
  const contract = new Contract(config.contractId);

  let tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  tx = await server.prepareTransaction(tx);
  tx.sign(keypair);

  const sendResult = await server.sendTransaction(tx);
  if (sendResult.errorResult) {
    throw new Error(
      `Transaction submission failed for ${method}: ${sendResult.errorResult.toString()}`,
    );
  }

  const hash = sendResult.hash;
  const finalResult = await waitForTransaction(server, hash);
  if (finalResult.status !== "SUCCESS") {
    throw new Error(
      `Transaction ${hash} finished with status ${finalResult.status}`,
    );
  }

  return {
    hash,
    status: finalResult.status,
  };
}

export async function waitForTransaction(
  server: Server,
  hash: string,
): Promise<{ status: string }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 120_000) {
    const response = await server.getTransaction(hash).catch(() => null);
    if (response && response.status !== "NOT_FOUND") {
      return { status: response.status };
    }
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for transaction ${hash}`);
}

export async function retry<T>(
  attempts: number,
  action: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(
          `${label} failed (attempt ${attempt}/${attempts}); retrying...`,
        );
        await sleep(1_500 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    env: process.env,
  });

  if (stderr.trim()) {
    console.error(stderr.trim());
  }

  return stdout.trim();
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  if (!(await fileExists(path))) {
    return fallback;
  }

  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as T;
}

export async function writeJsonFile(
  path: string,
  value: unknown,
): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export async function appendJsonLine(
  path: string,
  value: unknown,
): Promise<void> {
  await ensureDir(dirname(path));
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
}

export function projectPath(...segments: string[]): string {
  return resolve(process.cwd(), ...segments);
}

export { nativeToScVal, scValToNative };
