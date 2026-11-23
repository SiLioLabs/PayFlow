# Requirements Document

## Introduction

This feature extends `scripts/deploy-pipeline.ts` with a post-deploy smoke-test phase that runs after a WASM upgrade has been committed to the network. The smoke tests verify on-chain contract state by reading `get_version`, `get_schema_version`, `get_config`, and `get_admin`, comparing the live WASM hash against the expected value recorded in `deployments/manifest.json`. If any check fails, the pipeline prints actionable rollback steps and exits with a non-zero code. The manifest is only updated after all verifications pass.

## Glossary

- **Pipeline**: The `deploy-pipeline.ts` script that orchestrates pre-deploy gates and the new post-deploy smoke tests.
- **Smoke Test**: A lightweight read-only on-chain check run after deployment to confirm the upgrade succeeded.
- **WASM Hash**: The SHA-256 hex digest of the compiled contract `.wasm` binary; used as the unique identifier for a deployed contract version.
- **Manifest**: `deployments/manifest.json`; the machine-readable record of the last successful deployment, including `contractId`, `deployedAt`, `network`, `deployer`, `steps`, `wasmHash`, and `lastUpdatedAt`.
- **Rollback Guidance**: A human-readable set of remediation steps printed to stderr when a smoke test fails, telling the operator how to restore the previous contract version.
- **SchemaVersion**: An integer stored on-chain that tracks the contract's data-migration generation, read via `get_schema_version`.
- **OnChainWasmHash**: The WASM hash currently recorded in the contract's ledger instance entry, fetched via `getLedgerEntries`.
- **ExpectedWasmHash**: The WASM hash the operator provided at pipeline invocation time (via `--wasm` path or `--expected-wasm-hash` flag) and that gets written to the manifest on success.
- **GateResult**: The existing `{ gate, status, message, detail? }` record type used to report individual gate outcomes.
- **SmokeResult**: A `GateResult`-compatible record produced by each smoke-test check.
- **MultiEndpointServer**: The `scripts/rpc-client.ts` class that wraps Soroban RPC with failover and retry logic.

## Requirements

### Requirement 1: Post-Deploy Smoke-Test Phase

**User Story:** As a DevOps engineer, I want the pipeline to automatically verify on-chain contract state after a WASM upgrade, so that I catch a broken deployment before it affects users.

#### Acceptance Criteria

1. WHEN the Pipeline completes all pre-deploy gates with no failures and a deploy step is requested, THE Pipeline SHALL execute a post-deploy smoke-test phase before writing the Manifest.
2. THE Pipeline SHALL read the on-chain WASM hash using `getLedgerEntries` via MultiEndpointServer and compare it to the ExpectedWasmHash.
3. THE Pipeline SHALL call `get_schema_version` via `simulateTransaction` and record the returned SchemaVersion in the smoke-test results.
4. THE Pipeline SHALL call `get_version` via `simulateTransaction` and record the returned version string in the smoke-test results.
5. THE Pipeline SHALL call `get_config` via `simulateTransaction` and confirm the call succeeds without a simulation error.
6. THE Pipeline SHALL call `get_admin` via `simulateTransaction` and confirm the call succeeds without a simulation error.
7. WHEN any smoke-test check fails, THE Pipeline SHALL record the failed SmokeResult with `status: "fail"` and include a descriptive `message` field.
8. WHEN all smoke-test checks pass, THE Pipeline SHALL record each SmokeResult with `status: "pass"`.

---

### Requirement 2: WASM Hash Verification

**User Story:** As a DevOps engineer, I want the pipeline to confirm the deployed WASM hash matches the expected build artifact, so that I detect accidental deployment of the wrong binary.

#### Acceptance Criteria

1. WHEN the on-chain WASM hash equals the ExpectedWasmHash (case-insensitive comparison), THE Pipeline SHALL record the WASM-hash smoke check as `status: "pass"`.
2. WHEN the on-chain WASM hash does not equal the ExpectedWasmHash, THE Pipeline SHALL record the WASM-hash smoke check as `status: "fail"` with a message containing both the on-chain hash and the expected hash.
3. IF the on-chain WASM hash cannot be retrieved, THEN THE Pipeline SHALL record the WASM-hash smoke check as `status: "fail"` with a message describing the retrieval error.

---

### Requirement 3: Rollback Guidance on Failure

