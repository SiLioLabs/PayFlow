# Indexer HTTP API

A small, **read-only** HTTP API over the indexer's SQLite database
(`scripts/indexer-api.ts`). Dashboards and analytics can read indexed events and
merchant metrics without opening the database file or scanning the chain.

- Machine-readable spec: [`docs/openapi/indexer-api.json`](./openapi/indexer-api.json)
  (OpenAPI 3.0.3; also served live at `GET /openapi.json`).
- Metrics reuse `scripts/merchant-queries.ts`, so numbers match `merchant-analytics.ts` and
  `export-merchant-report.ts`.

## Running

```bash
cd scripts
DB_FILE=data/events.db npm run api          # http://127.0.0.1:3100
```

The indexer (`npm run indexer`) keeps writing to the same file; the API only reads it.
If the database file does not exist yet, endpoints answer `503 database_unavailable` and
start working as soon as the indexer creates it.

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3100` | Listen port |
| `API_HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` only behind a reverse proxy / firewall; there is no authentication. |
| `API_CORS_ORIGINS` | *(empty)* | Comma-separated allowed origins, or `*`. Empty = no CORS headers (same-origin/server-side use only). |
| `API_DEFAULT_LIMIT` | `50` | Page size when `limit` is omitted |
| `API_MAX_LIMIT` | `500` | Largest accepted `limit` (larger values are rejected with 400, not truncated) |
| `DATA_DIR` / `DB_FILE` | `data` / `data/events.db` | Same as `indexer.ts` |

## Endpoints

All endpoints are `GET` (plus `HEAD`, and `OPTIONS` for CORS preflight). Any other method
returns `405`. Amounts are strings in stroops. `address` must be a Stellar `G…`/`C…` address.

| Endpoint | Query parameters | Description |
|---|---|---|
| `/health` | – | `{"status":"ok"}` if the database can be read |
| `/openapi.json` | – | The OpenAPI document |
| `/v1/users/{address}/events` | `limit`, `offset`, `event_name` | Events where `address` is the actor/subscriber, newest first |
| `/v1/merchants/{address}/events` | `limit`, `offset`, `event_name` | Events with `merchant = address` (or by that address), newest first |
| `/v1/merchants/{address}/revenue` | – | Net revenue (charges − protocol fees), subscriber count, 30-day daily series, freshness |
| `/v1/merchants/{address}/churn` | `days` (1–365, default 30) | Churn %, growth %, revenue in window, freshness |

Event list responses:

```json
{
  "data": [{ "id": "…", "event_name": "charged", "address": "G…", "merchant": "G…",
             "amount": "1000", "fee_amount": "10", "token": null, "result_code": null,
             "ledger": 1234, "timestamp": 1760000000, "tx_hash": "…", "data": { } }],
  "pagination": { "limit": 50, "offset": 0, "total": 120, "has_more": true }
}
```

`churn_rate_percent` / `growth_rate_percent` are `null` when the merchant had no
subscribers at the start of the window. Revenue/churn read all analytics events, so cost
grows with database size; cache at the proxy if you poll frequently. Use `freshness.last_ledger`
to tell how current the data is.

## Errors

Every error uses the same body:

```json
{ "error": { "code": "invalid_request", "message": "limit must be between 1 and 500" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request` | Bad address, non-integer/out-of-range `limit`/`offset`/`days`, bad `event_name`, repeated or unknown query parameter, malformed URL encoding |
| 404 | `not_found` | Unknown path |
| 405 | `method_not_allowed` | Non-read method |
| 500 | `internal_error` | Unexpected/database error (details are logged server-side only) |
| 503 | `database_unavailable` | Database file missing or cannot be opened |

## Read-only guarantees

- The connection is opened with `readOnly: true` and `PRAGMA query_only = ON`.
- Only bound SQL parameters are used; `event_name` and addresses are validated first.
- Only read HTTP methods are routed.

## Maintaining the OpenAPI spec

The spec is generated from the same route table the server uses. After changing a route:

```bash
cd scripts && npm run api:openapi     # rewrites docs/openapi/indexer-api.json
```

A test fails if the committed file differs from the generated spec.
