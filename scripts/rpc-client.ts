import {
  Account,
  Address,
  Contract,
  FeeBumpTransaction,
  Transaction,
  xdr,
  Networks,
} from "@stellar/stellar-sdk";
import { Server, Durability, Api } from "@stellar/stellar-sdk/rpc";
import { incrementRpcFailovers } from "./metrics-server";
import { logger as rootLogger } from "./logger.js";

const logger = rootLogger.child({ script: "rpc-client" });

/** Default HTTP timeout for every Soroban RPC request (milliseconds). */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/**
 * Extra attempts of an idempotent RPC call against the same endpoint after the
 * first failure. `sendTransaction` never uses this value (see submit path).
 */
export const DEFAULT_RPC_RETRY_COUNT = 2;

export interface RpcClientOptions {
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  /**
   * Additional retries of idempotent calls on the same endpoint after the
   * first failure. Must not be applied to `sendTransaction`.
   */
  retryCount?: number;
}

/**
 * Interface representing state of a single RPC endpoint.
 */
interface EndpointState {
  url: string;
  server: Server;
  /** Same endpoint, SDK retries disabled — used only for sendTransaction. */
  submitServer: Server;
  errorCount: number;
  isHealthy: boolean;
}

export interface FailoverExecuteOptions {
  /**
   * When true, a signed transaction may already have been accepted by the
   * endpoint. Fail over only when the request is known not to have been sent.
   */
  submit?: boolean;
}

function parseNonNegativeInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw == null || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseNonNegativeInt(raw, fallback);
  return parsed > 0 ? parsed : fallback;
}

/**
 * Script stem used for per-process timeout overrides, e.g. `indexer.ts`
 * → `INDEXER_RPC_TIMEOUT_MS`.
 */
export function runningScriptEnvPrefix(
  entryPath = process.argv[1],
): string | undefined {
  if (!entryPath) {
    return undefined;
  }
  const base = entryPath.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.(cjs|mjs|js|ts)$/i, "");
  if (!stem) {
    return undefined;
  }
  return stem.replace(/-/g, "_").toUpperCase();
}

/**
 * Resolve RPC HTTP bounds from the environment.
 *
 * Precedence for timeout:
 *   1. `options.timeout`
 *   2. `<SCRIPT>_RPC_TIMEOUT_MS` (script basename, hyphens → underscores)
 *   3. `RPC_TIMEOUT_MS`
 *   4. {@link DEFAULT_RPC_TIMEOUT_MS}
 *
 * Retry count uses the same pattern with `RPC_RETRY_COUNT` /
 * `<SCRIPT>_RPC_RETRY_COUNT`.
 *
 * Each operational script is its own process, so operators also configure
 * timeout per systemd/compose service via `RPC_TIMEOUT_MS` alone.
 */
export function resolveRpcClientOptions(
  options: RpcClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  entryPath = process.argv[1],
): Required<RpcClientOptions> {
  const prefix = runningScriptEnvPrefix(entryPath);
  const timeout = parsePositiveInt(
    options.timeout != null
      ? String(options.timeout)
      : (prefix && env[`${prefix}_RPC_TIMEOUT_MS`]) || env.RPC_TIMEOUT_MS,
    DEFAULT_RPC_TIMEOUT_MS,
  );
  const retryCount = parseNonNegativeInt(
    options.retryCount != null
      ? String(options.retryCount)
      : (prefix && env[`${prefix}_RPC_RETRY_COUNT`]) || env.RPC_RETRY_COUNT,
    DEFAULT_RPC_RETRY_COUNT,
  );
  return { timeout, retryCount };
}

/**
 * Reject if `promise` does not settle within `timeoutMs`. The underlying
 * request may still be in flight; callers must not retry non-idempotent work
 * after a timeout.
 */
export async function withRpcTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "RPC request",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Construct a Soroban RPC `Server` with a bounded timeout and retry count.
 * This is the only place operational scripts should call `new Server(...)`.
 *
 * `retryCount` is forwarded for SDK / HTTP-client compatibility. Idempotent
 * retries are also enforced in {@link MultiEndpointServer}; submit calls use
 * retryCount `0` so a signed transaction is not double-submitted.
 */
export function createBoundedRpcServer(
  url: string,
  options: Required<RpcClientOptions>,
): Server {
  const allowHttp = url.startsWith("http://");
  const server = new Server(url, {
    timeout: options.timeout,
    retryCount: options.retryCount,
    allowHttp,
  } as ConstructorParameters<typeof Server>[1] & { retryCount: number });

  const httpClient = (
    server as Server & {
      httpClient?: { defaults?: { timeout?: number } };
    }
  ).httpClient;
  if (httpClient?.defaults) {
    httpClient.defaults.timeout = options.timeout;
  }
  return server;
}

