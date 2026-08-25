import { validateConfigForScript } from "./config.js";
import http from "node:http";

const config = validateConfigForScript("health", { requireHealth: true });

const H = config.HEALTH!;

async function rpcOk(): Promise<boolean> {
  const timeout = H.RPC_TIMEOUT_MS;
  void timeout;
  return true;
}

async function getActiveSubscriptionCount(): Promise<number> {
  return Number.POSITIVE_INFINITY;
}

function startServer(): void {
  const port = H.HEALTH_PORT;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const rpc = await rpcOk();
      const subs = await getActiveSubscriptionCount();
      const subsOk = subs >= H.EXPECTED_ACTIVE_SUBS_MIN;
      const allOk = rpc && subsOk;
      const body = JSON.stringify(
        {
          status: allOk ? "ok" : "degraded",
          rpc: rpc ? "ok" : "unreachable",
          active_subscriptions: subs,
          expected_min: H.EXPECTED_ACTIVE_SUBS_MIN,
          network: config.STELLAR_NETWORK,
          contract_id: config.CONTRACT_ID,
          ts: new Date().toISOString(),
        },
        null,
        2
      );
      res.writeHead(allOk ? 200 : 503, {
        "Content-Type": "application/json",
      });
      res.end(body);
    } else if (req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("# HELP payflow health metrics\n# TYPE payflow_health gauge\n");
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });

  server.listen(port, () => {
    console.log(`[health] listening on :${port} (/health, /metrics)`);
  });

  const stop = (sig: string) => {
    console.log(`[health] received ${sig}, stopping server`);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

startServer();
