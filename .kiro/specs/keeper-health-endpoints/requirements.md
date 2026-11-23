# Requirements Document

## Introduction

The PayFlow keeper runs a continuous loop that calls `runCycle()` on a fixed interval. The existing Docker health check probes the upstream Soroban RPC directly, which confirms network reachability but gives no signal about whether the keeper's own loop has stalled, the signer key is usable, or the in-process HTTP server is alive. This feature adds two HTTP health endpoints — `/healthz` (liveness) and `/readyz` (readiness) — to the existing metrics server on port 9090, and updates all container health checks to call `/healthz` instead of the RPC.

## Glossary

- **Keeper**: The TypeScript process (`keeper.ts`) that runs recurring `runCycle()` iterations to execute batch subscription charges.
- **MetricsServer**: The HTTP server in `metrics-server.ts` listening on `METRICS_PORT` (default 9090), currently serving `/metrics`.
- **Loop tick**: A single completed execution of `runCycle()` inside the keeper's main loop.
- **Liveness**: The property that the keeper's main loop is making progress (ticked within the configured staleness window).
- **Readiness**: The property that the keeper can accept and process work — the RPC endpoint is reachable and the signer key is configured.
- **Staleness window**: The maximum elapsed time since the last loop tick before the keeper is considered stuck; defaults to `2 × INTERVAL_SECONDS`.
- **INTERVAL_SECONDS**: The keeper environment variable controlling the sleep duration between cycles.
- **Signer**: The Stellar keypair used by the keeper to sign and submit transactions, configured via `KEEPER_SECRET`.
- **RPC**: The Soroban JSON-RPC endpoint, configured via `RPC_URL`.
- **Health state**: One of `"ok"` or `"degraded"`, reported in the JSON body of a health response.

## Requirements

### Requirement 1: Loop-tick timestamp registration

**User Story:** As an operator, I want the keeper to record a timestamp after every successful loop tick, so that the health system can determine whether the loop has stalled.

#### Acceptance Criteria

1. WHEN `runCycle()` completes inside the keeper's main loop, THE MetricsServer SHALL record the current wall-clock timestamp as the most recent loop-tick time.
2. THE MetricsServer SHALL expose a `setLastLoopTick(timestampMs: number)` function that keeper.ts calls to register the timestamp.
3. WHEN the keeper process starts but has not yet completed its first cycle, THE MetricsServer SHALL treat the last loop-tick time as unset.

### Requirement 2: /healthz liveness endpoint

**User Story:** As a container orchestrator, I want a `/healthz` endpoint that reflects whether the keeper loop is alive, so that a stuck loop triggers an unhealthy status.

#### Acceptance Criteria

1. THE MetricsServer SHALL serve `GET /healthz` on `METRICS_PORT`.
2. WHEN a `GET /healthz` request is received and the last loop-tick time is unset, THE MetricsServer SHALL respond with HTTP 200 and a JSON body `{"status":"ok","reason":"loop not yet started"}`.
3. WHEN a `GET /healthz` request is received and the elapsed time since the last loop tick is less than or equal to `2 × INTERVAL_SECONDS` milliseconds, THE MetricsServer SHALL respond with HTTP 200 and a JSON body containing `"status":"ok"`.
4. WHEN a `GET /healthz` request is received and the elapsed time since the last loop tick exceeds `2 × INTERVAL_SECONDS` milliseconds, THE MetricsServer SHALL respond with HTTP 503 and a JSON body containing `"status":"degraded"` and the number of seconds since the last tick in a `"secondsSinceLastTick"` field.
5. THE MetricsServer SHALL set the `Content-Type` response header to `application/json` for all `/healthz` responses.
6. WHEN `INTERVAL_SECONDS` is not supplied to the MetricsServer, THE MetricsServer SHALL use a default staleness window of 120 seconds.

### Requirement 3: /readyz readiness endpoint

**User Story:** As a container orchestrator, I want a `/readyz` endpoint that confirms the keeper's external dependencies are reachable before routing work to the container.

#### Acceptance Criteria

