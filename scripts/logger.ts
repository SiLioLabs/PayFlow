/**
 * logger.ts — Structured logging for PayFlow scripts.
 *
 * Provides DEBUG / INFO / WARN / ERROR levels with human-readable output by
 * default, or JSON lines when `LOG_FORMAT=json` is set. Child loggers inherit
 * and merge context onto every line.
 *
 * Usage:
 *   import { logger } from "./logger.js";
 *   logger.info("starting check", { contract_id: CONTRACT_ID });
 *   const child = logger.child({ contract_id: CONTRACT_ID });
 *   child.debug("fetched page", { offset: 0, count: 50 });
 *
 * Environment:
 *   LOG_LEVEL   — minimum level to emit (debug|info|warn|error). Default: info
 *   LOG_FORMAT  — "json" for JSON lines, anything else for human text. Default: human
 *
 * ## Secret redaction
 *
 * Every message and every context value passes through {@link redactSecrets}
 * before it reaches stdout/stderr, so a secret can never be written to a log
 * file, a CI job log, or an alerting webhook — even when it is interpolated
 * into an error string by a script that has no idea it is holding a key.
 *
 * The environment variable names treated as secret are listed in
 * {@link SECRET_ENV_VARS}. Any variable whose name ends in `_SECRET`,
 * `_SECRET_KEY`, or `_PRIVATE_KEY` is treated as secret as well, so a new
 * script that invents `DEPLOYER_SECRET_KEY` is covered without touching this
 * file.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_ANSI: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

/** The literal written in place of any secret material. */
export const SECRET_MASK = "**********";

/**
 * Environment variable names whose values are treated as secret material.
 *
 * Keep this list in sync with `scripts/.env.example` — every secret-bearing
 * variable that a script under `scripts/` reads belongs here. Variables whose
 * name ends in `_SECRET`, `_SECRET_KEY`, or `_PRIVATE_KEY` are covered
 * automatically and do not need to be listed.
 */
export const SECRET_ENV_VARS: readonly string[] = [
  // Canonical keeper secret.
  "SECRET_KEY",
  // Deprecated alias of SECRET_KEY (still read by replay-dlq.ts).
  "KEEPER_SECRET",
  // Keeper secret under its benchmark-specific name.
  "KEEPER_SECRET_KEY",
  // Admin-signed operation key (soroban-admin.ts, onboard-merchant.ts).
  "ADMIN_SECRET_KEY",
  // Subscriber secret used by topup-allowance.ts.
  "USER_SECRET",
  // HMAC key for outbound webhook signatures.
  "WEBHOOK_SECRET",
  // Deployment / migration source account keys.
  "SOROBAN_SOURCE_SECRET",
  "DEPLOYER_SECRET_KEY",
  "FUNDING_SECRET_KEY",
];

/**
 * Names that are always treated as secret, whatever they are called:
 * `*_SECRET`, `*_SECRET_KEY`, `*_PRIVATE_KEY`.
 */
const SECRET_NAME_SUFFIX_RE =
  /^[A-Z0-9_]*(?:_SECRET|_SECRET_KEY|_PRIVATE_KEY)$/;

/**
 * A Stellar secret key: `S` followed by 55 base32 characters. Matched
 * anywhere in a string so an interpolated key is masked even when the
 * surrounding text does not name the variable.
 */
const STELLAR_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;

/** `NAME=value`, `NAME: value`, `"NAME":"value"` for a known secret name. */
const SECRET_ASSIGNMENT_RE = new RegExp(
  `\\b(${SECRET_ENV_VARS.join("|")})(\\s*[=:]\\s*["']?)([^"'\\s,}\\]]+)`,
  "gi",
);

/** Any `NAME=value` whose name looks like a secret, for names we do not list. */
const SECRET_LIKE_ASSIGNMENT_RE =
  /\b([A-Z0-9_]*(?:_SECRET|_SECRET_KEY|_PRIVATE_KEY))(\s*[=:]\s*["']?)([^"'\s,}\]]+)/gi;

/**
 * True when an environment variable name is treated as secret material.
 */
export function isSecretEnvVar(name: string): boolean {
  if (SECRET_ENV_VARS.includes(name)) return true;
  return SECRET_NAME_SUFFIX_RE.test(name);
}

/**
 * Replace secret material in a string with {@link SECRET_MASK}.
 *
 * Three things are masked:
 *
 *  1. The live value of any secret-bearing environment variable that is set
 *     in this process — so `Keypair.fromSecret` failures that echo the key,
 *     or a `process.env` dump, cannot leak it.
 *  2. `NAME=value` / `NAME: value` pairs whose name is secret-bearing.
 *  3. Anything shaped like a Stellar secret key (`S` + 55 base32 chars).
 *
 * @param text  The text to scrub. Non-string input is returned unchanged.
 */
export function redactSecrets(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;

  let out = text;

  // 1. Live values of secret-bearing env vars.
  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name];
    if (typeof value === "string" && value.length >= 8) {
      out = out.split(value).join(SECRET_MASK);
    }
  }

  // 2. `NAME=value` pairs for known secret names, then for secret-shaped names.
  out = out.replace(
    SECRET_ASSIGNMENT_RE,
    (match, name: string, sep: string, value: string) =>
      value.toUpperCase() === name.toUpperCase()
        ? match
        : `${name}${sep}${SECRET_MASK}`,
  );
  out = out.replace(
    SECRET_LIKE_ASSIGNMENT_RE,
    (match, name: string, sep: string, value: string) =>
      value.toUpperCase() === name.toUpperCase()
        ? match
        : `${name}${sep}${SECRET_MASK}`,
  );

  // 3. Raw Stellar secret keys.
  out = out.replace(STELLAR_SECRET_RE, SECRET_MASK);

  return out;
}

