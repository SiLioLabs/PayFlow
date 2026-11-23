# Implementation Plan: Keeper /healthz and /readyz Endpoints

## Overview

Add `setLastLoopTick`, `handleHealthz`, and `handleReadyz` to `scripts/metrics-server.ts`, wire them into the existing HTTP router, call `setLastLoopTick` from `keeper.ts` after every `runCycle()`, replace the Dockerfile and docker-compose keeper health checks, write 7 unit tests plus 4 property-based tests in Vitest, and update the file-header comment together with AGENTS.md.

## Tasks

- [ ] 1. Extend metrics-server.ts with loop-tick state and the setLastLoopTick export
  - Add `let lastLoopTickMs: number | undefined = undefined;` as a module-level variable immediately after the `METRICS_PORT` declaration
  - Add `export function setLastLoopTick(timestampMs: number): void { lastLoopTickMs = timestampMs; }` to the Public API section
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Add handleHealthz and handleReadyz internal functions to metrics-server.ts
  - [ ] 2.1 Implement `handleHealthz(res, intervalSeconds)` exactly as specified in the design
    - Read `INTERVAL_SECONDS` from the environment (default `120`) and pass it in from the router
    - Return 200 with `{"status":"ok","reason":"loop not yet started"}` when `lastLoopTickMs === undefined`
    - Return 200 with `{"status":"ok"}` when elapsed ≤ `2 × intervalSeconds × 1000` ms
    - Return 503 with `{"status":"degraded","secondsSinceLastTick": N}` otherwise; `N = Math.floor(elapsedMs / 1000)`
    - Set `Content-Type: application/json` on all branches
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 2.2 Implement `handleReadyz(res, rpcUrl, keeperSecret)` exactly as specified in the design
    - Check `keeperSecret` first; return 503 `{"status":"degraded","reason":"signer key not configured"}` when absent/empty
    - Use `AbortController` with `setTimeout(() => controller.abort(), 5000)` for the fetch timeout
    - POST `{"jsonrpc":"2.0","id":1,"method":"getHealth"}` to `rpcUrl`
    - Return 200 `{"status":"ok"}` on success; 503 with an appropriate `reason` string on RPC failure, timeout (`AbortError`), or non-2xx status
    - Set `Content-Type: application/json` on all branches
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 3. Wire /healthz and /readyz into the existing HTTP router in metrics-server.ts
  - Replace the single-route `http.createServer` callback with a URL dispatch table that handles `/metrics` (existing), `/healthz`, `/readyz`, and 404 for all other paths
  - The router callback must be `async` to `await handleReadyz`
  - Pass `parseInt(process.env.INTERVAL_SECONDS ?? "120", 10)` to `handleHealthz`
  - Pass `process.env.RPC_URL ?? "https://soroban-testnet.stellar.org"` and `process.env.KEEPER_SECRET ?? process.env.SECRET_KEY ?? ""` to `handleReadyz`
  - _Requirements: 2.1, 3.1_

- [ ] 4. Update keeper.ts to call setLastLoopTick after each runCycle()
  - Add `setLastLoopTick` to the existing `import { … } from "./metrics-server.js"` statement
  - In `--once` mode: call `setLastLoopTick(Date.now())` immediately after `await runCycle()` and before `incrementCycles()`
  - In loop mode: call `setLastLoopTick(Date.now())` immediately after `await runCycle()` and before `incrementCycles()` inside the `while (!shutdown)` body
  - _Requirements: 1.1, 1.2_

- [ ] 5. Update the Dockerfile HEALTHCHECK to target /healthz
  - Replace the existing `HEALTHCHECK … CMD wget … --post-data … getHealth` instruction with:
    ```
    HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
      CMD wget -qO- "http://localhost:${METRICS_PORT:-9090}/healthz" | grep -q '"status":"ok"' || exit 1
    ```
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 6. Update docker-compose.yml keeper service healthcheck to target /healthz
  - Replace the keeper service `healthcheck.test` command with the wget GET call to `http://localhost:${METRICS_PORT:-9090}/healthz`
  - Set `interval: 60s`, `timeout: 10s`, `start_period: 30s`, `retries: 3`
  - Leave the indexer and metrics service health checks unchanged
  - _Requirements: 5.1, 5.2_

