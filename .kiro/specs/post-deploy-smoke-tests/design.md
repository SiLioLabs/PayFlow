# Design Document

## Overview

This design extends `scripts/deploy-pipeline.ts` with a post-deploy smoke-test phase. After all pre-deploy gates pass, the pipeline calls four read-only contract methods via `simulateTransaction`, verifies the live on-chain WASM hash against the expected value, prints rollback guidance on failure, and writes the manifest only after every check passes. The feature also adds a `smokeTestsPassed` boolean to `PipelineSummary` and appends each `SmokeResult` to `PipelineSummary.gates`.

---

## Architecture

The pipeline remains a single-file orchestrator (`deploy-pipeline.ts`). The post-deploy phase is introduced as a new function `runSmokeTests` that runs sequentially after the existing three pre-deploy gates. All smoke-test checks produce `GateResult`-compatible `SmokeResult` values (same type, different `gate` names).

```
parseArgs → resolveConfig
         → dry-run branch (all gates skipped, return early)
         → Gate 1: runHealthGate
         → Gate 2: runWasmHashGate
         → Gate 3: runSchemaVersionGate
         → [NEW] runSmokeTests (4 checks)
                 ├── smoke:wasm-hash       (getLedgerEntries)
                 ├── smoke:schema-version  (simulateTransaction → get_schema_version)
                 ├── smoke:version         (simulateTransaction → get_version)
                 ├── smoke:config          (simulateTransaction → get_config)
                 └── smoke:admin           (simulateTransaction → get_admin)
         → emitRollbackGuidance (if any smoke check failed)
         → writeManifest        (only if ALL gates + ALL smoke checks passed)
         → writeSummary
         → exit 0 | 1
```

---

## Components and Interfaces

### `SmokeResult` (type alias)

`SmokeResult` is a `GateResult` (same `{ gate, status, message, detail? }` shape). No new type is needed; using the existing `GateResult` keeps the `gates` array homogeneous.

### `runSmokeTests` (new export)

```typescript
export async function runSmokeTests(
  contractId: string,
  server: MultiEndpointServer,
  networkPassphrase: string,
  sourceAccount: string,
  expectedWasmHash: string | null
): Promise<GateResult[]>
```

Runs five checks in sequence; short-circuit logic is intentionally absent so all five results are always collected. Returns the array of `GateResult` records so callers can decide whether to continue.

Internal helper called by each check:

```typescript
async function simulateSmoke(
  contract: Contract,
  server: MultiEndpointServer,
  account: Account,
  networkPassphrase: string,
  method: string
): Promise<xdr.ScVal>
```

### `emitRollbackGuidance` (new export)

```typescript
export function emitRollbackGuidance(
  contractId: string,
  previousWasmHash: string | null,
  stderr: NodeJS.WritableStream
): void
```

Writes a delimited remediation block to the supplied `stderr` stream. The stream parameter makes the function unit-testable without touching `process.stderr` directly.

### `writeManifest` (new export)

```typescript
export function writeManifest(
  manifestPath: string,
  contractId: string,
  wasmHash: string,
  network: string,
  deployer: string | null,
  timestamp: string
): void
```

Reads any existing manifest, merges the updated fields, and writes the result atomically. Called only when `summary.passed && summary.smokeTestsPassed`.

### `PipelineSummary` (updated interface)

```typescript
export interface PipelineSummary {
  timestamp: string;
  dryRun: boolean;
  contractId: string;
  rpcUrl: string;
  wasmPath: string | null;
  wasmHash: string | null;
  onChainHash: string | null;
  schemaVersion: number | null;
  rpcHealthy: boolean;
  gates: GateResult[];        // smoke results appended after pre-deploy gates
  passed: boolean;
  smokeTestsPassed: boolean;  // NEW
}
```

---

## Data Models

### Manifest shape (augmented)

```json
{
  "contractId": "CABC...",
  "deployedAt": "2026-01-01T00:00:00.000Z",
  "network": "testnet",
  "deployer": null,
  "steps": {
    "build": false,
    "deploy": false,
    "initialize": false,
    "fee": false,
    "merchants": false
  },
  "wasmHash": "d4e5f6...",
  "lastUpdatedAt": "2026-01-01T00:00:00.000Z"
}
```

