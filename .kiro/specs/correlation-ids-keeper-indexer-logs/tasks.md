# Implementation Plan: Correlation IDs and Structured Fields for Keeper and Indexer Logs

## Overview

Thread a UUID v4 `run_id` through the keeper charge cycle and the indexer poll, binding it to a child logger so every log line within that unit of work carries the field automatically. Extend the DLQ entry interface to store the `run_id` for cross-referencing, and widen the `log()` shim to accept optional structured context. No new runtime dependencies are required.

## Tasks

- [ ] 1. Extend `log()` shim in `scripts/utils/log.ts`
  - [ ] 1.1 Add optional `context?: LogContext` third parameter to `log()`
    - Import `LogContext` from `../logger.js` alongside the existing `logger` import
    - When `context` is provided, call `logger.info(prefix + message, context)`; when absent, keep the current single-argument call so all existing call sites compile without change
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 1.2 Write property tests for the `log()` shim in a new `scripts/__tests__/log-shim.test.ts`
    - **Property 4: log() shim with context forwards all fields** — `fc.dictionary(fc.string(), fc.string())` for context; assert all keys present in output JSON
    - **Property 5: log() shim backward compatibility** — `fc.boolean()` and `fc.string()` for two-arg call; assert no extra context keys in output
    - Minimum 100 iterations; tag: `Feature: correlation-ids-keeper-indexer-logs, Property 4 / Property 5`
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 2. Extend `DlqEntry` and `writeDlqEntry` in `scripts/keeper.ts`
  - [ ] 2.1 Add optional `run_id?: string` field to the `DlqEntry` interface
    - _Requirements: 2.1_

  - [ ] 2.2 Add optional `runId?: string` parameter to `writeDlqEntry`
    - Before the existing `JSON.stringify` call, set `entry.run_id = runId` when `runId` is defined
    - Preserve the existing `try/catch` around the file write
    - _Requirements: 2.2, 2.3_

  - [ ]* 2.3 Write a DLQ round-trip test in a new `scripts/__tests__/keeper-dlq.test.ts`
    - **Property 3: DLQ entry run_id round-trip** — `fc.uuid()` for `run_id`; write to a temp file via `writeDlqEntry`; `JSON.parse` the written line; assert `parsed.run_id === run_id`
    - Minimum 100 iterations; tag: `Feature: correlation-ids-keeper-indexer-logs, Property 3`
    - _Requirements: 2.2, 2.3_

- [ ] 3. Add `run_id` generation and child logger to `runCycle` in `scripts/keeper.ts`
  - [ ] 3.1 Generate `run_id` via `crypto.randomUUID()` at the top of `runCycle`
    - Create `cycleLogger = logger.child({ run_id })`
    - Replace the `logger.warn` pause-guard call with `cycleLogger.warn`
    - Emit a cycle-start structured log line via `cycleLogger.info` with `{ mode, run_id }`
    - Replace the final `log(isDryRun, summary)` and grace-metrics `log()` calls with `cycleLogger.info` calls that include the structured summary fields (`checked`, `charged`, `totalVolume`, `mode`, `skips`)
    - Pass `cycleLogger` as a new third argument to `runCycleOptimized` and `runCycleLegacy`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 3.2 Write a UUID v4 validity property test in `scripts/__tests__/logger-redaction.test.ts`
    - **Property 6: UUID v4 validity** — assert each `crypto.randomUUID()` result matches `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` and that two successive calls return distinct values
    - Minimum 100 iterations; tag: `Feature: correlation-ids-keeper-indexer-logs, Property 6`
    - _Requirements: 1.1_

- [ ] 4. Thread `cycleLogger` through `runCycleOptimized` and `runCycleLegacy`
  - [ ] 4.1 Update `runCycleOptimized(report, isDryRun, cycleLogger: Logger)` signature
    - Replace `logger.info` / `logger.warn` calls inside `runCycleOptimized` with `cycleLogger.info` / `cycleLogger.warn`
    - Update `log()` calls that emit batch-level lines to pass `{ run_id: cycleLogger.context.run_id }` as the third argument (using the extended shim from task 1.1)
    - Forward `cycleLogger` to any `processPageDryRun` / `processPageLive` calls that need to write DLQ entries, by passing `String(cycleLogger.context.run_id ?? "")` to `writeDlqEntry`
    - _Requirements: 1.5, 2.2_

  - [ ] 4.2 Update `runCycleLegacy(report, isDryRun, cycleLogger: Logger)` signature
    - Mirror the same replacements from task 4.1 for the legacy path
    - Ensure `writeDlqEntry` calls within legacy page processing receive the `run_id`
    - _Requirements: 1.5, 2.2_

- [ ] 5. Checkpoint — Ensure all keeper-side changes compile and existing keeper tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Add `run_id` generation and child logger to `pollOnce` in `scripts/indexer.ts`
  - [ ] 6.1 Generate `run_id` via `crypto.randomUUID()` at the top of `pollOnce`
    - Create `pollLogger = logger.child({ run_id })`
    - Replace every `logger.debug`, `logger.info`, and `logger.error` call inside `pollOnce` with the corresponding `pollLogger.*` call
    - The function signature and callers in `main` are unchanged
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 7. Add `run_id` propagation and backward-compat tests to `scripts/__tests__/logger-redaction.test.ts`
  - [ ] 7.1 Add `describe("run_id propagation")` block with example tests
    - Create child logger with `{ run_id: "fixed-id" }`; assert parsed JSON output contains `run_id: "fixed-id"` at top level
    - Create child logger with `{ run_id }`; emit a line also containing `REALISTIC_SECRET`; assert secret is masked and `run_id` is intact
    - Call `log(false, "msg", { run_id: "x" })`; assert JSON output includes both `[LIVE]` prefix in `message` and `run_id: "x"`
    - Call `log(true, "msg")` (two-arg); assert no `run_id` key in output
    - _Requirements: 4.1, 4.3, 5.1, 5.2, 5.3, 5.4, 6.2_

  - [ ]* 7.2 Write Property 1 — child logger propagates run_id to every emitted line
    - **Property 1: Child logger propagates run_id to every emitted line** — `fc.string()` for `run_id` and log message; assert every captured JSON line contains `run_id` matching the input, at all log levels
    - Minimum 100 iterations; tag: `Feature: correlation-ids-keeper-indexer-logs, Property 1`
    - _Requirements: 1.2, 1.5, 3.2, 3.3, 4.1, 4.3_

  - [ ]* 7.3 Write Property 2 — child logger preserves redaction alongside run_id
    - **Property 2: Child logger preserves redaction alongside run_id** — `fc.string()` for `run_id`; fixed Stellar secret in message; assert output contains `SECRET_MASK` and the original `run_id` is present
    - Minimum 100 iterations; tag: `Feature: correlation-ids-keeper-indexer-logs, Property 2`
    - _Requirements: 4.2, 5.1, 5.2_

- [ ] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- `crypto.randomUUID()` is a built-in Node.js global (v19+). If the tsconfig targets an older Node version, use `import { randomUUID } from "node:crypto"` instead
- `cycleLogger.context.run_id` exposes the bound field — use `String(cycleLogger.context.run_id ?? "")` to extract it without a separate parameter
- `processPageDryRun` and `processPageLive` do not need signature changes; `writeDlqEntry` calls within them receive `run_id` from the caller via the updated `runId?` parameter
- Property tests require `fast-check` (`fc`) as a dev dependency — verify it is already installed before writing property tests

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "1.2"] },
    { "id": 2, "tasks": ["2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1", "4.2"] },
    { "id": 4, "tasks": ["6.1"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3"] }
  ]
}
```
