# Requirements Document

## Introduction

The keeper and indexer scripts emit structured JSON logs, but no shared identifier ties together the log lines that belong to the same charge cycle, batch, or indexer poll. This feature adds a `run_id` (UUID v4, generated via `crypto.randomUUID()`) at the start of each keeper cycle and each indexer poll, injects it as a bound field on a child logger, and carries it into DLQ entries. The result is that every charge attempt, retry, and DLQ write for a single cycle can be correlated by filtering on one field, with no new runtime dependencies and no weakening of the existing redaction guarantees.

## Glossary

- **Keeper**: The `scripts/keeper.ts` process that scans subscribers and submits charge batches.
- **Indexer**: The `scripts/indexer.ts` process that polls the Stellar RPC for contract events and writes them to SQLite.
- **Logger**: The structured logger defined in `scripts/logger.ts`, which exposes `child(context)` for bound fields.
- **run_id**: A UUID v4 string generated at the start of each keeper cycle or each indexer poll and attached to every log line produced during that unit of work.
- **DlqEntry**: The record written to the dead-letter queue file (`dlq/failed-batches.jsonl`) when a charge batch cannot be recovered after retries.
- **Child logger**: A `Logger` instance returned by `Logger.child(context)` that merges `context` into every subsequent log line.
- **Redaction**: The process by which the logger strips Stellar secret keys and other sensitive values before writing any log line.
- **log() shim**: The `log(dryRun, message)` helper in `scripts/utils/log.ts` that prefixes a message with `[DRY-RUN]` or `[LIVE]` and delegates to the root logger.

## Requirements

### Requirement 1: Keeper cycle run_id generation

**User Story:** As an operator, I want every log line from a single keeper charge cycle to carry the same `run_id`, so that I can filter a log stream to a single cycle without ambiguity.

#### Acceptance Criteria

1. WHEN the Keeper begins a charge cycle (`runCycle`), THE Keeper SHALL generate a UUID v4 `run_id` using `crypto.randomUUID()`.
2. WHEN the Keeper generates a `run_id`, THE Keeper SHALL create a child logger via `logger.child({ run_id })` and pass it to all functions called within that cycle.
3. THE Keeper SHALL emit the `run_id` field on the cycle-start log line.
4. THE Keeper SHALL emit the `run_id` field on the cycle-end summary log line.
5. WHEN a batch within a cycle is processed, THE Keeper SHALL emit the `run_id` field on every log line produced for that batch, including charge attempts, retries, and skip records.

### Requirement 2: DLQ entry correlation

**User Story:** As an operator, I want DLQ entries to include the `run_id` of the cycle that produced them, so that I can link a failed batch record back to the logs from the same run.

#### Acceptance Criteria

1. THE `DlqEntry` interface SHALL include an optional `run_id` field of type `string`.
2. WHEN `writeDlqEntry` is called during a cycle that has a `run_id`, THE Keeper SHALL populate the `run_id` field of the `DlqEntry` with the cycle's `run_id`.
3. WHEN a `DlqEntry` with a `run_id` is serialised to the DLQ file, THE DLQ file entry SHALL contain the `run_id` field.

### Requirement 3: Indexer poll run_id generation

**User Story:** As an operator, I want every log line from a single indexer poll to carry the same `run_id`, so that I can trace all RPC calls, upserts, and errors from one poll pass.

#### Acceptance Criteria

1. WHEN the Indexer begins a `pollOnce` invocation, THE Indexer SHALL generate a UUID v4 `run_id` using `crypto.randomUUID()`.
2. WHEN the Indexer generates a `run_id`, THE Indexer SHALL create a child logger via `logger.child({ run_id })` and use it for all log lines within that `pollOnce` invocation.
3. THE Indexer SHALL emit the `run_id` field on every log line produced within the `pollOnce` invocation, including RPC errors and event-upsert records.

### Requirement 4: run_id field propagation through the child logger

**User Story:** As a developer, I want `run_id` to reach every log line automatically via the child logger mechanism, so that call sites do not need to pass the ID manually.

#### Acceptance Criteria

1. WHEN a child logger is created with `{ run_id }`, THE Logger SHALL include the `run_id` field in every log line emitted by that child logger.
2. WHEN a child logger emits a log line, THE Logger SHALL apply redaction to bound fields including `run_id` before writing the line.
3. WHEN a child logger emits a log line in JSON format, THE Logger SHALL include `run_id` as a top-level key in the JSON object.

### Requirement 5: Redaction guarantees preserved

**User Story:** As a security reviewer, I want the addition of `run_id` fields to leave all existing redaction behaviour intact, so that secret keys cannot leak through the new code paths.

#### Acceptance Criteria

1. WHEN the Keeper emits a log line that contains a bound `run_id`, THE Logger SHALL still redact any Stellar secret key present in the same log entry.
2. WHEN the Indexer emits a log line that contains a bound `run_id`, THE Logger SHALL still redact any Stellar secret key present in the same log entry.
3. THE `logger-redaction.test.ts` test suite SHALL pass without modification to the existing redaction tests.
4. WHEN new tests for `run_id` propagation are added to `logger-redaction.test.ts`, THE Logger SHALL pass those tests.

### Requirement 6: Backward-compatible log() shim

**User Story:** As a developer, I want the existing `log()` shim in `utils/log.ts` to remain usable at call sites that have not yet been migrated, so that adding `run_id` does not require a simultaneous refactor of every `log()` call.

#### Acceptance Criteria

1. THE `log()` shim SHALL accept an optional third parameter of type `LogContext` to allow callers to forward structured fields including `run_id`.
2. WHEN `log()` is called without the optional third parameter, THE `log()` shim SHALL behave identically to its current behaviour.
3. WHEN `log()` is called with a `LogContext` third parameter, THE `log()` shim SHALL pass those fields to the underlying logger so they appear in the structured output.
