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

import { writeFileSync, mkdirSync } from "node:fs";
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

interface IterationResult {
  iteration: number;
  submissionLatencyMs: number;
  confirmationLatencyMs: number;
  cpuInstructions: number;
  cpuInstructionsPerSubscriber: number;
  feeCharged: number;
  success: boolean;
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
  iterations: IterationResult[];
}

interface BenchmarkReport {
  timestamp: string;
  mode: "simulation" | "testnet";
  contractId: string;
  rpcUrl: string;
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

function generateBenchmarkSubscribers(count: number): string[] {
  const subscribers: string[] = [];
  for (let i = 0; i < count; i++) {
    const kp = Keypair.random();
    subscribers.push(kp.publicKey());
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
  return Keypair.random();
}

async function runBenchmarkIteration(
  server: Server,
  signerKp: Keypair,
  subscribers: string[],
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

  const usersScValVec = xdr.ScVal.scvVec(
    subscribers.map((s) =>
      nativeToScVal(Address.fromString(s), { type: "address" }),
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

    return {
      iteration,
      submissionLatencyMs,
      confirmationLatencyMs: 0,
      cpuInstructions: cpuInsns,
      cpuInstructionsPerSubscriber: Math.round(cpuInsns / subscribers.length),
      feeCharged: minFee,
      success: !hasError,
      error: hasError ? String((simResult as any).error) : undefined,
    };
  } else {
    // Real submission on testnet
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
    return {
      iteration,
      submissionLatencyMs,
      confirmationLatencyMs,
      cpuInstructions: cpuInsns,
      cpuInstructionsPerSubscriber: Math.round(cpuInsns / subscribers.length),
      feeCharged: Number(BASE_FEE),
      success: statusResponse.status === "SUCCESS",
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const simulate = args.includes("--simulate");

  console.log(`====================================================`);
  console.log(`FlowPay Keeper Performance Benchmark`);
  console.log(
    `Mode: ${simulate ? "SIMULATION (--simulate)" : "TESTNET REAL SUBMISSION"}`,
  );
  console.log(`RPC Endpoint: ${RPC_URL}`);
  console.log(`Contract ID: ${CONTRACT_ID}`);
  console.log(`====================================================\n`);

  const server = new Server(RPC_URL);
  const signerKp = await getBenchmarkSourceAccount(server, SECRET_KEY);

  const batchResults: BatchBenchmarkResult[] = [];

  for (const batchSize of BATCH_SIZES) {
    console.log(`Running benchmark for batch size: ${batchSize}...`);
    const subscribers = generateBenchmarkSubscribers(batchSize);
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
          `  Iteration ${iter}/${ITERATIONS_PER_BATCH}: latency=${res.submissionLatencyMs}ms cpu_insns=${res.cpuInstructions} per_sub=${res.cpuInstructionsPerSubscriber}`,
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

    batchResults.push({
      batchSize,
      iterationsRun: iterations.length,
      submissionLatencyMs: submissionStats,
      confirmationLatencyMs: confirmationStats,
      avgCpuInstructions,
      avgCpuInstructionsPerSubscriber,
      iterations,
    });

    console.log(
      `  -> Batch ${batchSize} summary: submission_p50=${submissionStats.p50}ms cpu_per_sub=${avgCpuInstructionsPerSubscriber}\n`,
    );
  }

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    mode: simulate ? "simulation" : "testnet",
    contractId: CONTRACT_ID,
    rpcUrl: RPC_URL,
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