/**
 * Recursively scrub secret material out of an arbitrary log context value.
 *
 * Strings are redacted, object keys are redacted, and nested objects/arrays
 * are walked. The result stays JSON-serialisable.
 */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, current] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const safeKey = redactSecrets(key);
      out[safeKey] = redactValue(current);
    }
    return out as unknown as T;
  }
  return value;
}

function parseLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? "info").trim().toLowerCase();
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  return "info";
}

function isJsonFormat(): boolean {
  return (process.env.LOG_FORMAT ?? "").trim().toLowerCase() === "json";
}

/**
 * JSON.stringify that replaces circular references with "[Circular]" so logging
 * never throws on cyclic context objects.
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, current) => {
      if (typeof current === "bigint") {
        return current.toString();
      }
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) {
          return "[Circular]";
        }
        seen.add(current);
      }
      return current;
    },
    space,
  );
}

function normalizeContext(
  message: string,
  context?: LogContext | unknown,
): { message: string; context: LogContext } {
  if (context === undefined) {
    return { message: redactSecrets(message), context: {} };
  }
  if (
    typeof context === "object" &&
    context !== null &&
    !Array.isArray(context) &&
    !(context instanceof Error)
  ) {
    return {
      message: redactSecrets(message),
      context: redactValue(context as LogContext),
    };
  }
  if (context instanceof Error) {
    return {
      message: redactSecrets(`${message} ${context.message}`),
      context: {
        error: redactSecrets(context.message),
        stack: redactSecrets(context.stack ?? ""),
      },
    };
  }
  return {
    message: redactSecrets(`${message} ${String(context)}`),
    context: {},
  };
}

export interface Logger {
  debug(message: string, context?: LogContext | unknown): void;
  info(message: string, context?: LogContext | unknown): void;
  warn(message: string, context?: LogContext | unknown): void;
  error(message: string, context?: LogContext | unknown): void;
  child(context: LogContext): Logger;
  readonly level: LogLevel;
  readonly context: LogContext;
}

function shouldEmit(min: LogLevel, level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

function writeLine(
  level: LogLevel,
  message: string,
  context: LogContext,
): void {
  const timestamp = new Date().toISOString();
  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (isJsonFormat()) {
    const entry: Record<string, unknown> = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...context,
    };
    stream.write(`${safeStringify(entry)}\n`);
    return;
  }

  const color = LEVEL_ANSI[level];
  const label = level.toUpperCase().padEnd(5);
  const ctxKeys = Object.keys(context);
  const ctxSuffix = ctxKeys.length === 0 ? "" : ` ${safeStringify(context)}`;
  stream.write(
    `${color}${timestamp} ${label}${RESET} ${message}${ctxSuffix}\n`,
  );
}

function createLogger(bound: LogContext = {}): Logger {
  const minLevel = parseLevel(process.env.LOG_LEVEL);

  const emit = (
    level: LogLevel,
    message: string,
    context?: LogContext | unknown,
  ): void => {
    if (!shouldEmit(minLevel, level)) return;
    const normalized = normalizeContext(message, context);
    // The bound (child) context is merged in here, so it is redacted at the
    // last possible moment — no sink can ever see an unscrubbed value.
    writeLine(level, normalized.message, redactValue({
      ...bound,
      ...normalized.context,
    }));
  };

  return {
    level: minLevel,
    context: { ...bound },
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
    child: (context) => createLogger({ ...bound, ...context }),
  };
}

/** Root logger — safe to import before any other initialization. */
export const logger: Logger = createLogger();

/** Factory for a fresh root logger (mainly useful in tests). */
export function createRootLogger(context?: LogContext): Logger {
  return createLogger(context ?? {});
}
