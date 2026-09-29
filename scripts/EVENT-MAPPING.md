# Contract Event Mapping to Database Schema

This document maps contract events (from `contract/src/events.rs`) to the indexer database schema (`scripts/indexer.ts`).

## Database Schema

The indexer stores events in SQLite:

```sql
CREATE TABLE events (
  id         TEXT    PRIMARY KEY,      -- Stable dedup key: <tx_hash>:<op_index>:<event_index>
  event_name TEXT    NOT NULL,         -- Topic[0] from contract event
  address    TEXT    NOT NULL,         -- Topic[1] (subscriber/actor address)
  amount     TEXT,                     -- Extracted from event value (gross, amount, net, fee)
  ledger     INTEGER NOT NULL,         -- Ledger sequence
  timestamp  INTEGER NOT NULL,         -- Unix seconds from ledgerClosedAt
  tx_hash    TEXT    NOT NULL,         -- Transaction hash for dedup
  raw_data   TEXT    NOT NULL,         -- Full JSON event value
  merchant   TEXT,                     -- Extracted from event value
  fee_amount TEXT,                     -- Extracted from event value
  token      TEXT,                     -- Extracted from event value (token, asset)
  result_code TEXT                     -- Extracted from event value (result_code, error, status)
);
```

## Contract Events → Indexer Rows

### Subscription Lifecycle

| Event | Topic[0] | Topic[1] | Example Row |
|-------|----------|----------|-------------|
| subscribe | `subscribed` | user_address | `event_name='subscribed', address=user, merchant=merchant, amount=subscription_amount` |
| cancel | `cancelled` | user_address | `event_name='cancelled', address=user` |
| cancel (refund) | `cancelled_with_refund` | user_address | `event_name='cancelled_with_refund', address=user, amount=refund_amount` |
| pause | `paused` / `subscription_paused` | user_address | `event_name='paused', address=user` |
| resume | `resumed` / `subscription_auto_resumed` | user_address | `event_name='resumed', address=user` |
| transfer | `subscription_transferred` | from_user | `event_name='subscription_transferred', address=from_user, raw_data={to_user, ...}` |

### Charging & Pay-Per-Use

| Event | Topic[0] | Topic[1] | Example Row | Alerting Relevance |
|-------|----------|----------|-------------|-------------------|
| charge success | `charged` | user_address | `event_name='charged', address=user, amount=gross, fee_amount=fee, merchant=merchant` | ✓ Confirms successful charge |
| batch summary | `batch_charge_skips` | (none) | `event_name='batch_charge_skips', raw_data={total, charged, allowance_insufficient, ...}` | **✓ CHARGE FAILURE SIGNAL** |
| pay-per-use | `pay_per_use` | user_address | `event_name='pay_per_use', address=user, amount=amount, merchant=merchant` | Instant payment (not batch) |

### Grace Period & Trial

| Event | Topic[0] | Topic[1] | Example Row |
|-------|----------|----------|-------------|
| grace period proposed | `grace_period_proposed` | (none) | `event_name='grace_period_proposed', raw_data={seconds}` |
| grace period committed | `grace_period_committed` | (none) | `event_name='grace_period_committed', raw_data={seconds}` |
| trial extended | `trial_extended` | user_address | `event_name='trial_extended', address=user, raw_data={additional_seconds, ...}` |
| daily window started | `daily_window_started` | user_address | `event_name='daily_window_started', address=user` |

### Admin & Policy

| Event | Topic[0] | Topic[1] | Example Row |
|-------|----------|----------|-------------|
| merchant added | `merchant_added` | merchant | `event_name='merchant_added', address=merchant` |
| merchant frozen | `merchant_frozen` | merchant | `event_name='merchant_frozen', address=merchant` |
| contract paused | `contract_paused` | (none) | `event_name='contract_paused'` |
| contract unpaused | `contract_unpaused` | (none) | `event_name='contract_unpaused'` |
| upgrade proposed | `upg_proposed` | (none) | `event_name='upg_proposed', raw_data={wasm_hash}` |
| upgrade completed | `upgrade` | (none) | `event_name='upgrade'` |

## Charge Failure Alerting

### The Signal: `batch_charge_skips`

When `batch_charge()` is called, the contract publishes one `batch_charge_skips` event per batch if *any* interesting outcome occurred (not all charged, not all skipped due to interval). The event includes:

```typescript
pub struct BatchChargeSkipsEventData {
    pub total: u32,                    // Addresses submitted
    pub charged: u32,                  // Succeeded
    pub not_due: u32,                  // Interval not elapsed
    pub no_subscription: u32,          // User has no subscription
    pub inactive: u32,                 // Subscription cancelled
    pub paused: u32,                   // Subscription paused
    pub grace_elapsed: u32,            // Grace period expired (will retry)
    pub allowance_insufficient: u32,   // <-- ALERTING CASE: subscriber's allowance < gross
    pub ledger_sequence: u32,
}
```

### Query for Failed Charges

```sql
SELECT raw_data FROM events
WHERE event_name = 'batch_charge_skips'
  AND timestamp >= ?
ORDER BY timestamp DESC
```

Then parse `raw_data` JSON:
- If `allowance_insufficient > 0`: Subscriptions are ready to charge but blocked by insufficient allowance
  - Action: Send alert to merchant/subscriber to re-approve allowance
- If `allowance_insufficient == 0`: All non-charged outcomes are due to subscription state (paused, cancelled, no subscription)
  - Action: No alert needed (handled by subscriber/keeper directly)

### Alert Payload

See `scripts/alert-failed-charges.ts` for the webhook structure:

```typescript
interface AlertPayload {
  generated_at: string;     // ISO timestamp
  total_failed: number;     // Count of allowance_insufficient outcomes
  failed_charges: Array<{
    user_address: string;   // "batch_summary" or per-user if enriched
    reason: string;         // "allowance_insufficient"
    subscription_amount: number;
  }>;
}
```

## Integration Points

### Indexer
- `scripts/indexer.ts` — Polls RPC, parses contract events, upserts to SQLite
- Deduplication: Stable key `<tx_hash>:<op_index>:<event_index>`
- Last ledger tracked in `meta` table for resumption

### Alert Script
- `scripts/alert-failed-charges.ts` — Queries `batch_charge_skips` events
- Filters for `allowance_insufficient > 0`
- POSTs webhook if failures found
- Can accept `--since <unix-ts>` to query recent events

### Keeper Bot
- `scripts/keeper.ts` — Calls `batch_charge()` on contract
- Observes return value directly (not event-driven)
- Events are for off-chain subscribers (alert scripts, dashboards)

### Monitoring Dashboards
- `scripts/subscriber-health-dashboard.ts` — Can query events to show subscription state changes
- `scripts/watch-events.ts` — Real-time event stream for debugging
