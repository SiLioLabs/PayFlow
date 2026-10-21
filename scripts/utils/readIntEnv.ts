/**
 * readIntEnv — Safe integer parser for environment variables.
 *
 * Reads `process.env[name]`, parses it as a base-10 integer, validates the
 * result, and returns the `fallback` when the variable is absent, empty,
 * non-numeric, or out of bounds.  An operator-visible warning is emitted to
 * stderr whenever the raw value is rejected so misconfigured deployments fail
 * loudly rather than silently.
 *
 * Issue #1304 — replaces the scattered unguarded parseInt / Number calls in
 * daemon entrypoints (metrics-server.ts, keeper.ts, batch-optimizer.ts,
 * check-allowances.ts, alert-expiring-allowances.ts).
 *
 * Usage:
 *   import { readIntEnv } from "./utils/readIntEnv.js";
 *
 *   const port = readIntEnv("METRICS_PORT", 9090, { min: 1, max: 65535 });
 *   const interval = readIntEnv("INTERVAL_SECONDS", 3600, { min: 1 });
 *   const batchSize = readIntEnv("MAX_BATCH_SIZE", 50, { min: 1, max: 200 });
 */

export interface ReadIntEnvOptions {
  /** Minimum acceptable value (inclusive). No lower bound when omitted. */
  min?: number;
  /** Maximum acceptable value (inclusive). No upper bound when omitted. */
  max?: number;
}

/**
 * Parse an environment variable as a safe integer.
 *
 * @param name     - Environment variable name.
 * @param fallback - Value returned when the variable is absent or invalid.
 * @param opts     - Optional `min` / `max` bounds applied after parsing.
 * @returns        A finite integer within the specified bounds.
 */
export function readIntEnv(
  name: string,
  fallback: number,
  opts: ReadIntEnvOptions = {},
): number {
  const raw = process.env[name];

  // Variable not set — use fallback silently (not a misconfiguration).
  if (raw === undefined || raw.trim() === "") {
    return clamp(fallback, opts);
  }

  const parsed = parseInt(raw.trim(), 10);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    process.stderr.write(
      `[readIntEnv] WARNING: ${name}=${JSON.stringify(raw)} is not a valid integer` +
        ` — using default ${fallback}\n`,
    );
    return clamp(fallback, opts);
  }

  const { min, max } = opts;

  if (min !== undefined && parsed < min) {
    process.stderr.write(
      `[readIntEnv] WARNING: ${name}=${parsed} is below minimum ${min}` +
        ` — using ${min}\n`,
    );
    return min;
  }

  if (max !== undefined && parsed > max) {
    process.stderr.write(
      `[readIntEnv] WARNING: ${name}=${parsed} exceeds maximum ${max}` +
        ` — using ${max}\n`,
    );
    return max;
  }

  return parsed;
}

/** Apply bounds to the fallback itself (ensures fallback is within range). */
function clamp(value: number, opts: ReadIntEnvOptions): number {
  let v = value;
  if (opts.min !== undefined && v < opts.min) v = opts.min;
  if (opts.max !== undefined && v > opts.max) v = opts.max;
  return v;
}