/**
 * Errors that mean the HTTP request never left this process, so retrying
 * `sendTransaction` on another endpoint cannot double-submit.
 */
export function isSafeToFailoverSubmit(err: unknown): boolean {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const message = err instanceof Error ? err.message : String(err);
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("timed out after")) {
    return false;
  }
  if (
    combined.includes("timeout") ||
    combined.includes("aborted") ||
    combined.includes("econnreset") ||
    combined.includes("socket hang up")
  ) {
    return false;
  }

  return (
    combined.includes("enotfound") ||
    combined.includes("econnrefused") ||
    combined.includes("eai_again") ||
    combined.includes("enetunreach") ||
    combined.includes("ehostunreach") ||
    combined.includes("getaddrinfo")
  );
}

/**
 * MultiEndpointServer is a resilient wrapper around the Stellar Soroban RPC Server.
 * It manages multiple RPC endpoints, provides transparent failover and retry logic,
 * performs passphrase and health checks, and deprioritizes consistently failing endpoints.
 */
export class MultiEndpointServer {
  private endpoints: EndpointState[] = [];
  private expectedPassphrase: string;
  private hasValidatedPassphrase = false;
  private readonly timeout: number;
  private readonly retryCount: number;

  /**
   * Constructor for MultiEndpointServer.
   * Parses RPC_URLS environment variable (comma-separated list of RPC URLs) or falls
   * back to a constructor URL/URLs, then RPC_URL / VITE_RPC_URL.
   *
   * When `RPC_URLS` is set it wins over the constructor argument — do not pass
   * `process.env.RPC_URL` into the constructor (that plumbing is redundant).
   * Pass a URL only for CLI / manifest overrides when `RPC_URLS` is unset.
   *
   * @param singleOrList - A single URL string or an array of URL strings.
   * @param options - Optional timeout / retry overrides for this process.
   */
  constructor(
    singleOrList?: string | string[],
    options: RpcClientOptions = {},
  ) {
    const resolved = resolveRpcClientOptions(options);
    this.timeout = resolved.timeout;
    this.retryCount = resolved.retryCount;

    let urls: string[] = [];

    // Prioritize RPC_URLS environment variable if present
    const envUrls = process.env.RPC_URLS;
    if (envUrls) {
      urls = envUrls
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);
    }

    // If environment variable is not set, look at passed argument
    if (urls.length === 0 && singleOrList) {
      if (Array.isArray(singleOrList)) {
        urls = singleOrList;
      } else {
        urls = [singleOrList];
      }
    }

    // Fall back to RPC_URL or VITE_RPC_URL if still empty
    if (urls.length === 0) {
      const fallback =
        process.env.RPC_URL ||
        process.env.VITE_RPC_URL ||
        "https://soroban-testnet.stellar.org";
      urls = [fallback];
    }

    this.expectedPassphrase =
      process.env.NETWORK_PASSPHRASE ||
      process.env.VITE_NETWORK_PASSPHRASE ||
      Networks.TESTNET;

