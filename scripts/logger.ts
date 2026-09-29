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
    return { message, context: {} };
  }
  if (
    typeof context === "object" &&
    context !== null &&
    !Array.isArray(context) &&
    !(context instanceof Error)
  ) {
    return { message, context: context as LogContext };
  }
  if (context instanceof Error) {
    return {
      message: `${message} ${context.message}`,
      context: { error: context.message, stack: context.stack },
    };
  }
  return { message: `${message} ${String(context)}`, context: {} };
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
    writeLine(level, normalized.message, { ...bound, ...normalized.context });
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
