# Design Document

## Overview

This feature adds two HTTP health endpoints — `/healthz` (liveness) and `/readyz` (readiness) — to the existing metrics server in `scripts/metrics-server.ts`, and replaces all Dockerfile and docker-compose health checks that probe the upstream Soroban RPC with probes targeting `/healthz`. A new module-level export `setLastLoopTick(timestampMs: number)` lets `keeper.ts` register each completed cycle so the liveness check can determine whether the loop has stalled.

## Architecture

The metrics server (`metrics-server.ts`) is a single-process HTTP server already listening on `METRICS_PORT` (default 9090) and serving `/metrics`. It is imported as a module by `keeper.ts` through its exported record-and-gauge functions.

The new health layer follows the same pattern: purely module-level state (no new classes), two new exported functions (`setLastLoopTick`, already described), and two new URL handlers wired into the single `http.createServer` callback. The keeper calls `setLastLoopTick(Date.now())` immediately after each `runCycle()` returns. The readiness check makes an outbound `fetch` to the RPC with a 5 second timeout using `AbortController`; it does not reuse any existing RPC client so there is no circular dependency.

```
keeper.ts                  metrics-server.ts (port 9090)
   │                              │
   ├─ startMetricsServer()        │
   ├─ runCycle()                  │
   └─ setLastLoopTick(Date.now()) │
                                  │
   Docker / orchestrator          │
   ├─ GET /healthz ──────────────►├─ compare Date.now() vs lastLoopTickMs
   └─ GET /readyz  ──────────────►├─ fetch RPC getHealth (5 s timeout)
                                  └─ check KEEPER_SECRET non-empty
```

## Components and Interfaces

### 1. Loop-tick state (metrics-server.ts)

A module-level variable holds the last tick timestamp.

```typescript
let lastLoopTickMs: number | undefined = undefined;
```

`setLastLoopTick(timestampMs: number): void` sets it. It is exported so `keeper.ts` can call it after each `runCycle()`. The variable starts as `undefined` (unset before first tick).

### 2. /healthz handler

The handler is added to the existing `http.createServer` callback, matched on `req.url === "/healthz"`.

```typescript
function handleHealthz(res: http.ServerResponse, intervalSeconds: number): void {
  const staleLimitMs = 2 * intervalSeconds * 1000;
  const now = Date.now();

  if (lastLoopTickMs === undefined) {
    // Pre-first-tick: healthy by design — the process just started
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", reason: "loop not yet started" }));
    return;
  }

  const elapsedMs = now - lastLoopTickMs;
  if (elapsedMs <= staleLimitMs) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    const secondsSinceLastTick = Math.floor(elapsedMs / 1000);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "degraded", secondsSinceLastTick }));
  }
}
```

`intervalSeconds` is read from `process.env.INTERVAL_SECONDS` with a default of `120` (60 × 2 = 120 s default staleness window when `INTERVAL_SECONDS` is not set). The staleness window is `2 × INTERVAL_SECONDS` seconds.

### 3. /readyz handler

```typescript
async function handleReadyz(
  res: http.ServerResponse,
  rpcUrl: string,
  keeperSecret: string,
): Promise<void> {
  // Check signer key first (cheap)
  if (!keeperSecret) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "degraded", reason: "signer key not configured" }));
    return;
  }

  // Probe RPC with a 5 s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "degraded", reason: `rpc returned ${response.status}` }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = (err as Error).name === "AbortError";
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "degraded",
      reason: isTimeout ? "rpc timeout" : `rpc error: ${(err as Error).message}`,
    }));
  }
}
```

### 4. Updated HTTP router

The `http.createServer` callback gains a URL dispatch table:

```typescript
server = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    // existing handler
  } else if (req.url === "/healthz") {
    handleHealthz(res, INTERVAL_SECONDS);
  } else if (req.url === "/readyz") {
    await handleReadyz(res, RPC_URL, process.env.KEEPER_SECRET ?? process.env.SECRET_KEY ?? "");
  } else {
    res.writeHead(404);
    res.end();
  }
});
```

### 5. keeper.ts integration

After each `runCycle()` call in the keeper's main loop, the keeper calls:

```typescript
import { setLastLoopTick } from "./metrics-server.js";
// ...
await runCycle();
setLastLoopTick(Date.now());
```

No other changes to keeper logic are needed.

### 6. Dockerfile HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- "http://localhost:${METRICS_PORT:-9090}/healthz" | grep -q '"status":"ok"' || exit 1
```

This replaces the existing `wget` POST to the RPC endpoint.

### 7. docker-compose.yml healthcheck (keeper service)

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- \"http://localhost:${METRICS_PORT:-9090}/healthz\" | grep -q '\"status\":\"ok\"' || exit 1"]
  interval: 60s
  timeout: 10s
  start_period: 30s
  retries: 3
```

The indexer and metrics services keep their own existing health checks (they do not use the keeper loop tick).

## Data Models

### /healthz response (pre-first-tick)

```typescript
interface HealthzPreFirstTick {
  status: "ok";
  reason: "loop not yet started";
}
```

### /healthz response (healthy tick)

```typescript
interface HealthzOk {
  status: "ok";
}
```

### /healthz response (stale tick)

```typescript
interface HealthzDegraded {
  status: "degraded";
  secondsSinceLastTick: number;  // integer seconds
}
```

### /readyz response (ok)

```typescript
interface ReadyzOk {
  status: "ok";
}
```

