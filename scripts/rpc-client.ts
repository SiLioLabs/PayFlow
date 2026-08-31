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

/**
 * Interface representing state of a single RPC endpoint.
 */
interface EndpointState {
  url: string;
  server: Server;
  errorCount: number;
  isHealthy: boolean;
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

  /**
   * Constructor for MultiEndpointServer.
   * Parses RPC_URLS environment variable (comma-separated list of RPC URLs) or falls
   * back to the single RPC_URL / VITE_RPC_URL environment variables, or a provided URL/URLs.
   *
   * @param singleOrList - A single URL string or an array of URL strings.
   */
  constructor(singleOrList?: string | string[]) {
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
      server: new Server(url),
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
        const networkInfo = await endpoint.server.getNetwork();
        if (networkInfo.passphrase !== this.expectedPassphrase) {
          console.error(
            `[RPC Failover] Network passphrase mismatch for ${endpoint.url}. ` +
              `Expected "${this.expectedPassphrase}", got "${networkInfo.passphrase}".`,
          );
          endpoint.isHealthy = false;
          endpoint.errorCount = 999; // Heavily deprioritize
        }
      } catch (err: any) {
        console.warn(
          `[RPC Failover] Health check/passphrase validation failed for ${endpoint.url}: ${err?.message || err}. ` +
            `Demoting this endpoint.`,
        );
        endpoint.isHealthy = false;
        endpoint.errorCount++;
      }
    });

    await Promise.all(validationPromises);
    this.sortEndpoints();
  }

  /**
   * Executes an RPC operation across configured endpoints with transparent retry and failover.
   */
  private async executeWithFailover<T>(
    operation: (server: Server) => Promise<T>,
  ): Promise<T> {
    await this.ensurePassphraseValidation();

    let lastError: any = null;
    const attemptedUrls = new Set<string>();

    while (attemptedUrls.size < this.endpoints.length) {
      this.sortEndpoints();
      const endpoint = this.endpoints.find((e) => !attemptedUrls.has(e.url));
      if (!endpoint) {
        break;
      }

      attemptedUrls.add(endpoint.url);

      try {
        const result = await operation(endpoint.server);
        // Successful call resets error count and restores health
        endpoint.errorCount = 0;
        endpoint.isHealthy = true;
        return result;
      } catch (err: any) {
        lastError = err;
        endpoint.errorCount++;
        endpoint.isHealthy = false;

        const failedUrl = endpoint.url;
        this.sortEndpoints();
        const nextEndpoint = this.endpoints.find(
          (e) => !attemptedUrls.has(e.url),
        );
        const nextUrl = nextEndpoint ? nextEndpoint.url : "none";

        console.warn(
          `[RPC Failover] Endpoint ${failedUrl} failed: ${err?.message || err}. Retrying with ${nextUrl}...`,
        );
      }
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
    return this.executeWithFailover((server) =>
      server.sendTransaction(transaction),
    );
  }

  /**
   * Submit raw transaction.
   */
  async _sendTransaction(
    transaction: Transaction | FeeBumpTransaction,
  ): Promise<Api.RawSendTransactionResponse> {
    return this.executeWithFailover((server) =>
      server._sendTransaction(transaction),
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
      console.error(`Error querying RPC events: ${err?.message || err}`);
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
