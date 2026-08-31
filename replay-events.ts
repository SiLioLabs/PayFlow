import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import { setTimeout as sleep } from 'timers/promises';

const RPC_URL = process.env.RPC_URL!;
const DATABASE_URL_= process.env.DATABASE_URL;
const START = Number(process.env.START_LEDGER!);
const END = Number(process.env.END_LEDGER!);
const CHECKPOINT = process.env.CHECKPOINT_FILE || path.join(process.cwd(), '.replay-checkpoint.json');
const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS ?? 100);

async function getEvents(rpcUrl: string, ledger: number): Promise<any[]> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getEvents', params: [{ startLedger: ledger, endLedger: ledger }] }),
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message);
  let events = data.result?.events ?? [];
  let cursor = data.result?.cursor;
  while (cursor) {
    const res2 = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getEvents', params: [{ startLedger: ledger, endLedger: ledger, cursor }] }),
    });
    const data2: any = await res2.json();
    events = events.concat(data2.result?.events ?? []);
    cursor = data2.result?.cursor;
  }
  return events;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  let last = null;
  try {
    const raw = await readFile(CHECKPOINT, 'utf-8');
    last = JSON.parse(raw).last;
  } catch {}
  const start = last === null ? START : last + 1;
  if (start > END) { console.log('Already backfilled'); await pool.end(); return; }

  for (let ledger = start; ledger <= END; ledger++) {
    await sleep(RATE_LIMIT_MS);
    const events = await getEvents(RPC_URL, ledger);
    for (const e of events) {
      // Idempotent upsert: assume primary key is id
      await pool.query(
        'INSERT INTO events (id, ledger, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [e.id, ledger, JSON.stringify(e)]
      );
    }
    await mkdiv(path.dirname(CHECKPOINT), { recursive: true });
    await writeFile(CHECKPOINT + '.tmp', JSON.stringify({ last: ledger }));
    await rename(CHECKPOINT + '.tmp', CHECKPOINT);
    console.log(`Processed ledger ${ledger}, events=${events.length});
  }
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