### /readyz response (degraded)

```typescript
interface ReadyzDegraded {
  status: "degraded";
  reason: string;  // "signer key not configured" | "rpc timeout" | "rpc returned <N>" | "rpc error: <msg>"
}
```

## Error Handling

| Scenario | Behavior |
|---|---|
| `INTERVAL_SECONDS` absent | Use default of `120` for the staleness window (represents `2 × 60s`) |
| Last tick unset (startup) | `/healthz` → 200 with `reason:"loop not yet started"` |
| Last tick within `2 × INTERVAL_SECONDS` | `/healthz` → 200 |
| Last tick older than `2 × INTERVAL_SECONDS` | `/healthz` → 503 with `secondsSinceLastTick` |
| `KEEPER_SECRET` empty or absent | `/readyz` → 503 with `reason:"signer key not configured"` |
| RPC `fetch` times out in 5 s | `/readyz` → 503 with `reason:"rpc timeout"` |
| RPC `fetch` throws a network error | `/readyz` → 503 with `reason:"rpc error: <message>"` |
| RPC returns non-2xx status | `/readyz` → 503 with `reason:"rpc returned <N>"` |
| Metrics handler itself throws | Existing 500 path; health handlers are separate branches so they do not interfere |

## Test Design

Tests live in `scripts/__tests__/metrics-server-health.test.ts` and use Vitest.

The test file imports the functions under test directly (`startMetricsServer`, `stopMetricsServer`, `setLastLoopTick`) and uses `vi.stubEnv` / `vi.spyOn` on `globalThis.fetch` to mock the outbound RPC call. The server is started on a random port for each describe block to avoid port conflicts with parallel test suites.

Seven test cases required by the requirements:

1. `/healthz` → 200 when tick is within staleness window
2. `/healthz` → 503 when tick exceeds staleness window
3. `/healthz` → 200 when no tick registered (pre-first-tick)
4. `/readyz` → 200 when RPC mock returns success and `KEEPER_SECRET` is set
5. `/readyz` → 503 when RPC mock throws an error
6. `/readyz` → 503 when `KEEPER_SECRET` is absent

Additional test for the timeout case (Requirement 3.7) can be included as a 7th case using a mock that delays and an `AbortError`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Fresh tick always produces a healthy liveness response

*For any* timestamp value `t` that is at most `2 × INTERVAL_SECONDS` milliseconds in the past, calling `setLastLoopTick(t)` and then `GET /healthz` SHALL return HTTP 200 with `status:"ok"`.

**Validates: Requirements 2.3**

### Property 2: Stale tick always produces a degraded liveness response with correct elapsed time

*For any* timestamp value `t` that is more than `2 × INTERVAL_SECONDS` milliseconds in the past, calling `setLastLoopTick(t)` and then `GET /healthz` SHALL return HTTP 503 with `status:"degraded"` and a `secondsSinceLastTick` value that equals `Math.floor((Date.now() - t) / 1000)` (within 1 second of measurement skew).

**Validates: Requirements 2.4**

### Property 3: Non-empty KEEPER_SECRET with healthy RPC always produces a ready response

*For any* non-empty string value of `KEEPER_SECRET` and a mocked RPC that returns a 2xx response, `GET /readyz` SHALL return HTTP 200 with `status:"ok"`.

**Validates: Requirements 3.3**

### Property 4: Absent or empty KEEPER_SECRET always produces a not-ready response

*For any* value of `KEEPER_SECRET` that is absent or the empty string, `GET /readyz` SHALL return HTTP 503 with `status:"degraded"` and `reason:"signer key not configured"`, regardless of RPC availability.

**Validates: Requirements 3.5**

## Testing Strategy

### Unit Tests (example-based)

- `/healthz` pre-first-tick: no `setLastLoopTick` call → 200 with `reason:"loop not yet started"` and `Content-Type: application/json`
- `/healthz` fresh tick: tick registered within the staleness window → 200 with `status:"ok"`
- `/healthz` stale tick: tick registered beyond the staleness window → 503 with `status:"degraded"` and `secondsSinceLastTick` present
- `/readyz` happy path: mocked RPC returns 200, `KEEPER_SECRET` non-empty → 200 with `status:"ok"`
- `/readyz` RPC failure: mocked `fetch` throws → 503 with `status:"degraded"` and a `reason` field
- `/readyz` missing secret: `KEEPER_SECRET` empty or absent → 503 with `reason:"signer key not configured"`
- `/readyz` timeout: mocked `fetch` delays past 5 s → 503 with `reason:"rpc timeout"`

All tests mock the outbound RPC `fetch` via `vi.spyOn(globalThis, "fetch")` and use `vi.stubEnv` for environment variables. The server is started on a dedicated test port and torn down after each suite.

### Property-Based Tests

- **Property 1 (fresh tick)**: Generate timestamps in the range `[now - staleLimit, now]`; for each, set the tick and assert `/healthz` returns 200.
- **Property 2 (stale tick)**: Generate timestamps older than `staleLimit`; for each, set the tick and assert `/healthz` returns 503 with a `secondsSinceLastTick` consistent with elapsed time.
- **Property 3 (non-empty secret)**: Generate arbitrary non-empty strings for `KEEPER_SECRET` with a mocked healthy RPC; assert `/readyz` returns 200.
- **Property 4 (empty secret)**: For absent and empty-string `KEEPER_SECRET`, assert `/readyz` returns 503 with `reason:"signer key not configured"`.