- [ ] 7. Write unit and property-based tests in scripts/__tests__/metrics-server-health.test.ts
  - [ ] 7.1 Write 7 example-based unit tests
    - Test 1: `/healthz` returns 200 + `reason:"loop not yet started"` when no tick registered (Req 2.2)
    - Test 2: `/healthz` returns 200 + `status:"ok"` when tick is within the staleness window (Req 2.3)
    - Test 3: `/healthz` returns 503 + `status:"degraded"` + `secondsSinceLastTick` when tick exceeds window (Req 2.4)
    - Test 4: `/readyz` returns 200 + `status:"ok"` when RPC mock returns 200 and `KEEPER_SECRET` is set (Req 3.3)
    - Test 5: `/readyz` returns 503 + `status:"degraded"` + `reason` when mocked `fetch` throws a network error (Req 3.4)
    - Test 6: `/readyz` returns 503 + `reason:"signer key not configured"` when `KEEPER_SECRET` is absent (Req 3.5)
    - Test 7: `/readyz` returns 503 + `reason:"rpc timeout"` when mocked `fetch` delays past 5 s (Req 3.7)
    - Use `vi.stubEnv` for environment variables and `vi.spyOn(globalThis, "fetch")` for the RPC mock; start the server on a random free port per describe block and tear it down in `afterAll`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 7.2 Write property-based test: Property 1 — fresh tick always healthy
    - **Property 1: Fresh tick always produces a healthy liveness response**
    - **Validates: Requirements 2.3**
    - Generate timestamps in `[now - staleLimit, now]` using fast-check `fc.integer`; for each call `setLastLoopTick(t)` and assert `/healthz` returns 200

  - [ ]* 7.3 Write property-based test: Property 2 — stale tick always degraded with correct elapsed
    - **Property 2: Stale tick always produces a degraded liveness response with correct elapsed time**
    - **Validates: Requirements 2.4**
    - Generate timestamps older than `staleLimit` using fast-check; assert 503 and `secondsSinceLastTick === Math.floor((Date.now() - t) / 1000)` within 1 second of skew

  - [ ]* 7.4 Write property-based test: Property 3 — non-empty KEEPER_SECRET with healthy RPC always ready
    - **Property 3: Non-empty KEEPER_SECRET with healthy RPC always produces a ready response**
    - **Validates: Requirements 3.3**
    - Generate arbitrary non-empty strings for `KEEPER_SECRET` using `fc.string({ minLength: 1 })`; stub fetch to return a 200 response; assert `/readyz` returns 200

  - [ ]* 7.5 Write property-based test: Property 4 — absent or empty KEEPER_SECRET always not-ready
    - **Property 4: Absent or empty KEEPER_SECRET always produces a not-ready response**
    - **Validates: Requirements 3.5**
    - Use `fc.constantFrom("", undefined)` for the secret value; assert 503 with `reason:"signer key not configured"` regardless of RPC mock

- [ ] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Update metrics-server.ts header comment and documentation
  - Extend the JSDoc file header comment to list `/healthz` and `/readyz` alongside `/metrics`, including HTTP status conditions for each
  - Update AGENTS.md wherever the metrics server is described to mention the two new endpoints and their semantics
  - _Requirements: 7.1, 7.2, 7.3_

## Notes

- Sub-tasks marked with `*` are optional and can be skipped for a faster MVP; the 7 non-optional unit tests in task 7.1 must always be implemented
- Each task references specific requirements for traceability
- The property-based tests (7.2–7.5) require fast-check (`fc`) to be available as a dev dependency in `scripts/package.json`; add it if absent
- The test file name `metrics-server-health.test.ts` matches the design document; it should be placed in `scripts/__tests__/`
- Both the `--once` and loop-mode call sites in `keeper.ts` need `setLastLoopTick`; missing either one leaves the first-tick window perpetually unset in one execution mode

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4", "5", "6"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 5, "tasks": ["9"] }
  ]
}
```
