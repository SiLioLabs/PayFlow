# Design Document

## Overview

This feature adds a `run_id` correlation field to keeper charge cycles, keeper DLQ entries, and indexer poll invocations. Each unit of work (one cycle, one poll) generates a fresh UUID v4 at its entry point and binds it to a child logger. Every log line produced within that unit of work carries `run_id` as a top-level JSON field. DLQ entries are extended with an optional `run_id` so a failed batch record can be linked back to the logs from the same run.

No new runtime dependencies are required. The existing `Logger.child()` mechanism already merges bound fields into every emitted line and applies redaction, so the propagation path is an existing code path. The only new behaviour is generating the UUID, calling `child()`, and threading the child logger through call sites.

## Architecture

```
crypto.randomUUID()
        │
        ▼
  run_id  (string)
        │
   ┌────┴──────────────────────────────────┐
   │  logger.child({ run_id })             │
   │  ─────────────────────────────────── │
   │  bound fields: { run_id }             │
   │  every emit → { ...bound, ...call }   │
   └────┬──────────────────────────────────┘
        │  child logger flows into:
        ├─► runCycleLegacy / runCycleOptimized
        │       └─► processChargeBatch
        │               └─► writeDlqEntry (receives run_id directly)
        └─► pollOnce
                └─► indexEvents loop
                └─► RPC error handler
```

The design is intentionally shallow: functions that need to log receive the child logger as a parameter (or close over it). No global state is modified; the root `logger` export remains untouched.

## Components and Interfaces

### 1. `scripts/logger.ts` — no structural changes required

The logger already has `child(context)` which returns a new `Logger` whose every emission merges `context`. `run_id` travels through this mechanism without any changes to the logger itself.

The `LogContext` type (`Record<string, unknown>`) already accommodates `run_id: string`. No type changes are needed in `logger.ts`.

### 2. `scripts/utils/log.ts` — optional `LogContext` parameter

The `log()` shim currently calls `logger.info(prefix + message)`. Adding an optional third parameter of type `LogContext` lets migrated callers forward structured fields. Unmigrated call sites pass no third argument and are unaffected.

```typescript
import { logger, type LogContext } from "../logger.js";

export function log(
  dryRun: boolean,
  message: string,
  context?: LogContext,
): void {
  const prefix = dryRun ? "[DRY-RUN]" : "[LIVE]";
  if (context !== undefined) {
    logger.info(`${prefix} ${message}`, context);
  } else {
    logger.info(`${prefix} ${message}`);
  }
}
```

### 3. `scripts/keeper.ts` — cycle run_id and DLQ correlation

#### 3a. `DlqEntry` interface extension

```typescript
interface DlqEntry {
  timestamp: string;
  offset: number;
  limit: number;
  users: string[];
  error: string;
  tx_xdr: string | null;
  attempts: number;
  ledger?: number;
  run_id?: string;   // NEW — optional; populated when cycle run_id is present
}
```

#### 3b. `writeDlqEntry` signature extension

`writeDlqEntry` gains a `runId?: string` parameter. When present it sets `entry.run_id` before serialising:

```typescript
function writeDlqEntry(entry: DlqEntry, runId?: string): void {
  if (runId !== undefined) entry.run_id = runId;
  // … existing write logic …
}
```

#### 3c. `runCycle` — ID generation and child logger creation

```typescript
async function runCycle(): Promise<CycleReport> {
  const run_id = crypto.randomUUID();
  const cycleLogger = logger.child({ run_id });

  cycleLogger.info("Cycle started", { mode: isDryRun ? "dry-run" : "live" });
  // … cycle body passes cycleLogger to subordinate functions …
  cycleLogger.info("Cycle complete", { /* summary fields */ });
}
```

`runCycleOptimized` and `runCycleLegacy` receive `cycleLogger` as a parameter and thread it into `processChargeBatch` calls, replacing direct `log()` calls that need correlation.

#### 3d. `processChargeBatch` — receives child logger

The function signature gains a `cycleLogger: Logger` parameter. Internal `log()` and `logger.*` calls that belong to the batch lifecycle are replaced with `cycleLogger.*` calls. `writeDlqEntry` calls forward `run_id` extracted from `cycleLogger.context.run_id`.