1. THE MetricsServer SHALL serve `GET /readyz` on `METRICS_PORT`.
2. WHEN a `GET /readyz` request is received, THE MetricsServer SHALL verify that the RPC endpoint returns a successful response to a `getHealth` JSON-RPC call.
3. WHEN a `GET /readyz` request is received and the RPC check succeeds and `KEEPER_SECRET` is set to a non-empty value, THE MetricsServer SHALL respond with HTTP 200 and a JSON body containing `"status":"ok"`.
4. WHEN a `GET /readyz` request is received and the RPC check fails, THE MetricsServer SHALL respond with HTTP 503 and a JSON body containing `"status":"degraded"` and a `"reason"` field describing the failure.
5. WHEN a `GET /readyz` request is received and `KEEPER_SECRET` is absent or empty, THE MetricsServer SHALL respond with HTTP 503 and a JSON body containing `"status":"degraded"` and `"reason":"signer key not configured"`.
6. THE MetricsServer SHALL set the `Content-Type` response header to `application/json` for all `/readyz` responses.
7. WHEN the RPC check for `/readyz` does not complete within 5000 milliseconds, THE MetricsServer SHALL treat the check as failed and include `"reason":"rpc timeout"` in the response body.

### Requirement 4: Dockerfile HEALTHCHECK update

**User Story:** As an operator, I want the Docker container health check to use `/healthz` instead of the RPC, so that a stuck keeper loop is detected by the orchestrator.

#### Acceptance Criteria

1. THE Dockerfile SHALL define a `HEALTHCHECK` instruction that sends a `GET` request to `http://localhost:${METRICS_PORT:-9090}/healthz`.
2. THE Dockerfile `HEALTHCHECK` SHALL exit with code 0 when `/healthz` returns HTTP 200 and exit with a non-zero code otherwise.
3. THE Dockerfile `HEALTHCHECK` SHALL use an interval of 60 seconds, a timeout of 10 seconds, a start period of 30 seconds, and a retry count of 3.

### Requirement 5: docker-compose.yml keeper healthcheck update

**User Story:** As an operator using Docker Compose, I want the keeper service health check to target `/healthz`, so that the Compose stack reports the keeper as unhealthy when its loop stalls.

#### Acceptance Criteria

1. THE docker-compose.yml keeper service SHALL define a `healthcheck.test` command that sends a `GET` request to `http://localhost:${METRICS_PORT:-9090}/healthz`.
2. THE docker-compose.yml keeper service `healthcheck` SHALL use an interval of 60 seconds, a timeout of 10 seconds, a start period of 30 seconds, and a retry count of 3.

### Requirement 6: Automated tests

**User Story:** As a developer, I want unit and integration tests for the new health endpoints, so that regressions are caught in CI.

#### Acceptance Criteria

1. THE test suite SHALL include a test verifying that `/healthz` returns HTTP 200 when the loop tick was registered within the staleness window.
2. THE test suite SHALL include a test verifying that `/healthz` returns HTTP 503 when the elapsed time since the last loop tick exceeds the staleness window.
3. THE test suite SHALL include a test verifying that `/healthz` returns HTTP 200 when no loop tick has been registered yet.
4. THE test suite SHALL include a test verifying that `/readyz` returns HTTP 200 when the RPC check succeeds and `KEEPER_SECRET` is set.
5. THE test suite SHALL include a test verifying that `/readyz` returns HTTP 503 when the RPC check fails.
6. THE test suite SHALL include a test verifying that `/readyz` returns HTTP 503 when `KEEPER_SECRET` is absent.
7. WHEN tests run, THE test suite SHALL mock or stub the outbound RPC call so that tests do not require a live network connection.

### Requirement 7: Documentation update

**User Story:** As a developer or operator, I want the metrics-server documentation to describe the new endpoints, so that health probe configuration is discoverable.

#### Acceptance Criteria

1. THE metrics-server.ts file header comment SHALL document `/healthz` and `/readyz` alongside the existing `/metrics` route description.
2. THE metrics-server.ts file header comment SHALL state the conditions under which each endpoint returns HTTP 200 versus HTTP 503.
3. WHERE a project README or AGENTS.md documents the metrics server, THE documentation SHALL be updated to include the `/healthz` and `/readyz` endpoints and their semantics.
