/**
 * scripts/rpc-client.ts — Thin wrapper around the Stellar RPC with
 * adaptive-fee simulation and fee-bump support.
 *
 * Adaptive fee logic (issue #1477):
 *   1. Simulate the transaction to get the network's recommended resource fee.
 *   2. Multiply by FEE_MULTIPLIER (default 1.2) to add headroom.
 *   3. If the result exceeds FEE_CEILING_STROOPS, throw so the caller can
 *      skip/DLQ the batch instead of burning funds.
 *   4. Optionally wrap the inner transaction in a fee-bump envelope signed
 *      by a separate account (FEE_BUMP_SOURCE).
 *
 * Metrics (issue #1478 / #1479):
 *   Every public method increments the relevant Prometheus counters/gauges
 *   exported by metrics-server.ts.
 */

import {
  Networks,
  TransactionBuilder,
  Transaction,
  FeeBumpTransaction,
  Keypair,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import type { ISigner } from "./config";
import {
  FEE_MULTIPLIER,
  FEE_CEILING_STROOPS,
  RPC_URL,
  NETWORK_PASSPHRASE,
} from "./config";
import {
  rpcErrorCounter,
  feeBumpCounter,
  feeSpendGauge,
  adaptiveFeeHistogram,
} from "./metrics-server";

// ── RPC server singleton ───────────────────────────────────────────────────────

export const rpcServer = new Server(RPC_URL);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SimulatedFee {
  /** Recommended resource fee in stroops after multiplier. */
  resourceFee: bigint;
  /** Whether the fee exceeds the configured ceiling. */
  exceedsCeiling: boolean;
  /** Raw fee from the simulation (before multiplier). */
  rawResourceFee: bigint;
}

export interface SendResult {
  hash: string;
  /** true when the transaction was wrapped in a fee-bump envelope. */
  feeBumped: boolean;
  /** Final resource fee paid in stroops. */
  feePaid: bigint;
}

// ── Fee calculation ───────────────────────────────────────────────────────────

/**
 * Calculate the adaptive resource fee for a simulated transaction.
 *
 * @param rawFeeStroops - The fee returned by the simulation in stroops.
 * @returns SimulatedFee with the adjusted fee and ceiling-breach flag.
 */
export function calculateAdaptiveFee(rawFeeStroops: bigint): SimulatedFee {
  const adjusted = BigInt(
    Math.ceil(Number(rawFeeStroops) * FEE_MULTIPLIER)
  );
  return {
    resourceFee: adjusted,
    exceedsCeiling: adjusted > FEE_CEILING_STROOPS,
    rawResourceFee: rawFeeStroops,
  };
}

// ── Core simulation + send ────────────────────────────────────────────────────

/**
 * simulateAndAssemble — simulates a transaction and returns the assembled XDR
 * with auth entries attached plus the adaptive fee information.
 *
 * @param txXdr - The unsigned transaction XDR to simulate.
 * @returns Assembled transaction XDR and fee info.
 */
export async function simulateAndAssemble(
  txXdr: string
): Promise<{ assembledXdr: string; feeInfo: SimulatedFee }> {
  const tx = new Transaction(txXdr, NETWORK_PASSPHRASE);

  let simResult;
  try {
    simResult = await rpcServer.simulateTransaction(tx);
  } catch (err) {
    rpcErrorCounter.inc({ operation: "simulate" });
    throw err;
  }

  if ("error" in simResult) {
    rpcErrorCounter.inc({ operation: "simulate" });
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Extract the raw resource fee from the simulation response
  const rawFee = BigInt(
    (simResult as any).minResourceFee ??
      (simResult as any).cost?.resourceFee ??
      BASE_FEE
  );

  const feeInfo = calculateAdaptiveFee(rawFee);

  // Record histogram observation (in XLM-equivalent micro-units, i.e. stroops)
  adaptiveFeeHistogram.observe(Number(feeInfo.resourceFee));

  if (feeInfo.exceedsCeiling) {
    throw new Error(
      `Adaptive fee ${feeInfo.resourceFee} stroops exceeds ceiling ` +
        `${FEE_CEILING_STROOPS} stroops. Skipping transaction.`
    );
  }

  const assembled = assembleTransaction(tx, simResult) as unknown as {
    toXDR(): string;
  };
  return { assembledXdr: assembled.toXDR(), feeInfo };
}

/**
 * signAndSend — signs the assembled XDR with the provided ISigner, optionally
 * wraps it in a fee-bump envelope, and submits to the network.
 *
 * @param assembledXdr - The assembled (ready-to-sign) transaction XDR.
 * @param signer       - The ISigner implementation.
 * @param feeInfo      - Fee info returned by simulateAndAssemble.
 * @param feeBumpKeypair - Optional Keypair for the fee-bump source account.
 * @returns SendResult with the transaction hash and fee-bump flag.
 */
export async function signAndSend(
  assembledXdr: string,
  signer: ISigner,
  feeInfo: SimulatedFee,
  feeBumpKeypair?: Keypair
): Promise<SendResult> {
  // Sign the inner transaction
  const signedXdr = await signer.sign(assembledXdr, NETWORK_PASSPHRASE);
  const signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);

  let txToSubmit: Transaction | FeeBumpTransaction = signedTx;
  let feeBumped = false;

  // Optionally wrap in a fee-bump envelope
  if (feeBumpKeypair) {
    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      feeBumpKeypair,
      // fee-bump max fee = 10× the inner resource fee (industry convention)
      (Number(feeInfo.resourceFee) * 10).toString(),
      signedTx,
      NETWORK_PASSPHRASE
    );
    feeBumpTx.sign(feeBumpKeypair);
    txToSubmit = feeBumpTx;
    feeBumped = true;
    feeBumpCounter.inc();
  }

  let result;
  try {
    result = await rpcServer.sendTransaction(txToSubmit);
  } catch (err) {
    rpcErrorCounter.inc({ operation: "send" });
    throw err;
  }

  if (result.status === "ERROR") {
    rpcErrorCounter.inc({ operation: "send" });
    throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`);
  }

  // Record the fee spend
  feeSpendGauge.set(Number(feeInfo.resourceFee));

  return {
    hash: result.hash,
    feeBumped,
    feePaid: feeInfo.resourceFee,
  };
}

// ── Convenience helper ────────────────────────────────────────────────────────

/**
 * simulateAssembleSignAndSend — convenience function that chains
 * simulateAndAssemble → signAndSend for callers that don't need
 * the intermediate result.
 */
export async function simulateAssembleSignAndSend(
  txXdr: string,
  signer: ISigner,
  feeBumpKeypair?: Keypair
): Promise<SendResult> {
  const { assembledXdr, feeInfo } = await simulateAndAssemble(txXdr);
  return signAndSend(assembledXdr, signer, feeInfo, feeBumpKeypair);
}

// ── EnvSigner (default ISigner) ───────────────────────────────────────────────

/**
 * EnvSigner — ISigner backed by a Stellar Keypair loaded in-process.
 * For KMS/HSM use cases, provide your own class that satisfies ISigner.
 */
export class EnvSigner implements ISigner {
  private readonly keypair: Keypair;

  constructor(secret: string) {
    this.keypair = Keypair.fromSecret(secret);
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  async sign(txXdr: string, networkPassphrase: string): Promise<string> {
    const tx = new Transaction(txXdr, networkPassphrase);
    tx.sign(this.keypair);
    return tx.toXDR();
  }
}
