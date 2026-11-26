/**
 * Standalone mock Soroban RPC server used by the Docker smoke test
 * (.github/workflows/docker-smoke.yml) and for local dry-run testing.
 *
 * It speaks just enough JSON-RPC for the keeper, indexer and metrics server
 * to complete a full startup / cycle / shutdown against it, with no network
 * access:
 *
 *   getNetwork            → testnet passphrase (validated by rpc-client)
 *   getHealth             → { status: "healthy" } (no ledger window, so the
 *                           indexer's gap check is skipped)
 *   getLatestLedger       → static sequence (indexer cursor math)
 *   getLedgerEntries      → empty (keeper falls back to defaults on 404)
 *   getEvents             → empty page (indexer advances its cursor)
 *   simulateTransaction   → canned retvals, see RETVALS below
 *
 * Canned values are deliberately inert: zero subscribers, never due, never
 * paused — the keeper finds no work to do and would never submit anything
 * even in live mode.
 *
 * Usage:
 *   MOCK_RPC_PORT=8899 npx tsx __tests__/support/mock-rpc.ts
 *
 * The server exits 0 on SIGTERM/SIGINT so CI can stop it with
 * `kill $(cat mock-rpc.pid)` and assert a clean shutdown.
 */
import { createServer, type ServerResponse } from "node:http";
import { Networks, SorobanDataBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";

/** Port the mock listens on (override with MOCK_RPC_PORT). */
const PORT = Number(process.env.MOCK_RPC_PORT ?? 8899);

const LATEST_LEDGER = 100000;
const PROTOCOL_VERSION = "22";

/**
 * Canned return values keyed by contract entrypoint. Unknown entrypoints
 * resolve to scvVoid, which every caller in the repo handles explicitly.
 */
const RETVALS: Record<string, () => xdr.ScVal> = {
  get_max_batch_size: () => nativeToScVal(50, { type: "u32" }),
  get_grace_period: () => nativeToScVal(86_400, { type: "u64" }),
  get_subscriber_count: () => nativeToScVal(0, { type: "u64" }),
  get_subscriber_page: () => xdr.ScVal.scvVec([]),
  is_contract_paused: () => nativeToScVal(false, { type: "bool" }),
  is_charge_due: () => nativeToScVal(false, { type: "bool" }),
  get_schema_version: () => nativeToScVal(1, { type: "u32" }),
};

interface JsonRpcError {
  code: number;
  message: string;
}

/**
 * Extract the invoked contract function name from a base64 transaction
 * envelope. Returns null for anything that is not a contract invocation —
 * the caller then serves scvVoid.
 */
function functionNameFromEnvelope(envelopeB64: string): string | null {
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(envelopeB64, "base64");
    let tx: xdr.Transaction;
    try {
      tx = envelope.v1().tx();
    } catch {
      // Fee-bump envelope: unwrap the inner transaction.
      tx = envelope.feeBump().tx().innerTx().v1().tx();
    }
    const op = tx.operations()[0];
    if (!op) return null;
    // Accessors below throw unless the operation really is a contract call.
    const name = op
      .body()
      .invokeHostFunctionOp()
      .hostFunction()
      .invokeContract()
      .functionName();
    return String(name);
  } catch {
    return null;
  }
}

/**
 * Raw (unparsed) simulateTransaction response — the SDK's parseRawSimulation
 * requires a valid SorobanTransactionData blob plus a base64 ScVal retval.
 */
function simulateResponse(functionName: string | null): unknown {
  const factory = functionName ? RETVALS[functionName] : undefined;
  const retval = factory ? factory() : xdr.ScVal.scvVoid();
  return {
    transactionData: new SorobanDataBuilder().build().toXDR("base64"),
    minResourceFee: "0",
    cost: { cpuInsns: "0", memBytes: "0" },
    results: [{ auth: [], xdr: retval.toXDR("base64") }],
    events: [],
    stateChanges: [],
    latestLedger: LATEST_LEDGER,
    latestLedgerCloseTime: "1700000000",
    oldestLedger: 1,
    oldestLedgerCloseTime: "1600000000",
  };
}

function handleMethod(method: string, params: unknown): unknown {
  switch (method) {
    case "getNetwork":
      return { passphrase: Networks.TESTNET, protocolVersion: PROTOCOL_VERSION };
    case "getHealth":
      // Intentionally no oldestLedger/latestLedger: fetchLedgerRange() then
      // returns null and the indexer skips its gap check.
      return { status: "healthy" };
    case "getLatestLedger":
      return {
        id: String(LATEST_LEDGER),
        sequence: LATEST_LEDGER,
        protocolVersion: PROTOCOL_VERSION,
      };
    case "getLedgerEntries":
      // Empty entries → SDK getAccount() rejects with 404, which the keeper
      // catches and turns into its configured fallbacks.
      return { latestLedger: LATEST_LEDGER, entries: [] };
    case "getEvents":
      return { latestLedger: LATEST_LEDGER, events: [] };
    case "getFeeStats":
      return { latestLedger: LATEST_LEDGER };
    case "getTransaction":
      return {
        status: "NOT_FOUND",
        txHash: "",
        ledger: 0,
        createdAt: "0",
        latestLedger: LATEST_LEDGER,
        latestLedgerCloseTime: "0",
        oldestLedger: 1,
        oldestLedgerCloseTime: "0",
      };
    case "sendTransaction":
      // The mock is read-only; nothing in the smoke test submits.
      return {
        status: "ERROR",
        hash: "",
        latestLedger: LATEST_LEDGER,
        latestLedgerCloseTime: "0",
        error: "mock-rpc is read-only",
      };
    case "simulateTransaction": {
      const p = (params ?? {}) as { transaction?: string };
      return simulateResponse(
        p.transaction ? functionNameFromEnvelope(p.transaction) : null,
      );
    }
    default:
      throw { code: -32601, message: `Method not found: ${method}` } satisfies JsonRpcError;
  }
}

function toRpcError(err: unknown): JsonRpcError {
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    "message" in err
  ) {
    return err as JsonRpcError;
  }
  return {
    code: -32000,
    message: err instanceof Error ? err.message : String(err),
  };
}

/** Always HTTP 200: the SDK inspects the body, not the status code. */
function respond(
  res: ServerResponse,
  id: unknown,
  result?: unknown,
  error?: JsonRpcError,
): void {
  const body = error
    ? { jsonrpc: "2.0", id, error }
    : { jsonrpc: "2.0", id, result };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" });
    res.end();
    return;
  }
  let raw = "";
  req.on("data", (chunk: Buffer) => {
    raw += chunk.toString("utf8");
  });
  req.on("end", () => {
    let payload: { id?: unknown; method?: unknown; params?: unknown };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      respond(res, null, undefined, { code: -32700, message: "Parse error" });
      return;
    }
    let result: unknown;
    let error: JsonRpcError | undefined;
    try {
      result = handleMethod(String(payload.method ?? ""), payload.params);
    } catch (err) {
      error = toRpcError(err);
    }
    respond(res, payload.id ?? null, error ? undefined : result, error);
  });
});

// Bind to all interfaces so containers can reach the host mock through
// host.docker.internal (loopback-only binding would break Docker smoke runs).
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock-rpc] listening on http://0.0.0.0:${PORT}`);
});

function shutdown(signal: string): void {
  console.log(`[mock-rpc] ${signal} received — shutting down`);
  server.close(() => process.exit(0));
  // Keep-alive sockets can delay close(); never hang CI on them.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