### 4. `scripts/indexer.ts` — poll run_id

```typescript
export async function pollOnce(
  db: DatabaseSync,
  fromLedger: number,
  dedup: EventDedupCache,
  source: EventSource = server,
): Promise<number> {
  const run_id = crypto.randomUUID();
  const pollLogger = logger.child({ run_id });

  pollLogger.debug("Polling for events", { from_ledger: fromLedger });
  // … all existing logger.* calls inside pollOnce replaced with pollLogger.* …
}
```

The `main` loop that calls `pollOnce` is unchanged; `pollOnce`'s signature does not change, so no callers need updating.

## Data Models

### DlqEntry (updated)

| Field       | Type            | Required | Description                                   |
|-------------|-----------------|----------|-----------------------------------------------|
| `timestamp` | `string`        | yes      | ISO-8601 wall clock at time of DLQ write      |
| `offset`    | `number`        | yes      | Page offset of the failed batch               |
| `limit`     | `number`        | yes      | Batch size requested                          |
| `users`     | `string[]`      | yes      | Stellar addresses in the batch                |
| `error`     | `string`        | yes      | Error message string                          |
| `tx_xdr`    | `string \| null`| yes      | Serialised transaction XDR if available       |
| `attempts`  | `number`        | yes      | Number of charge attempts made                |
| `ledger`    | `number`        | no       | Ledger sequence at time of failure            |
| `run_id`    | `string`        | no       | UUID v4 of the keeper cycle (new)             |

### Log line schema (JSON format, representative)

```json
{
  "timestamp": "2025-01-15T12:34:56.789Z",
  "level": "INFO",
  "message": "Cycle complete",
  "run_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "mode": "live",
  "charged": 42,
  "totalVolume": "1234.0000000"
}
```

`run_id` is a top-level key because `child(context)` spreads the bound context at the root of the JSON object (see `writeLine` in `logger.ts`, which does `...context` at the top level of the entry).

### Updated `log()` signature

```typescript
export function log(
  dryRun: boolean,
  message: string,
  context?: LogContext,
): void;
```

### Updated `writeDlqEntry` signature

```typescript
function writeDlqEntry(entry: DlqEntry, runId?: string): void;
```

### Updated `runCycleOptimized` / `runCycleLegacy` signatures

```typescript
async function runCycleOptimized(
  report: CycleReport,
  isDryRun: boolean,
  cycleLogger: Logger,
): Promise<void>;

async function runCycleLegacy(
  report: CycleReport,
  isDryRun: boolean,
  cycleLogger: Logger,
): Promise<void>;
```

### `processChargeBatch` signature (conceptual — exact name may vary in source)

```typescript
async function processChargeBatch(
  /* existing params */,
  cycleLogger: Logger,
): Promise<BatchResult>;
```

## Error Handling

**UUID generation**: `crypto.randomUUID()` is synchronous and cannot throw in Node.js 19+. No error handling is required.

**Child logger creation**: `logger.child()` is a pure in-memory operation and cannot fail.

**DLQ write failure**: The existing `try/catch` in `writeDlqEntry` is preserved. The `run_id` field is added before the write attempt, so it is present in the JSONL line when the write succeeds, and the error log on write failure will itself carry `run_id` (because it uses the cycle child logger).

**Backward compatibility**: The optional third parameter on `log()` defaults to `undefined`. All existing call sites pass two arguments; none will be affected by the signature change. TypeScript enforces this at compile time.

## Implementation Notes

- `crypto` is a built-in Node.js global since v19 and requires no import in modern TypeScript/Node targets. If the tsconfig targets an older Node version, add `import { randomUUID } from "node:crypto"`.
- The `run_id` is a UUID v4 string, not a bigint or number, so `safeStringify` does not need to special-case it.
- Existing test helpers that call `createRootLogger({ run_id: "test-id" })` will work without modification because the logger already accepts any `LogContext`.
- The child logger's `context` property (`Logger.context`) exposes the bound fields, which allows `processChargeBatch` to extract `run_id` for the DLQ entry without passing it as a separate argument: `String(cycleLogger.context.run_id ?? "")`.