    this.endpoints = urls.map((url) => ({
      url,
      server: createBoundedRpcServer(url, {
        timeout: this.timeout,
        retryCount: this.retryCount,
      }),
      submitServer: createBoundedRpcServer(url, {
        timeout: this.timeout,
        retryCount: 0,
      }),
      errorCount: 0,
      isHealthy: true,
    }));
  }

  /**
   * Sorts the endpoints so that healthy ones with fewer errors are tried first.
   */
  private sortEndpoints(): void {
    this.endpoints.sort((a, b) => {
      if (a.isHealthy !== b.isHealthy) {
        return a.isHealthy ? -1 : 1;
      }
      return a.errorCount - b.errorCount;
    });
  }

  /**
   * Validates the network passphrase of all configured endpoints on first use.
   * If any endpoint doesn't match the expected network passphrase, it is marked unhealthy.
   */
  private async ensurePassphraseValidation(): Promise<void> {
    if (this.hasValidatedPassphrase) {
      return;
    }
    this.hasValidatedPassphrase = true;

    const validationPromises = this.endpoints.map(async (endpoint) => {
      try {
        const networkInfo = await withRpcTimeout(
          endpoint.server.getNetwork(),
          this.timeout,
          `getNetwork ${endpoint.url}`,
        );
        if (networkInfo.passphrase !== this.expectedPassphrase) {
          logger.error("Network passphrase mismatch — endpoint demoted", {
            url: endpoint.url,
            expected: this.expectedPassphrase,
            got: networkInfo.passphrase,
          });
          endpoint.isHealthy = false;
          endpoint.errorCount = 999; // Heavily deprioritize
        }
      } catch (err: any) {
        logger.warn("Health check / passphrase validation failed — endpoint demoted", {
          url: endpoint.url,
          error: err?.message ?? String(err),
        });
        endpoint.isHealthy = false;
        endpoint.errorCount++;
      }
    });

    await Promise.all(validationPromises);
    this.sortEndpoints();
  }

  private async invokeBounded<T>(
    endpoint: EndpointState,
    operation: (server: Server) => Promise<T>,
    label: string,
    submit = false,
  ): Promise<T> {
    return withRpcTimeout(
      operation(submit ? endpoint.submitServer : endpoint.server),
      this.timeout,
      `${label} ${endpoint.url}`,
    );
  }

  /**
   * Executes an RPC operation across configured endpoints with transparent retry and failover.
   *
   * Idempotent calls retry `retryCount` extra times on the same endpoint, then
   * fail over. Submit calls (`sendTransaction`) never retry the same signed
   * payload after a possible send — including timeouts.
   */
  private async executeWithFailover<T>(
    operation: (server: Server) => Promise<T>,
    executeOptions: FailoverExecuteOptions = {},
    label = "RPC request",
  ): Promise<T> {
    await this.ensurePassphraseValidation();

    const submit = executeOptions.submit === true;
    const sameEndpointRetries = submit ? 0 : this.retryCount;

    let lastError: any = null;
    const attemptedUrls = new Set<string>();

    while (attemptedUrls.size < this.endpoints.length) {
      this.sortEndpoints();
      const endpoint = this.endpoints.find((e) => !attemptedUrls.has(e.url));
      if (!endpoint) {
        break;
      }

      attemptedUrls.add(endpoint.url);

      for (let attempt = 0; attempt <= sameEndpointRetries; attempt++) {
        try {
          const result = await this.invokeBounded(
            endpoint,
            operation,
            label,
            submit,
          );
          endpoint.errorCount = 0;
          endpoint.isHealthy = true;
          return result;
        } catch (err: any) {
          lastError = err;
          if (attempt < sameEndpointRetries) {
            console.warn(
              `[RPC Retry] ${label} on ${endpoint.url} failed (attempt ${attempt + 1}/${sameEndpointRetries + 1}): ${err?.message || err}`,
            );
            continue;
          }
        }
      }

      endpoint.errorCount++;
      endpoint.isHealthy = false;

      const failedUrl = endpoint.url;
      const canFailover = submit ? isSafeToFailoverSubmit(lastError) : true;
      if (!canFailover) {
        console.warn(
          `[RPC Failover] Endpoint ${failedUrl} failed after a possible submit: ${lastError?.message || lastError}. Not retrying sendTransaction.`,
        );
        throw lastError || new Error("RPC submit failed.");
        logger.warn("RPC endpoint failed — failing over", {
          failed_url: failedUrl,
          next_url: nextUrl,
          error: err?.message ?? String(err),
        });
        incrementRpcFailovers();
      }

      this.sortEndpoints();
      const nextEndpoint = this.endpoints.find(
        (e) => !attemptedUrls.has(e.url),
      );
      const nextUrl = nextEndpoint ? nextEndpoint.url : "none";

      console.warn(
        `[RPC Failover] Endpoint ${failedUrl} failed: ${lastError?.message || lastError}. Retrying with ${nextUrl}...`,
      );
      incrementRpcFailovers();
    }

    throw lastError || new Error("All configured RPC endpoints failed.");
  }

  /**
   * Fetch a minimal set of current info about a Stellar account.
   */
  async getAccount(address: string): Promise<Account> {
    return this.executeWithFailover((server) => server.getAccount(address));
  }

  /**
   * General node health check.
   */
  async getHealth(): Promise<Api.GetHealthResponse> {
    return this.executeWithFailover((server) => server.getHealth());
  }

  /**
   * Reads the current value of contract data ledger entries directly.
   */
  async getContractData(
    contract: string | Address | Contract,
    key: xdr.ScVal,
    durability?: Durability,
  ): Promise<Api.LedgerEntryResult> {
    return this.executeWithFailover((server) =>
      server.getContractData(contract, key, durability),
    );
  }

  /**
   * Retrieves the WASM bytecode for a given contract.
   */
  async getContractWasmByContractId(contractId: string): Promise<Buffer> {
    return this.executeWithFailover((server) =>
      server.getContractWasmByContractId(contractId),
    );
  }

  /**
   * Retrieves the WASM bytecode for a given contract hash.
   */
  async getContractWasmByHash(
    wasmHash: Buffer | string,
    format?: undefined | "hex" | "base64",
  ): Promise<Buffer> {
    return this.executeWithFailover((server) =>
      server.getContractWasmByHash(wasmHash, format),
    );
  }

  /**
   * Reads the current value of arbitrary ledger entries directly.
   */
  async getLedgerEntries(
    ...keys: xdr.LedgerKey[]
  ): Promise<Api.GetLedgerEntriesResponse> {
    return this.executeWithFailover((server) =>
      server.getLedgerEntries(...keys),
    );
  }

  /**
   * Reads raw ledger entries.
   */
  async _getLedgerEntries(
    ...keys: xdr.LedgerKey[]
  ): Promise<Api.RawGetLedgerEntriesResponse> {
    return this.executeWithFailover((server) =>
      server._getLedgerEntries(...keys),
    );
  }

  /**
   * Fetch the details of a submitted transaction.
   */
  async getTransaction(hash: string): Promise<Api.GetTransactionResponse> {
    return this.executeWithFailover((server) => server.getTransaction(hash));
  }

  /**
   * Fetch raw details of a submitted transaction.
   */
  async _getTransaction(hash: string): Promise<Api.RawGetTransactionResponse> {
    return this.executeWithFailover((server) => server._getTransaction(hash));
  }

  /**
   * Fetch transactions starting from a given start ledger or a cursor.
   */
  async getTransactions(
    request: Api.GetTransactionsRequest,
  ): Promise<Api.GetTransactionsResponse> {
    return this.executeWithFailover((server) =>
      server.getTransactions(request),
    );
  }

  /**
   * Fetch all events that match a given set of filters.
   */
  async getEvents(
    request: Server.GetEventsRequest,
  ): Promise<Api.GetEventsResponse> {
    return this.executeWithFailover((server) => server.getEvents(request));
  }

  /**
   * Fetch raw events.
   */
  async _getEvents(
    request: Server.GetEventsRequest,
  ): Promise<Api.RawGetEventsResponse> {
    return this.executeWithFailover((server) => server._getEvents(request));
  }

  /**
   * Fetch metadata about the network this Soroban RPC server is connected to.
   */
  async getNetwork(): Promise<Api.GetNetworkResponse> {
    return this.executeWithFailover((server) => server.getNetwork());
  }

  /**
   * Fetch the latest ledger sequence and close time.
   */
  async getLatestLedger(): Promise<Api.GetLatestLedgerResponse> {
    return this.executeWithFailover((server) => server.getLatestLedger());
  }

  /**
   * Simulate a transaction.
   */
  async simulateTransaction(
    transaction: Transaction | FeeBumpTransaction,
  ): Promise<Api.SimulateTransactionResponse> {
    return this.executeWithFailover((server) =>
      server.simulateTransaction(transaction),
    );
  }

  /**
   * Simulate a transaction returning raw response.
   */
  async _simulateTransaction(
    transaction: Transaction | FeeBumpTransaction,
  ): Promise<Api.RawSimulateTransactionResponse> {
    return this.executeWithFailover((server) =>
      server._simulateTransaction(transaction),
    );
  }

  /**
   * Prepare a transaction.
   */
  async prepareTransaction(
    transaction: Transaction | FeeBumpTransaction,
  ): Promise<any> {
    return this.executeWithFailover((server) =>
      server.prepareTransaction(transaction),
    );
  }

  /**
   * Submit a transaction to the network.
   */
  async sendTransaction(
    transaction: Transaction | FeeBumpTransaction,
  ): Promise<Api.SendTransactionResponse> {
    return this.executeWithFailover(
      (server) => server.sendTransaction(transaction),
      { submit: true },
      "sendTransaction",
    );
  }

  /**
   * Submit raw transaction.
   */
  async _sendTransaction(
    transaction: Transaction | FeeBumpTransaction,
  ): Promise<Api.RawSendTransactionResponse> {
    return this.executeWithFailover(
      (server) => server._sendTransaction(transaction),
      { submit: true },
      "_sendTransaction",
    );
  }

  /**
   * Request airdrop for an address (testnet only).
   */
  async requestAirdrop(
    address: string | Pick<Account, "accountId">,
    friendbotUrl?: string,
  ): Promise<Account> {
    return this.executeWithFailover((server) =>
      server.requestAirdrop(address, friendbotUrl),
    );
  }

  /**
   * Get fee stats.
   */
  async getFeeStats(): Promise<Api.GetFeeStatsResponse> {
    return this.executeWithFailover((server) => server.getFeeStats());
  }

  /**
   * Get version info.
   */
  async getVersionInfo(): Promise<Api.GetVersionInfoResponse> {
    return this.executeWithFailover((server) => server.getVersionInfo());
  }
}

