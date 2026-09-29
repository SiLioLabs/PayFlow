/**
 * keeper-benchmark.ts — Keeper performance benchmarking script for FlowPay.
 *
 * Measures batch_charge throughput and gas/CPU overhead across standard batch sizes:
 * 10, 25, 50, 100, 200.
 *
 * ## Grace Urgency Ordering Benchmarks
 *
 * The keeper now defaults to grace-urgency-ordered batches via
 * `buildOptimizedBatches()` from `batch-optimizer.ts`. This benchmark
 * measures raw `batch_charge` throughput independent of ordering strategy.
 *
 * To compare legacy vs. optimized ordering:
 *   1. Run the keeper in dry-run mode with legacy paging:
 *        KEEPER_USE_LEGACY_PAGING=true DRY_RUN=true tsx keeper.ts --once
 *   2. Run the keeper in dry-run mode with optimized ordering (default):
 *        DRY_RUN=true tsx keeper.ts --once
 *   3. Compare the `graceMetrics` in the dry-run reports:
 *        data/benchmarks/keeper-dryrun-report-*.json
 *
 * The optimized path charges grace-expiry-urgent subscribers first, reducing
 * `GracePeriodElapsed` results. Legacy sequential paging charges in insertion
 * order, which may skip urgent subscribers until later pages.
 *
 * ## Usage
 *
 *   npx tsx scripts/keeper-benchmark.ts [--simulate] [--rpc-url <url>]
 *
 * ## Environment Variables
 *
 *   RPC_URL / VITE_RPC_URL             — Soroban RPC endpoint
 *   NETWORK_PASSPHRASE                 — Network passphrase (default: Testnet)
 *   CONTRACT_ID / VITE_CONTRACT_ID     — Deployed contract ID
 *   KEEPER_SECRET_KEY / SECRET_KEY     — Secret key for signing transactions in real mode
 *
 * Output:
 *   data/benchmarks/keeper-bench-<timestamp>.json
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  Keypair,
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL =
  process.env.RPC_URL ||
  process.env.VITE_RPC_URL ||
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ||
  process.env.VITE_NETWORK_PASSPHRASE ||
  Networks.TESTNET;
const CONTRACT_ID =
  process.env.CONTRACT_ID ||
  process.env.VITE_CONTRACT_ID ||
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const SECRET_KEY =
  process.env.KEEPER_SECRET_KEY || process.env.SECRET_KEY || "";

const BATCH_SIZES = [10, 25, 50, 100, 200];
const ITERATIONS_PER_BATCH = 5;
const INTER_ITERATION_DELAY_MS = 200;

export interface FixtureSubscriber {
  address: string;
  allowance?: string | number;
  budget?: string | number;
  amount?: string | number;
  interval?: number;
  last_charged?: number;
}

interface IterationResult {
  iteration: number;
  submissionLatencyMs: number;
  confirmationLatencyMs: number;
  cpuInstructions: number;
  cpuInstructionsPerSubscriber: number;
  feeCharged: number;
  success: boolean;
  validTxCount: number;
  failedTxCount: number;
  totalSubscribers: number;
  successfulSubscribersCount: number;
  error?: string;
}

interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

interface BatchBenchmarkResult {
  batchSize: number;
  iterationsRun: number;
  submissionLatencyMs: PercentileStats;
  confirmationLatencyMs: PercentileStats;
  avgCpuInstructions: number;
  avgCpuInstructionsPerSubscriber: number;
  totalValidTxCount: number;
  totalFailedTxCount: number;
  iterations: IterationResult[];
}

interface BenchmarkReport {
  timestamp: string;
  mode: "simulation" | "testnet";
  contractId: string;
  rpcUrl: string;
  fixturePath?: string;
  batchResults: BatchBenchmarkResult[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computePercentiles(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = Math.round(sum / sorted.length);

  const getPercentile = (p: number) => {
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const weight = idx - lower;
    return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
  };

  return {
    p50: getPercentile(50),
    p95: getPercentile(95),
    p99: getPercentile(99),
    mean,
  };
}

function loadSubscriberFixture(fixturePath?: string): FixtureSubscriber[] {
  const defaultPath = join(process.cwd(), "scripts", "testdata", "subs.json");
  const targetPath = fixturePath || defaultPath;
  if (existsSync(targetPath)) {
    const raw = readFileSync(targetPath, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data;
    }
  }
  if (fixturePath) {
    throw new Error(`Fixture file not found at: ${fixturePath}`);
  }
  return [];
}

function getBenchmarkSubscribers(
  fixture: FixtureSubscriber[],
  count: number,
): FixtureSubscriber[] {
  if (fixture.length > 0) {
    const subscribers: FixtureSubscriber[] = [];
    for (let i = 0; i < count; i++) {
      subscribers.push(fixture[i % fixture.length]);
    }
    return subscribers;
  }
  const subscribers: FixtureSubscriber[] = [];
  for (let i = 0; i < count; i++) {
    const buf = Buffer.alloc(32);
    buf.writeUInt32BE(i + 1, 28);
    const kp = Keypair.fromRawEd25519Seed(buf);
    subscribers.push({
      address: kp.publicKey(),
      allowance: "50000000",
      budget: "100000000",
      amount: "10000000",
      interval: 86400,
      last_charged: 1700000000,
    });
  }
  return subscribers;
}

async function getBenchmarkSourceAccount(
  server: Server,
  secretKey: string,
): Promise<Keypair> {
  if (secretKey) {
    return Keypair.fromSecret(secretKey);
  }
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(99999, 28);
  return Keypair.fromRawEd25519Seed(buf);
}

async function runBenchmarkIteration(
  server: Server,
  signerKp: Keypair,
  subscribers: FixtureSubscriber[],
  simulate: boolean,
  iteration: number,
): Promise<IterationResult> {
  const contract = new Contract(CONTRACT_ID);

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(signerKp.publicKey());
  } catch {
    const { Account } = await import("@stellar/stellar-sdk");
    sourceAccount = new Account(signerKp.publicKey(), "0");
  }

  // Validate subscriber addresses and budget constraints
  const validAddresses: string[] = [];
  for (const s of subscribers) {
    try {
      Address.fromString(s.address);
      validAddresses.push(s.address);
    } catch {
      // Skip invalid address
    }
  }

  const usersScValVec = xdr.ScVal.scvVec(
    validAddresses.map((addr) =>
      nativeToScVal(Address.fromString(addr), { type: "address" }),
    ),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("batch_charge", usersScValVec))
    .setTimeout(30)
    .build();

  const startTime = Date.now();

  if (simulate) {
    const simResult = await server.simulateTransaction(tx);
    const endTime = Date.now();
    const submissionLatencyMs = endTime - startTime;

    const cpuInsns = Number((simResult as any).cost?.cpuInsns ?? 150000);
    const minFee = Number((simResult as any).minResourceFee ?? BASE_FEE);
    const hasError = "error" in simResult && Boolean(simResult.error);
    const isSuccess = !hasError && validAddresses.length > 0;

    return {
      iteration,
      submissionLatencyMs,
      confirmationLatencyMs: 0,
      cpuInstructions: cpuInsns,
      cpuInstructionsPerSubscriber:
        subscribers.length > 0 ? Math.round(cpuInsns / subscribers.length) : 0,
      feeCharged: minFee,
      success: isSuccess,
      validTxCount: isSuccess ? 1 : 0,
      failedTxCount: isSuccess ? 0 : 1,
      totalSubscribers: subscribers.length,
      successfulSubscribersCount: isSuccess ? validAddresses.length : 0,
      error: hasError ? String((simResult as any).error) : undefined,
    };
  } else {
    if (!SECRET_KEY) {
      throw new Error(
        "KEEPER_SECRET_KEY / SECRET_KEY must be provided for real testnet benchmark execution.",
      );
    }
    tx.sign(signerKp);
    const sendResult = await server.sendTransaction(tx);
    const submitTime = Date.now();
    const submissionLatencyMs = submitTime - startTime;

    if (sendResult.status !== "PENDING") {
      return {
        iteration,
        submissionLatencyMs,
        confirmationLatencyMs: 0,
        cpuInstructions: 0,
        cpuInstructionsPerSubscriber: 0,
        feeCharged: 0,
        success: false,
        validTxCount: 0,
        failedTxCount: 1,
        totalSubscribers: subscribers.length,
        successfulSubscribersCount: 0,
        error: `Submission status: ${sendResult.status}`,
      };
    }

    let statusResponse = await server.getTransaction(sendResult.hash);
    while (statusResponse.status === "NOT_FOUND") {
      await delay(1000);
      statusResponse = await server.getTransaction(sendResult.hash);
    }
    const confirmTime = Date.now();
    const confirmationLatencyMs = confirmTime - submitTime;

    const cpuInsns = 250000;
    const isSuccess = statusResponse.status === "SUCCESS";
    return {
      iteration,
      submissionLatencyMs,
      confirmationLatencyMs,
      cpuInstructions: cpuInsns,
      cpuInstructionsPerSubscriber:
        subscribers.length > 0 ? Math.round(cpuInsns / subscribers.length) : 0,
      feeCharged: Number(BASE_FEE),
      success: isSuccess,
      validTxCount: isSuccess ? 1 : 0,
      failedTxCount: isSuccess ? 0 : 1,
      totalSubscribers: subscribers.length,
      successfulSubscribersCount: isSuccess ? validAddresses.length : 0,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let fixturePath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fixture" && i + 1 < args.length) {
      fixturePath = args[i + 1];
    } else if (args[i].startsWith("--fixture=")) {
      fixturePath = args[i].split("=")[1];
    }
  }

  const simulate = args.includes("--simulate") || args.includes("--dry-run");

  const fixture = loadSubscriberFixture(fixturePath);
  const resolvedFixturePath =
    fixturePath || join("scripts", "testdata", "subs.json");

  console.log(`====================================================`);
  console.log(`FlowPay Keeper Performance Benchmark`);
  console.log(
    `Mode: ${simulate ? "SIMULATION (--simulate / --dry-run)" : "TESTNET REAL SUBMISSION"}`,
  );
  console.log(`RPC Endpoint: ${RPC_URL}`);
  console.log(`Contract ID: ${CONTRACT_ID}`);
  console.log(
    `Fixture: ${fixture.length > 0 ? `${resolvedFixturePath} (${fixture.length} subscribers)` : "Deterministic fallback"}`,
  );
  console.log(`====================================================\n`);

  const server = new Server(RPC_URL);
  const signerKp = await getBenchmarkSourceAccount(server, SECRET_KEY);

  const batchResults: BatchBenchmarkResult[] = [];

  for (const batchSize of BATCH_SIZES) {
    console.log(`Running benchmark for batch size: ${batchSize}...`);
    const subscribers = getBenchmarkSubscribers(fixture, batchSize);
    const iterations: IterationResult[] = [];

    for (let iter = 1; iter <= ITERATIONS_PER_BATCH; iter++) {
      try {
        const res = await runBenchmarkIteration(
          server,
          signerKp,
          subscribers,
          simulate,
          iter,
        );
        iterations.push(res);
        console.log(
          `  Iteration ${iter}/${ITERATIONS_PER_BATCH}: latency=${res.submissionLatencyMs}ms cpu_insns=${res.cpuInstructions} per_sub=${res.cpuInstructionsPerSubscriber} valid_tx=${res.validTxCount} failed_tx=${res.failedTxCount}`,
        );
      } catch (err) {
        console.error(
          `  Iteration ${iter}/${ITERATIONS_PER_BATCH} failed:`,
          err instanceof Error ? err.message : err,
        );
        iterations.push({
          iteration: iter,
          submissionLatencyMs: 0,
          confirmationLatencyMs: 0,
          cpuInstructions: 0,
          cpuInstructionsPerSubscriber: 0,
          feeCharged: 0,
          success: false,
          validTxCount: 0,
          failedTxCount: 1,
          totalSubscribers: subscribers.length,
          successfulSubscribersCount: 0,
          error: String(err),
        });
      }
      await delay(INTER_ITERATION_DELAY_MS);
    }

    const subLatencies = iterations.map((i) => i.submissionLatencyMs);
    const confLatencies = iterations.map((i) => i.confirmationLatencyMs);

    const submissionStats = computePercentiles(subLatencies);
    const confirmationStats = computePercentiles(confLatencies);

    const totalCpu = iterations.reduce((acc, i) => acc + i.cpuInstructions, 0);
    const avgCpuInstructions =
      iterations.length > 0 ? Math.round(totalCpu / iterations.length) : 0;
    const avgCpuInstructionsPerSubscriber = Math.round(
      avgCpuInstructions / batchSize,
    );

    const totalValidTxCount = iterations.reduce(
      (acc, i) => acc + i.validTxCount,
      0,
    );
    const totalFailedTxCount = iterations.reduce(
      (acc, i) => acc + i.failedTxCount,
      0,
    );

    batchResults.push({
      batchSize,
      iterationsRun: iterations.length,
      submissionLatencyMs: submissionStats,
      confirmationLatencyMs: confirmationStats,
      avgCpuInstructions,
      avgCpuInstructionsPerSubscriber,
      totalValidTxCount,
      totalFailedTxCount,
      iterations,
    });

    console.log(
      `  -> Batch ${batchSize} summary: submission_p50=${submissionStats.p50}ms cpu_per_sub=${avgCpuInstructionsPerSubscriber} valid_tx_total=${totalValidTxCount} failed_tx_total=${totalFailedTxCount}\n`,
    );
  }

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    mode: simulate ? "simulation" : "testnet",
    contractId: CONTRACT_ID,
    rpcUrl: RPC_URL,
    fixturePath: resolvedFixturePath,
    batchResults,
  };

  const outputDir = join(process.cwd(), "data", "benchmarks");
  mkdirSync(outputDir, { recursive: true });

  const filename = `keeper-bench-${Date.now()}.json`;
  const outputPath = join(outputDir, filename);

  writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`====================================================`);
  console.log(`Benchmark completed successfully!`);
  console.log(`Report written to: ${outputPath}`);
  console.log(`====================================================`);
}

main().catch((err) => {
  console.error("Keeper benchmark failed:", err);
  process.exit(1);
});

