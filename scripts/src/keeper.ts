import { validateConfigForScript } from "./config.js";

const config = validateConfigForScript("keeper", { requireKeeper: true });

async function runKeeper(): Promise<void> {
  const { RPC_URL, CONTRACT_ID, STELLAR_NETWORK, KEEPER } = config;
  const K = KEEPER!;
  const interval = K.POLL_INTERVAL_MS;
  const batchSize = K.MAX_BATCH_SIZE;

  console.log(
    `[keeper] starting on ${STELLAR_NETWORK} rpc=${RPC_URL.slice(0, 32)}... contract=${CONTRACT_ID.slice(0, 8)}...`
  );
  console.log(`[keeper] batch_size=${batchSize} poll=${interval}ms dry_run=${K.DRY_RUN}`);

  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    console.log(`[keeper] tick=${tick} collecting subscribers to charge...`);
  }, interval);

  const onShutdown = (signal: string) => {
    console.log(`[keeper] received ${signal}, shutting down`);
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGINT", () => onShutdown("SIGINT"));
  process.on("SIGTERM", () => onShutdown("SIGTERM"));
}

runKeeper().catch((err) => {
  console.error("[keeper] fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