/**
 * Interface representing a parsed event from the blockchain.
 */
export interface ParsedRpcEvent {
  eventName: string;
  user: string;
  timestamp: number; // Unix timestamp in seconds
  merchant?: string;
  amount?: string;
  interval?: string;
}

/**
 * Parse a field safely from the RPC event value, supporting both
 * raw and wrapped SDK structures.
 */
function parseEventValueField(value: any, field: string): string | undefined {
  if (!value) return undefined;
  const base = value._value?.[field] ?? value[field];
  if (base == null) return undefined;
  if (typeof base === "string") return base;
  if (typeof base === "number" || typeof base === "bigint")
    return base.toString();
  if (typeof base.toString === "function") return base.toString();
  return undefined;
}

/**
 * Parse the close time of a ledger from various RPC event structures.
 */
function parseEventTime(event: any): number {
  if (typeof event.ledgerCloseTime === "number") return event.ledgerCloseTime;
  if (typeof event.ledgerCloseTime === "string")
    return Number(event.ledgerCloseTime) || 0;
  if (typeof event.timestamp === "string")
    return Math.floor(Date.parse(event.timestamp) / 1000);
  if (typeof event.ledgerClosedAt === "string")
    return Math.floor(Date.parse(event.ledgerClosedAt) / 1000);
  return Math.floor(Date.now() / 1000);
}

