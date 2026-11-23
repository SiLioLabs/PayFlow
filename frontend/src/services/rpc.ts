/**
 * services/rpc.ts — RPC client configuration, server management, and low-level helpers
 */

import {
  Networks,
  nativeToScVal,
  Address,
  xdr,
  TransactionBuilder,
  BASE_FEE,
  Contract,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { readCustomRpcUrl } from "../constants";

// ── Config ────────────────────────────────────────────────────────────────────

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

// Replace with your deployed contract ID after `soroban contract deploy`
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? "";
export const TOKEN_CONTRACT_ID = import.meta.env.VITE_TOKEN_CONTRACT_ID ?? "";

// Default token address (XLM) - replace with your actual token
export const DEFAULT_TOKEN =
  import.meta.env.VITE_DEFAULT_TOKEN ?? "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

export const server = new Server(RPC_URL);

/**
 * Returns a Server instance pointing at the active RPC URL.
 * If the user has saved a custom RPC URL in localStorage it takes precedence;
 * otherwise the build-time VITE_RPC_URL (or its fallback) is used.
 *
 * Every call creates a new Server instance so callers always get the latest URL.
 * For high-frequency work (polling hooks) the module-level `server` singleton is
 * still appropriate, but one-off transaction calls should prefer getServer().
 */
export function getServer(): Server {
  const customUrl = typeof localStorage !== "undefined" ? readCustomRpcUrl() : null;
  if (customUrl) return new Server(customUrl);
  return server;
}

// Horizon REST base URL for the active network.
// Mainnet ("Public Global Stellar Network ; September 2015") uses the public
// Horizon cluster; everything else falls back to the testnet cluster.
export function horizonBaseUrl(passphrase: string = NETWORK_PASSPHRASE): string {
  return passphrase === Networks.PUBLIC
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

// Stellar.expert explorer base URL for the active network.
export function explorerBaseUrl(passphrase: string = NETWORK_PASSPHRASE): string {
  const network = passphrase === Networks.PUBLIC ? "public" : "testnet";
  return `https://stellar.expert/explorer/${network}`;
}

// Stellar.expert explorer link for a transaction, on the active network.
export function explorerTxUrl(hash: string, passphrase: string = NETWORK_PASSPHRASE): string {
  return `${explorerBaseUrl(passphrase)}/tx/${hash}`;
}

export interface ContractEvent {
  eventName: string;
  address: string;
  data: unknown;
  ledger: number;
  timestamp: string;
  txHash: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Practical C-prefixed Stellar contract ID shape check */
export function isValidContractIdShape(id: string): boolean {
  return (
    typeof id === "string" && id.startsWith("C") && id.length === 56 && /^[A-Z0-9]+$/i.test(id)
  );
}

/** Convert a Stellar public key string to an ScVal Address */
export function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

export const VALIDATION_TIMEOUT_MS = 30_000;

/**
 * Execute a read-only simulated contract call with a timeout.
 */
export async function simulateContractRead(
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[],
  timeoutMs = VALIDATION_TIMEOUT_MS
): Promise<xdr.ScVal | null> {
  const s = getServer();
  const account = await s.getAccount(sourcePublicKey);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simPromise = s.simulateTransaction(tx);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Validation request timed out")), timeoutMs);
  });

  const result = await Promise.race([simPromise, timeoutPromise]);
  if ("error" in result) throw new Error(result.error);

  return (result as { result?: { retval?: xdr.ScVal } }).result?.retval ?? null;
}

/**
 * Fetch contract events by event name, optionally filtered by address.
 * eventName matches the first topic (e.g. "subscribed", "charged", "cancelled", "pay_per_use").
 */
export async function fetchEvents(
  eventName: string,
  address?: string,
  cursor?: string
): Promise<{ events: ContractEvent[]; nextCursor?: string }> {
  try {
    const s = getServer();
    const response = await s.getEvents({
      cursor,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 100,
    });

    const events = response.events
      .filter((event: any) => {
        if (!event.topic || event.topic.length < 1) return false;
        if (event.topic[0]?.toString() !== eventName) return false;
        if (address && event.topic[1]?.toString() !== address) return false;
        return true;
      })
      .map((event: any) => ({
        eventName,
        address: event.topic[1]?.toString() ?? "",
        data: event.value,
        ledger: event.ledger ?? 0,
        timestamp: event.ledgerCloseTime
          ? new Date(event.ledgerCloseTime * 1000).toISOString()
          : new Date().toISOString(),
        txHash: event.txHash ?? event.id ?? "",
      }));

    return {
      events,
      nextCursor:
        response.latestLedger > 0 && response.events.length > 0
          ? response.events[response.events.length - 1].pagingToken
          : undefined,
    };
  } catch {
    return { events: [] };
  }
}
