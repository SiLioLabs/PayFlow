import { promises as fs } from 'fs';
import * as path from 'path';
import { fetchLedgerEvents } from './indexer';

export interface Options {
  startLedger?: number;
  endLedger: number;
  checkpointFile?: string;
  dataFile?: string;
  rateLimitPerSecond?: number;
}

export async function backfillEvents(opts: Options) {
  const cp = path.resolve(opts.checkpointFile ?? '.checkpoint.json');
  const data = path.resolve(opts.dataFile ?? '.events.json');
  const checkpoint = await readJson(cp);
  const start = opts.startLedger ?? (checkpoint?.last ?? 0) + 1;
  const end = opts.endLedger;
  const store = (await readJson(data)) ?? {};
  const delay = 1000 / (opts.rateLimitPerSecond ?? 10);
  let upserts = 0;

  for (let ledger = start; ledger <= end; ledger++) {
    await sleep(delay);
    const events = await fetchLedgerEvents(ledger);
    for (const event of events) {
      const id = String(event.id ?? `${ledger}:${event.sequence ?? 0}`);
      if (!store[id]) {
        store[id] = event;
        upserts++;
      }
    }
    await writeJson(cp, { last: ledger, updatedAt: new Date().toISOString() });
  }

  await writeJson(data, store);
  return { processedLedgers: end - start + 1, upsertedEvents: upserts };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function readJson(file: string): Promise<any> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return undefined; }
}

async function writeJson(file: string, value: any): Promise<void> {
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}
