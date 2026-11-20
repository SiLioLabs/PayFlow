/**
 * db/store.ts — Storage backends for the event indexer (#1484).
 *
 * The indexer talks to an `IndexerStore`. Two implementations share the same
 * schema (events + meta), the same `schema_version` migrations and the same
 * upsert semantics (`ON CONFLICT(id) DO UPDATE`):
 *
 *   - SqliteStore   — the embedded node:sqlite file (default, unchanged).
 *   - PostgresStore — selected when DATABASE_URL is a postgres:// URL.
 *
 * `openIndexerStore()` picks the backend from the environment.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Pool, PoolClient } from "pg";
import {
  initSchema,
  getMeta,
  setMeta,
  upsertEvents,
  openDatabase,
  SCHEMA_VERSION,
  type IndexedEvent,
} from "../indexer.js";

export interface IndexerStore {
  readonly kind: "sqlite" | "postgres";
  /** Create tables / apply pending migrations. Idempotent. */
  init(): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** Upsert in one transaction; returns rows written. */
  upsertEvents(events: IndexedEvent[]): Promise<number>;
  close(): Promise<void>;
}

// ── SQLite ────────────────────────────────────────────────────────────────────

export class SqliteStore implements IndexerStore {
  readonly kind = "sqlite" as const;
  constructor(readonly db: DatabaseSync) {}

  static open(filePath: string): SqliteStore {
    return new SqliteStore(openDatabase(filePath));
  }

  async init(): Promise<void> {
    initSchema(this.db);
  }
  async getMeta(key: string): Promise<string | null> {
    return getMeta(this.db, key);
  }
  async setMeta(key: string, value: string): Promise<void> {
    setMeta(this.db, key, value);
  }
  async upsertEvents(events: IndexedEvent[]): Promise<number> {
    return upsertEvents(this.db, events);
  }
  async close(): Promise<void> {
    this.db.close();
  }
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────

/**
 * Same columns as the SQLite schema. ledger/timestamp are BIGINT (SQLite
 * INTEGER is 64-bit); amounts stay TEXT because they are i128.
 */
const PG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id          TEXT   PRIMARY KEY,
    event_name  TEXT   NOT NULL,
    address     TEXT   NOT NULL,
    amount      TEXT,
    ledger      BIGINT NOT NULL,
    timestamp   BIGINT NOT NULL,
    tx_hash     TEXT   NOT NULL,
    raw_data    TEXT   NOT NULL,
    merchant    TEXT,
    fee_amount  TEXT,
    token       TEXT,
    result_code TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_address    ON events(address);
  CREATE INDEX IF NOT EXISTS idx_events_event_name ON events(event_name);
  CREATE INDEX IF NOT EXISTS idx_events_ledger     ON events(ledger);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
`;

/** Ordered migrations from the stored schema_version (mirrors initSchema). */
const PG_MIGRATIONS: Record<number, string> = {
  // v1 → v2: decoded columns.
  2: `
    ALTER TABLE events ADD COLUMN IF NOT EXISTS merchant TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS fee_amount TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS token TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS result_code TEXT;
  `,
};

const PG_UPSERT_SQL = `
  INSERT INTO events(id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount, token, result_code)
  VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT(id) DO UPDATE SET
    address     = excluded.address,
    amount      = excluded.amount,
    ledger      = excluded.ledger,
    timestamp   = excluded.timestamp,
    tx_hash     = excluded.tx_hash,
    raw_data    = excluded.raw_data,
    merchant    = excluded.merchant,
    fee_amount  = excluded.fee_amount,
    token       = excluded.token,
    result_code = excluded.result_code
`;

export interface PostgresStoreOptions {
  /** Optional schema (search_path) to keep the tables in; created if missing. */
  schema?: string;
}

export class PostgresStore implements IndexerStore {
  readonly kind = "postgres" as const;

  private constructor(
    private readonly pool: Pool,
    private readonly schema?: string,
  ) {}

  static async connect(databaseUrl: string, options: PostgresStoreOptions = {}): Promise<PostgresStore> {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    const schema = options.schema;
    if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Invalid Postgres schema name: ${schema}`);
    return new PostgresStore(pool, schema);
  }

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      if (this.schema) await client.query(`SET search_path TO ${this.schema}`);
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async init(): Promise<void> {
    await this.tx(async (c) => {
      // Serialise concurrent initialisers (e.g. two indexer replicas starting).
      await c.query("SELECT pg_advisory_xact_lock(hashtext('payflow_indexer_schema'))");
      if (this.schema) {
        await c.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
        await c.query(`SET LOCAL search_path TO ${this.schema}`);
      }
      await c.query(PG_SCHEMA_SQL);

      const row = await c.query<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
      const current = row.rows[0] ? parseInt(row.rows[0].value, 10) : null;
      if (current !== null) {
        for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
          if (PG_MIGRATIONS[v]) await c.query(PG_MIGRATIONS[v]);
        }
      }
      if (current === null || current < SCHEMA_VERSION) {
        await c.query(
          `INSERT INTO meta(key, value) VALUES('schema_version', $1)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [String(SCHEMA_VERSION)],
        );
      }
    });
  }

  async getMeta(key: string): Promise<string | null> {
    return this.tx(async (c) => {
      const r = await c.query<{ value: string }>("SELECT value FROM meta WHERE key = $1", [key]);
      return r.rows[0]?.value ?? null;
    });
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.tx((c) =>
      c.query("INSERT INTO meta(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]),
    );
  }

  async upsertEvents(events: IndexedEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    await this.tx(async (c) => {
      for (const e of events) {
        await c.query(PG_UPSERT_SQL, [
          e.id, e.event_name, e.address, e.amount, e.ledger, e.timestamp,
          e.tx_hash, e.raw_data, e.merchant, e.fee_amount, e.token, e.result_code,
        ]);
      }
    });
    return events.length;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────

export function isPostgresUrl(url: string | undefined): url is string {
  return !!url && /^postgres(ql)?:\/\//i.test(url);
}

/** Strip credentials from a connection URL for logging. */
export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<invalid DATABASE_URL>";
  }
}

/**
 * DATABASE_URL=postgres://… selects PostgreSQL; otherwise the SQLite file at
 * `sqliteFile` is used.
 */
export async function openIndexerStore(
  sqliteFile: string,
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<IndexerStore> {
  if (databaseUrl && !isPostgresUrl(databaseUrl)) {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// URL (unset it to use SQLite)");
  }
  return isPostgresUrl(databaseUrl) ? PostgresStore.connect(databaseUrl) : SqliteStore.open(sqliteFile);
}