## Testing Strategy

**Dual testing approach**: unit/example tests for specific call-site behaviour; property-based tests for universally quantified invariants.

### Unit / example tests

Placed alongside existing tests in `scripts/__tests__/`:

- **`logger-redaction.test.ts`** (extended, not replaced): add a `describe("run_id propagation")` block that:
  - Creates a root logger with `{ run_id: "fixed-id" }` and asserts the parsed JSON output includes `run_id: "fixed-id"` at the top level.
  - Creates a child logger with `{ run_id }` and asserts redaction still removes a secret present in the same log line.
  - Calls `log(false, "msg", { run_id: "x" })` and asserts the JSON output includes both the `[LIVE]` prefix in `message` and `run_id: "x"` in the parsed object.
  - Calls `log(true, "msg")` (two-arg form) and asserts no `run_id` key appears in output.

- **`keeper-dlq.test.ts`** (new): integration-level test with a temp file asserting that a DLQ entry written with a `runId` argument round-trips correctly through `JSON.parse`.

### Property-based tests

Using Vitest with [fast-check](https://github.com/dubzzz/fast-check) for input generation:

- **Property 1** (`logger-redaction.test.ts`): `fc.string()` for `run_id` and log message; assert every captured JSON line contains `run_id` matching the input.
- **Property 2** (`logger-redaction.test.ts`): `fc.string()` for `run_id`; fixed Stellar secret in message; assert output contains `SECRET_MASK` and the original `run_id`.
- **Property 3** (`keeper-dlq.test.ts`): `fc.uuid()` for `run_id`; assert `JSON.parse` of written line preserves the value.
- **Property 4** (`log-shim.test.ts`): `fc.dictionary(fc.string(), fc.string())` for context; assert all keys present in output JSON.
- **Property 5** (`log-shim.test.ts`): `fc.boolean()` and `fc.string()` for two-arg call; assert no extra context keys in output.
- **Property 6** (`logger-redaction.test.ts`): Assert each `crypto.randomUUID()` result matches `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.

Minimum 100 iterations per property test.

**Tag format**: `Feature: correlation-ids-keeper-indexer-logs, Property {N}: {property_title}`

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Child logger propagates run_id to every emitted line

*For any* `run_id` string bound to a child logger via `logger.child({ run_id })`, every log line emitted by that child logger at any level (debug, info, warn, error) must include `run_id` as a top-level key with the same value as the bound field.

**Validates: Requirements 1.2, 1.5, 3.2, 3.3, 4.1, 4.3**

### Property 2: Child logger preserves redaction alongside run_id

*For any* child logger created with `{ run_id }` as a bound field, emitting a log line that also contains a Stellar secret key (in the message or context) must produce output where the secret is replaced with the redaction mask and the `run_id` field is preserved intact.

**Validates: Requirements 4.2, 5.1, 5.2**

### Property 3: DLQ entry run_id round-trip

*For any* `run_id` value passed to `writeDlqEntry`, the JSON object serialised to the DLQ JSONL file must contain a `run_id` field whose value equals the input `run_id`. Parsing the written line back with `JSON.parse` must yield an object where `parsed.run_id === run_id`.

**Validates: Requirements 2.2, 2.3**

### Property 4: log() shim with context forwards all fields

*For any* `LogContext` object passed as the third argument to `log()`, the JSON output must contain every key-value pair from that context object as top-level fields.

**Validates: Requirements 6.1, 6.3**

### Property 5: log() shim backward compatibility

*For any* boolean `dryRun` value and any string `message`, calling `log(dryRun, message)` (two-argument form) must produce output whose message is `[DRY-RUN] ${message}` or `[LIVE] ${message}` with no additional context fields beyond those already emitted by the root logger.

**Validates: Requirements 6.2**

### Property 6: UUID v4 validity

*For any* invocation of `crypto.randomUUID()`, the returned string must match the UUID v4 format (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` where `y ∈ {8,9,a,b}`) and must differ from every other concurrently generated UUID.

**Validates: Requirements 1.1, 3.1**
