import { validateConfigForScript } from "./config.js";

const config = validateConfigForScript("indexer", { requireIndexer: true });

interface IndexedEvent {
  ledger: number;
  txHash: string;
  type: string;
  payload: Record<string, unknown>;
}

async function runIndexer(): Promise<void> {
  const { RPC_URL, CONTRACT_ID, STELLAR_NETWORK, INDEXER } = config;
  const I = INDEXER!;
  console.log(
    `[indexer] starting on ${STELLAR_NETWORK} contract=${CONTRACT_ID.slice(0, 8)}... start_ledger=${I.START_LEDGER}`
  );
  console.log(`[indexer] db=${I.DB_URL.slice(0, 24)}... batch=${I.INDEXER_BATCH_SIZE}`);

  let cursor = I.START_LEDGER;
  const backlog: IndexedEvent[] = [];

  const fetchBatch = async (from: number, size: number): Promise<IndexedEvent[]> => {
    void RPC_URL;
    void from;
    void size;
    return [];
  };

  const flush = async (events: IndexedEvent[]): Promise<void> => {
    if (events.length === 0) return;
    console.log(`[indexer] flushing ${events.length} events at ledger=${cursor}`);
    events.length = 0;
  };

  for (;;) {
    const batch = await fetchBatch(cursor, I.INDEXER_BATCH_SIZE);
    if (batch.length === 0) {
      await flush(backlog);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    backlog.push(...batch);
    cursor = Math.max(cursor, ...batch.map((b) => b.ledger)) + 1;
    if (backlog.length >= I.INDEXER_BATCH_SIZE) {
      await flush(backlog.slice(0, I.INDEXER_BATCH_SIZE));
      backlog.splice(0, I.INDEXER_BATCH_SIZE);
    }
  }
}

runIndexer().catch((err) => {
  console.error("[indexer] fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