`wasmHash` and `lastUpdatedAt` are the two fields added by this feature; both are already present in the manifest's existing shape at the JSON level (the manifest was missing them in earlier pipeline runs). `deployedAt` is set equal to `lastUpdatedAt` on first write.

### `ParsedArgs` (updated)

```typescript
interface ParsedArgs {
  // existing fields ...
  manifestOut?: string;        // NEW: --manifest-out <path>, default: deployments/manifest.json
  expectedWasmHash?: string;   // NEW: --expected-wasm-hash <hex> (alternative to --wasm)
}
```

---

## Interfaces

### `runSmokeTests` inputs / outputs

| Parameter | Type | Description |
|---|---|---|
| `contractId` | `string` | Deployed contract address |
| `server` | `MultiEndpointServer` | RPC wrapper with failover |
| `networkPassphrase` | `string` | Stellar network passphrase |
| `sourceAccount` | `string` | Dummy source for simulation (no auth required) |
| `expectedWasmHash` | `string \| null` | Hash to compare against on-chain |
| **returns** | `Promise<GateResult[]>` | One result per smoke check |

### `emitRollbackGuidance` inputs

| Parameter | Type | Description |
|---|---|---|
| `contractId` | `string` | The contract that was just deployed |
| `previousWasmHash` | `string \| null` | Previous hash from manifest (may be absent) |
| `stderr` | `NodeJS.WritableStream` | Target stream (defaults to `process.stderr` at call-site) |

---

## Smoke-Test Logic

### WASM Hash Check (`smoke:wasm-hash`)

```typescript
let onChainHash: string;
try {
  onChainHash = await fetchOnChainWasmHash(contractId, server);
} catch (err) {
  return { gate: "smoke:wasm-hash", status: "fail", message: `Could not fetch on-chain WASM hash: ${err.message}` };
}

if (onChainHash.toLowerCase() !== (expectedWasmHash ?? "").toLowerCase()) {
  return { gate: "smoke:wasm-hash", status: "fail",
           message: `WASM hash mismatch: on-chain=${onChainHash}, expected=${expectedWasmHash}` };
}
return { gate: "smoke:wasm-hash", status: "pass", message: `WASM hash verified: ${onChainHash}` };
```

Key properties:
- Comparison is **case-insensitive** (`toLowerCase()`).
- Fails **closed** when the hash cannot be fetched.

### Schema Version Check (`smoke:schema-version`)

Calls `get_schema_version` via `simulateSmoke`. On success, records the returned `u32` in `detail.schemaVersion`. Never blocks the pipeline on its own (a warn status is acceptable), but records a `"fail"` if the simulation itself errors.

### Version Check (`smoke:version`)

Calls `get_version` via `simulateSmoke`. Records the returned `Bytes`/`String` value in `detail.version`. Same error handling pattern.

### Config Check (`smoke:config`)

Calls `get_config` via `simulateSmoke`. Only checks for the absence of a simulation error; the return value is not inspected. A simulation error yields `status: "fail"`.

### Admin Check (`smoke:admin`)

Calls `get_admin` via `simulateSmoke`. Same pattern as `smoke:config`.

---

## Rollback Guidance Format

Printed to stderr as a clearly delimited block when any smoke check has `status: "fail"`:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ⚠  ROLLBACK GUIDANCE — smoke tests failed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Contract  : <contractId>
Prev hash : <previousWasmHash | "(none recorded)">

Steps to restore the previous version:
  1. stellar contract deploy \
       --wasm <path-to-previous.wasm> \
       --source-account <deployer> \
       --network <network>
  2. Verify on-chain hash matches prev hash above.
  3. Re-run any post-deploy migrations if applicable.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `getLedgerEntries` throws during WASM hash smoke check | `smoke:wasm-hash` → `"fail"` (fail closed) |
| `simulateTransaction` returns `{ error: "..." }` | Affected smoke check → `"fail"` |
| `simulateTransaction` returns no `retval` | `smoke:version` / `smoke:schema-version` → `"fail"` |
| `get_config` / `get_admin` returns `scvVoid` without error | Treated as `"pass"` (no value inspection) |
| Manifest path's parent directory is missing | `writeManifest` creates it (`mkdirSync recursive`) |
| Manifest file doesn't exist at pipeline start | `writeManifest` creates it on success; nothing is touched on failure |
| Any smoke check fails | Rollback guidance printed; manifest not written; `smokeTestsPassed: false`; exit 1 |
| Dry-run mode | All smoke checks skip; manifest not written; exit 0 |