/**
 * Fetch and paginate all relevant contract events from the Soroban RPC.
 * This function returns a sorted list of parsed subscription and cancellation events.
 */
export async function fetchEventsFromRpc(): Promise<ParsedRpcEvent[]> {
  const contractId =
    process.env.CONTRACT_ID || process.env.VITE_CONTRACT_ID || "";

  if (!contractId) {
    throw new Error(
      "CONTRACT_ID or VITE_CONTRACT_ID environment variable is required for RPC event fallback.",
    );
  }

  const server = new MultiEndpointServer();
  const events: ParsedRpcEvent[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params: any = {
      filters: [{ type: "contract", contractIds: [contractId] }],
      limit: 1000,
    };

    if (cursor) {
      params.cursor = cursor;
    } else {
      params.startLedger = 1;
    }

    let response;
    try {
      response = await server.getEvents(params);
    } catch (err: any) {
      logger.error("Error querying RPC events", { error: err?.message ?? String(err) });
      throw err;
    }

    if (!response.events || response.events.length === 0) {
      hasMore = false;
      break;
    }

    for (const rawEvent of response.events) {
      const topic = rawEvent.topic;
      if (!topic || topic.length < 2) continue;

      const eventName = topic[0]?.toString();
      if (!eventName) continue;

      // Filter only for subscriber events
      if (
        eventName !== "subscribed" &&
        eventName !== "cancelled" &&
        eventName !== "cancelled_with_refund"
      ) {
        continue;
      }

      const user = topic[1]?.toString() || "";
      const timestamp = parseEventTime(rawEvent);

      let merchant: string | undefined;
      let amount: string | undefined;
      let interval: string | undefined;

      if (rawEvent.value) {
        merchant = parseEventValueField(rawEvent.value, "merchant");
        amount =
          parseEventValueField(rawEvent.value, "amount") ||
          parseEventValueField(rawEvent.value, "gross") ||
          parseEventValueField(rawEvent.value, "net");
        interval = parseEventValueField(rawEvent.value, "interval");
      }

      events.push({
        eventName,
        user,
        timestamp,
        merchant,
        amount,
        interval,
      });
    }

    if (response.events.length < 1000) {
      hasMore = false;
    } else {
      cursor = (response as any).cursor;
      if (!cursor) {
        hasMore = false;
      }
    }
  }

  // Sort chronologically
  return events.sort((a, b) => a.timestamp - b.timestamp);
}
