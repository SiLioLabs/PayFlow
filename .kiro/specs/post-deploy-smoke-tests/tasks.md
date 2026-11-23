# Implementation Plan: Post-Deploy Smoke Tests and Rollback Guidance

## Overview

Extend `scripts/deploy-pipeline.ts` with five typed changes: new `runSmokeTests` and `emitRollbackGuidance` exports, a synchronous `writeManifest` export, updated `PipelineSummary` and `ParsedArgs` interfaces, and integration of these into `runPipeline`. Tests live in the existing `scripts/__tests__/deploy-pipeline.test.ts`.

## Tasks

- [ ] 1. Extend types: `PipelineSummary`, `ParsedArgs`, and `GateResult` exports
  - [ ] 1.1 Add `smokeTestsPassed: boolean` to `PipelineSummary` interface
    - Export the updated interface; keep all existing fields intact
    - _Requirements: 6.2, 6.3_
  - [ ] 1.2 Add `manifestOut?: string` and `expectedWasmHash?: string` to `ParsedArgs`; wire `--manifest-out` and `--expected-wasm-hash` flags in `parseArgs`
    - Default `manifestOut` to `"deployments/manifest.json"` when flag is absent
    - _Requirements: 5.1, 2.1_

- [ ] 2. Implement `runSmokeTests`
  - [ ] 2.1 Add internal `simulateSmoke` helper that builds a read-only `simulateTransaction` call for a named contract method and returns `xdr.ScVal`
    - Throw on `{ error: "..." }` responses; propagate to caller
    - _Requirements: 1.3, 1.4, 1.5, 1.6_
  - [ ] 2.2 Implement the `smoke:wasm-hash` check inside `runSmokeTests`
    - Call `fetchOnChainWasmHash`; fail closed on throw; compare case-insensitively to `expectedWasmHash`; include both hashes in fail message
    - _Requirements: 1.2, 2.1, 2.2, 2.3_
  - [ ]* 2.3 Write property test for case-insensitive WASM hash matching (Property 1)
    - **Property 1: Case-Insensitive WASM Hash Matching**
    - **Validates: Requirements 2.1, 2.2**
  - [ ] 2.4 Implement the `smoke:schema-version`, `smoke:version`, `smoke:config`, and `smoke:admin` checks inside `runSmokeTests`
    - Use `simulateSmoke`; record returned value in `detail` for schema-version and version; treat `scvVoid` without error as pass for config and admin
    - Export `runSmokeTests`; collect all five results regardless of earlier failures
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [ ]* 2.5 Write property test for smoke results recorded for any return value (Property 2)
    - **Property 2: Smoke Results Recorded for Any Return Value**
    - **Validates: Requirements 1.3, 1.4**
  - [ ]* 2.6 Write property test for failing smoke checks carrying error information (Property 3)
    - **Property 3: Failing Smoke Checks Carry Error Information**
    - **Validates: Requirements 1.7, 2.3**

- [ ] 3. Implement `emitRollbackGuidance`
  - [ ] 3.1 Write `emitRollbackGuidance(contractId, previousWasmHash, stderr)` and export it
    - Print the delimited block (header rule, warning title, contractId, previous hash, numbered CLI steps, closing rule) to the supplied stream
    - Use `"(none recorded)"` when `previousWasmHash` is null
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ]* 3.2 Write property test for rollback guidance containing pipeline context (Property 4)
    - **Property 4: Rollback Guidance Contains Pipeline Context**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement `writeManifest`
  - [ ] 5.1 Write `writeManifest(manifestPath, contractId, wasmHash, network, deployer, timestamp)` and export it
    - Read and merge any existing manifest; create parent directories with `mkdirSync({ recursive: true })`; write `wasmHash`, `lastUpdatedAt`, `contractId`, `deployedAt` (equals `lastUpdatedAt` on first write), `network`, `deployer`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 5.2 Write property test for manifest written iff all checks pass (Property 6)
    - **Property 6: Manifest Written Iff All Checks Pass**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [ ] 6. Integrate smoke tests into `runPipeline`
  - [ ] 6.1 After Gate 3, read `previousWasmHash` from the existing manifest at `args.manifestOut`; then call `runSmokeTests` and push all results into `summary.gates`
    - Set `summary.smokeTestsPassed = results.every(r => r.status !== "fail")`
    - Call `emitRollbackGuidance` and exit 1 when any smoke result fails
    - Call `writeManifest` only when `summary.passed && summary.smokeTestsPassed`
    - _Requirements: 1.1, 3.1, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 6.3_
  - [ ] 6.2 Extend the dry-run branch to append five `"skip"` smoke results and set `smokeTestsPassed: true` without making any network calls
    - _Requirements: 4.3_
  - [ ]* 6.3 Write property test for `smokeTestsPassed` reflecting the smoke result set (Property 5)
    - **Property 5: `smokeTestsPassed` Reflects Smoke Result Set**
    - **Validates: Requirements 4.1, 4.2, 6.2**
  - [ ]* 6.4 Write property test for smoke results appearing in summary gates array (Property 7)
    - **Property 7: Smoke Results Appear in Summary Gates Array**
    - **Validates: Requirements 6.1, 6.3**

- [ ] 7. Add unit and integration tests to `scripts/__tests__/deploy-pipeline.test.ts`
  - [ ] 7.1 Add unit tests for `runSmokeTests`: matching hash → all pass; mismatched hash → wasm check fails with both hashes in message; `getLedgerEntries` throws → wasm check fails with error; simulate error on `get_schema_version` → schema check fails
    - _Requirements: 7.1, 7.2_
  - [ ] 7.2 Add unit tests for `emitRollbackGuidance`: captures stream output; asserts delimiter lines, contractId, previousWasmHash, and CLI command string are present; test with null previousWasmHash shows `"(none recorded)"`
    - _Requirements: 7.3_
  - [ ] 7.3 Add unit tests for `writeManifest`: writes correct `wasmHash` and a valid ISO 8601 `lastUpdatedAt`; merges into existing manifest without discarding other fields; creates missing parent directory
    - _Requirements: 7.4, 7.5_
  - [ ] 7.4 Add integration-style tests for `runPipeline` using mocked server: all pass → `smokeTestsPassed: true` and manifest written; wasm mismatch → `smokeTestsPassed: false`, manifest not written, stderr contains rollback block; dry-run → all smoke results `"skip"`, manifest not written
    - _Requirements: 7.4, 7.5, 7.6, 7.7_

- [ ] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use Vitest + `fast-check`; they are independent of unit tests and can be run with `vitest --run`
- `writeManifest` is intentionally synchronous (uses `fs.readFileSync` / `fs.writeFileSync`) to match the pipeline's existing I/O style
- Existing exports (`runPipeline`, `runHealthGate`, `runWasmHashGate`, `runSchemaVersionGate`, `writeSummary`, `parseArgs`, `computeWasmHash`, `fetchOnChainWasmHash`, `fetchSchemaVersion`, `GateResult`) remain unchanged at their call signatures

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "3.2"] },
    { "id": 3, "tasks": ["2.3", "2.5", "2.6", "5.2"] },
    { "id": 4, "tasks": ["6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "6.4"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 7, "tasks": ["7.4"] }
  ]
}
```