**User Story:** As a DevOps engineer, I want the pipeline to print step-by-step rollback instructions when a smoke test fails, so that I can restore a working contract version without referring to external documentation.

#### Acceptance Criteria

1. WHEN at least one smoke-test check has `status: "fail"`, THE Pipeline SHALL print rollback guidance to stderr before exiting.
2. THE Rollback Guidance SHALL include the previous on-chain WASM hash as recorded in the Manifest at pipeline start.
3. THE Rollback Guidance SHALL include the `contractId` targeted by the failed deployment.
4. THE Rollback Guidance SHALL include the `stellar contract deploy` or equivalent CLI command the operator can run to restore the previous version.
5. THE Rollback Guidance SHALL be printed as a clearly delimited block (e.g. a header line and numbered steps) so it is visually distinct from normal pipeline output.

---

### Requirement 4: Non-Zero Exit on Smoke-Test Failure

**User Story:** As a CI system, I want the pipeline process to exit with a non-zero code when a smoke test fails, so that the pipeline stage is marked as failed and blocks further automation.

#### Acceptance Criteria

1. WHEN at least one smoke-test check has `status: "fail"`, THE Pipeline SHALL exit with code `1`.
2. WHEN all smoke-test checks have `status` of `"pass"`, `"warn"`, or `"skip"`, THE Pipeline SHALL exit with code `0`.
3. WHILE operating in `--dry-run` mode, THE Pipeline SHALL skip all smoke-test network calls and treat the smoke-test phase as `status: "skip"`.

---

### Requirement 5: Manifest Written Only After Verification Passes

**User Story:** As a DevOps engineer, I want `deployments/manifest.json` to only be updated when every verification passes, so that the manifest always reflects a known-good deployment state.

#### Acceptance Criteria

1. WHEN all pre-deploy gates and all smoke-test checks pass (no `status: "fail"`), THE Pipeline SHALL write the Manifest with the updated `contractId`, `deployedAt`, `wasmHash`, `network`, `deployer`, and `lastUpdatedAt` fields.
2. WHEN at least one pre-deploy gate or smoke-test check has `status: "fail"`, THE Pipeline SHALL leave the existing Manifest file unchanged.
3. THE Pipeline SHALL set `manifest.lastUpdatedAt` to the ISO 8601 UTC timestamp at the moment the Manifest is written.
4. THE Pipeline SHALL set `manifest.wasmHash` to the ExpectedWasmHash when writing a successful Manifest.
5. IF the Manifest file does not exist at pipeline start, THEN THE Pipeline SHALL create the Manifest file only after all checks pass.

---

### Requirement 6: Smoke-Test Results in Summary Artifact

**User Story:** As a CI system, I want smoke-test outcomes recorded in the JSON summary artifact alongside pre-deploy gate results, so that the full pipeline history is captured in one file.

#### Acceptance Criteria

1. THE Pipeline SHALL include each SmokeResult in the `gates` array of `PipelineSummary`, appended after the pre-deploy gate entries.
2. THE Pipeline SHALL add a `smokeTestsPassed` boolean field to `PipelineSummary` that is `true` when all SmokeResults have `status` of `"pass"`, `"warn"`, or `"skip"`, and `false` otherwise.
3. WHEN the Pipeline writes the summary artifact via `writeSummary`, THE Pipeline SHALL include the updated `smokeTestsPassed` field and all SmokeResults.

---

### Requirement 7: Tests and Documentation Updated

**User Story:** As a contributor, I want new Vitest tests covering the smoke-test phase and rollback guidance logic, so that regressions are caught automatically.

#### Acceptance Criteria

1. THE test suite SHALL include a test verifying that a matching on-chain WASM hash produces a `status: "pass"` SmokeResult.
2. THE test suite SHALL include a test verifying that a mismatched on-chain WASM hash produces a `status: "fail"` SmokeResult containing both hash values.
3. THE test suite SHALL include a test verifying that rollback guidance is emitted to stderr when any smoke-test check fails.
4. THE test suite SHALL include a test verifying that the Manifest is not written when a smoke-test check fails.
5. THE test suite SHALL include a test verifying that the Manifest is written with the correct `wasmHash` and `lastUpdatedAt` when all checks pass.
6. THE test suite SHALL include a test verifying that `smokeTestsPassed` is `false` in the summary when a smoke-test check fails.
7. WHEN new tests are added to `scripts/__tests__/deploy-pipeline.test.ts`, THE test suite SHALL continue to pass all existing tests without modification.