---

## Pipeline Integration (`runPipeline` changes)

1. After Gate 3 (schema version), read the current manifest from `args.manifestOut` (default `deployments/manifest.json`) to capture `previousWasmHash`.
2. Call `await runSmokeTests(...)` and push all results into `summary.gates`.
3. Compute `summary.smokeTestsPassed = results.every(r => r.status !== "fail")`.
4. If any smoke result is `"fail"`, call `emitRollbackGuidance(contractId, previousWasmHash, process.stderr)`.
5. Set `summary.passed = preDeployGatesPassed && summary.smokeTestsPassed`.
6. Write manifest only when `summary.passed` is `true`.
7. Call `writeSummary` unconditionally.

**Dry-run shortcut** (existing path, extended): append five `"skip"` smoke results to `summary.gates` before returning, and set `smokeTestsPassed: true`.

---

## Testing Strategy

All tests live in `scripts/__tests__/deploy-pipeline.test.ts`. Each new test block uses mocked `MultiEndpointServer` and `simulateTransaction` to avoid network calls.

### Unit Tests

- `runSmokeTests`: matching hash → all pass; mismatched hash → wasm check fails; `getLedgerEntries` throws → wasm check fails with error in message; simulate error on `get_schema_version` → schema check fails.
- `emitRollbackGuidance`: captures stderr output; verifies delimiter lines, contractId, previousWasmHash, and CLI command are present.
- `writeManifest`: writes correct fields; `lastUpdatedAt` is a valid ISO timestamp; `wasmHash` equals expected hash; does not write when called manually with failure (the pipeline-level guard ensures this).

### Integration-style Tests (mocked network)

- `runPipeline` smoke pass: all gates + all smoke pass → `smokeTestsPassed: true`, manifest written.
- `runPipeline` smoke fail: wasm mismatch → `smokeTestsPassed: false`, manifest not written, stderr contains rollback block.
- `runPipeline` dry-run: `smokeTestsPassed: true`, all smoke results `"skip"`, manifest not written.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Case-Insensitive WASM Hash Matching

*For any* 64-character hex WASM hash, comparing it to any casing variant of itself (upper, lower, or mixed case) SHALL produce a `status: "pass"` smoke result; comparing it to any distinct hash SHALL produce `status: "fail"` with both hashes present in the message.

**Validates: Requirements 2.1, 2.2**

---

### Property 2: Smoke Results Recorded for Any Return Value

*For any* integer schema version or version string returned by `simulateTransaction`, the corresponding `SmokeResult` SHALL record the returned value in its `detail` field and carry `status: "pass"`.

**Validates: Requirements 1.3, 1.4**

---

### Property 3: Failing Smoke Checks Carry Error Information

*For any* error message thrown or returned by `simulateTransaction`, the resulting `SmokeResult` SHALL have `status: "fail"` and a non-empty `message` field that contains a description of the error.

**Validates: Requirements 1.7, 2.3**

---

### Property 4: Rollback Guidance Contains Pipeline Context

*For any* `contractId` and any previous `wasmHash` stored in the manifest, when at least one smoke check fails the rollback block printed to stderr SHALL contain the `contractId`, the previous `wasmHash`, and a CLI command string.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

---

### Property 5: `smokeTestsPassed` Reflects Smoke Result Set

*For any* collection of `SmokeResult` values, `smokeTestsPassed` SHALL be `true` if and only if no result has `status: "fail"`; it SHALL be `false` if at least one result has `status: "fail"`.

**Validates: Requirements 4.1, 4.2, 6.2**

---

### Property 6: Manifest Written Iff All Checks Pass

*For any* pipeline run, the manifest file on disk SHALL contain the new `wasmHash` and a valid ISO 8601 `lastUpdatedAt` if and only if every gate and every smoke check in that run has `status` of `"pass"`, `"warn"`, or `"skip"`.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

---

### Property 7: Smoke Results Appear in Summary Gates Array

*For any* set of N smoke checks executed in a pipeline run, all N `SmokeResult` entries SHALL appear in `PipelineSummary.gates`, appended after the pre-deploy gate entries, with their original `gate`, `status`, and `message` values preserved.

**Validates: Requirements 6.1, 6.3**
