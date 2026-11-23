import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  /** Monotonically increasing version this migration brings the DB to. */
  version: number;
  /** Human-readable name, used for logging. */
  name: string;
  /** Apply the migration. Must be idempotent. */
  up: (db: DatabaseSync) => void;
}
