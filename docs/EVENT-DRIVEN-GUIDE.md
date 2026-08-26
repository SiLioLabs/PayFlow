# Event-Driven Integration Cookbook

[`docs/EVENTS.md`](EVENTS.md) is a reference: it lists every event the FlowPay contract emits and the shape of its payload. This guide is the companion **cookbook** — it shows you how to actually _build_ something on top of those events: a keeper, an analytics pipeline, a notification service, or a reconciliation job.

If you are looking for "what event fires when `X` happens", go to [EVENTS.md](EVENTS.md). If you are looking for "how do I reliably consume these events without missing or double-processing anything", you're in the right place. Merchants wiring `subscribed` / `charged` / `cancelled` / `pay_per_use` into a billing dashboard should also read the [Merchant Integration Cookbook](MERCHANT-INTEGRATION.md#4-handling-events).

---

## Table of Contents

- [Quick Start](#quick-start)
- [The Soroban Event Model](#the-soroban-event-model)
- [Event Consumption](#event-consumption)
- [Deduplication](#deduplication)
- [Event Ordering](#event-ordering)
- [Reaction Patterns](#reaction-patterns)
- [Reliability](#reliability)
- [Event → Consumer Reference Table](#event--consumer-reference-table)
- [Reference Implementations](#reference-implementations)
- [Related Documentation](#related-documentation)

---

## Quick Start

Minimal end-to-end loop for a production-shaped consumer:

1. **Bookmark** — persist `lastProcessedLedger` (or the last `pagingToken`) in durable storage.
2. **Poll** — call Soroban RPC `getEvents` from that bookmark (see [Event Consumption](#event-consumption)).
3. **Decode** — convert topic/value `ScVal`s with `scValToNative()`; first topic is always the FlowPay event name.
4. **Dedupe** — upsert on `tx_hash + event_name + ledger` (plus user address when the event is user-scoped); see [Deduplication](#deduplication).
5. **React** — run one of the [Reaction Patterns](#reaction-patterns), gating side effects on a successful insert.
6. **Advance** — only then persist the new cursor. Never advance on a failed fetch or partial batch.
7. **Watch for gaps** — alert when `latestLedger - lastProcessedLedger` exceeds your lag budget ([Reliability](#reliability)).

Start from [`scripts/watch-events.ts`](../scripts/watch-events.ts) for a live poller, or [`scripts/replay-events.ts`](../scripts/replay-events.ts) when backfilling a ledger range.

```ts
async function tick(server: Server, contractId: string, cursor: CursorStore) {
  const fromLedger = await cursor.getLastProcessedLedger();
  const events = await fetchEventsPage(server, contractId, fromLedger); // cursor-paginated
  events.sort((a, b) => a.ledger - b.ledger || a.txIndex - b.txIndex);

  for (const event of events) {
    if (await upsertEvent(event)) {
      await react(event); // keeper | analytics | notify | reconcile
    }
  }

  if (events.length > 0) {
    await cursor.setLastProcessedLedger(events.at(-1)!.ledger);
  }
}
```

---

## The Soroban Event Model

Every FlowPay state change publishes a **contract event** via `env.events().publish((topics...), data)` (see [`docs/CONTRIBUTING-CONTRACT.md`](CONTRIBUTING-CONTRACT.md#event-emission-rules) for the emission rules contributors follow). Structurally, a Soroban contract event looks like this once it comes back from RPC:

```json
{
  "type": "contract",
  "ledger": 123456,
  "ledgerClosedAt": "2026-06-01T12:00:00Z",
  "contractId": "CA...CONTRACT",
  "id": "0000123456-0000000001",
  "pagingToken": "123456-1",
  "topic": ["AAAAA...base64-scval", "AAAAA...base64-scval"],
  "value": "AAAAA...base64-scval",
  "txHash": "9f8c...ab12"
}
```

A few properties matter for anyone building an integration:

- **Topics are the event's "routing key".** FlowPay always puts the event name first (`"charged"`, `"subscribed"`, `"cancelled"`, ...) and, for user-scoped events, the user's `Address` second. This is what `docs/EVENTS.md` documents per-event as `Topic keys`.
- **The payload (`value`) is a Soroban `ScVal`**, not plain JSON. The Stellar SDK's `scValToNative()` converts it into a JS-native object/array — that's how the reference scripts in this repo decode events.
- **Events are per-ledger, per-transaction.** A single `batch_charge()` call can emit multiple `charged` events (one per user actually charged) inside one transaction, all attached to the same `ledger` and `txHash`.
- **Events are not stored forever.** Soroban RPC only retains events for a limited retention window (this varies by RPC provider, but assume something on the order of a week on public RPC infrastructure). If you need history older than that, you must have already captured and persisted it — there is no "replay from genesis" via `getEvents`.

This last point is the reason event-driven integrations need a _cursor_ (see below) instead of re-querying "all events" on every run.

---

## Event Consumption

### Polling with `getEvents`

Soroban RPC does not push events to you — there is no native event subscription/webhook. Every consumer polls `getEvents` on the RPC server:

```ts
import { Server } from "@stellar/stellar-sdk/rpc";

const server = new Server(RPC_URL);

const response = await server.getEvents({
  startLedger: fromLedger,
  filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
  limit: 100,
});
```

`response.events` is an array of raw events (shape above); `response.latestLedger` tells you how far the RPC node has indexed. See [`scripts/watch-events.ts`](../scripts/watch-events.ts) for a full working poll loop.

### Cursor-based pagination

`getEvents` returns a `cursor` (`pagingToken` on each event) you use instead of `startLedger` once you've already fetched the first page of a range — this lets you page through a large ledger range without re-fetching:

```ts
let cursor: string | undefined;
let events = [];

do {
  const response = await server.getEvents({
    startLedger: cursor ? undefined : fromLedger,
    cursor,
    filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
    limit: 1000,
  });

  events.push(...response.events);
  cursor = response.events.at(-1)?.pagingToken;

  if (response.events.length < 1000) break; // exhausted this range
} while (true);
```

[`scripts/replay-events.ts`](../scripts/replay-events.ts) implements exactly this pattern for backfilling a historical ledger range in batches (see `fetchBatch()`), which is the reference implementation to read alongside this section.

**The rule that matters:** always persist the _last processed ledger_ (or the last `pagingToken`) as your cursor. On every poll, resume from there — never from a hardcoded `startLedger`, or you will reprocess (and potentially double-react to) the same events forever.

### Filtering by topic

You can narrow `getEvents` to a single event name (or a set of names) by filtering on the first topic. Useful when a consumer only cares about `charged` or `cancelled`:

```ts
const response = await server.getEvents({
  startLedger: fromLedger,
  filters: [
    {
      type: "contract",
      contractIds: [CONTRACT_ID],
      // First topic = event name (Symbol). Exact encoding depends on SDK helpers;
      // omitting topics returns every FlowPay event for the contract.
      topics: [["charged"]],
    },
  ],
  limit: 100,
});
```

For most integrations, fetch _all_ contract events and branch in application code — topic filters are an optimization once volume grows.

### Recommended polling interval

| Consumer class                       | Recommended interval | Why                                                                                                                                                |
| ------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-time dashboards / notifications | **3–5 seconds**      | Matches Soroban ~5 s ledger close; faster wastes RPC quota. [`watch-events.ts`](../scripts/watch-events.ts) defaults to `POLL_INTERVAL_MS = 3000`. |
| Keepers reacting to events           | **30–60 seconds**    | Billing cycles are not sub-minute (see [`docs/KEEPER.md`](KEEPER.md)).                                                                             |
| Analytics / reconciliation jobs      | **minutes to hours** | Usually process a completed ledger range, not the chain tip.                                                                                       |

Polling faster than the ledger close time wastes RPC quota without getting you fresher data; polling much slower than your reaction SLA means your keeper/notifier lags behind real activity.

---

## Deduplication

### Why events can appear twice

Event consumers must be idempotent. There are several concrete reasons the same logical event can be observed more than once by a poller:

1. **Cursor replay after a crash.** If your service crashes after processing an event but before persisting the new cursor, the next run will re-fetch and re-process that event.
2. **Overlapping poll windows.** If you poll `[ledger N, latest]` on every tick without a precise cursor, and processing is slow, you can fetch the same ledger range twice before advancing your bookmark.
3. **RPC node reorg/catch-up quirks.** Public RPC providers occasionally re-serve a small overlap window around their own indexing checkpoints.
4. **Manual replay.** Running [`replay-events.ts`](../scripts/replay-events.ts) to backfill a range you've already processed (e.g., after a bug fix) will legitimately re-emit events you already have.

None of these mean the chain emitted the event twice — the contract only publishes each event once, in the one transaction that triggered it. It's the _consumer side_ that can observe the same event more than once.

### Deduplication key: `tx_hash` + `event_name` + `ledger`

The acceptance-grade composite key for FlowPay events is:

```
tx_hash + event_name + ledger
```

Because a single transaction can emit multiple events of the same type for different users (e.g., `batch_charge()` charging 10 subscribers emits 10 `charged` events in one `txHash`), that triple alone is **not** unique when the event is user-scoped. Production consumers should extend it with the address from topic[1]:

```
dedup_key = `${ledger}:${txHash}:${eventName}:${userAddress}`
```

This mirrors what [`watch-events.ts`](../scripts/watch-events.ts) already does (`parseEvent()` builds `id = ${ledger}:${txHash}:${eventType}:${user}`) and what [`replay-events.ts`](../scripts/replay-events.ts) relies on for its upsert semantics.

```ts
function dedupKey(event: ParsedEvent): string {
  return `${event.ledger}:${event.txHash}:${event.type}:${event.user}`;
}

const seen = new Set<string>(); // or a persistent set (Redis/DB) across restarts

function isDuplicate(event: ParsedEvent): boolean {
  const key = dedupKey(event);
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}
```

**In-memory `Set` is only good for a single process's uptime.** Any consumer that needs to survive restarts (a keeper, an analytics indexer) should persist the dedup key — typically as a unique constraint in your database (`UNIQUE(ledger, tx_hash, event_name, user_address)`) so that a duplicate insert is a no-op or a conflict you can safely ignore, rather than a set you rebuild from scratch on every boot.

### Upsert over insert

The most robust pattern is not "check then insert" (which races under concurrent consumers) but **upsert on the same composite key**, exactly as [`replay-events.ts`](../scripts/replay-events.ts) describes in `upsertEvent()`:

```ts
async function upsertEvent(event: ParsedEvent): Promise<void> {
  await db.query(
    `INSERT INTO contract_events (ledger, tx_hash, event_name, user_address, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ledger, tx_hash, event_name, user_address) DO NOTHING`,
    [event.ledger, event.txHash, event.type, event.user, event.data],
  );
}
```

Replaying the same ledger range twice then produces the same final state — no duplicate charge records, no duplicate notifications sent (as long as the "send notification" side effect is gated on a successful insert, not on merely observing the event).

---

## Event Ordering

**Within a single transaction**, events are ordered exactly as the contract published them — Soroban preserves publish order within one contract invocation. For FlowPay, this means if `batch_charge()` charges users A, B, C in that order, the returned events (and the `ChargeResult` vector) preserve that order.

**Within a single ledger**, transactions execute in the order the network applies them, and `getEvents` returns events in ledger-then-transaction-then-publish order. So events _within_ one `getEvents` response for a given ledger are ordered.

**Across ledgers fetched via polling, ordering is only as good as your poll loop.** If you fetch ledger range `[100, 105]` in one call, you get events in ledger order. But if two separate poll ticks fetch overlapping or out-of-sequence ranges (e.g., due to a bug in cursor handling, or fetching from two different RPC nodes with different indexing lag), you can _observe_ events out of ledger order at the consumer even though the chain itself has a strict order.

**Practical guidance:**

- If your reaction genuinely depends on order (e.g., a reconciliation job replaying `subscribed` → `charged` → `cancelled` to reconstruct a subscription's lifecycle), sort the batch you fetch by `(ledger, event index within ledger)` before processing, rather than assuming arrival order from RPC is authoritative — [`watch-events.ts`](../scripts/watch-events.ts) does this defensively (`newEvents.sort((a, b) => a.timestamp - b.timestamp)`) even though same-ledger events are already ordered.
- Never assume "the event I received most recently is the newest state." Always key final state off the event's `ledger` (and transaction position within it if you need sub-ledger precision), not off wall-clock receipt time.
- Do not parallelize processing of events for the _same user_ — process them sequentially in ledger order, or you can apply a `charged` event before the `subscribed` event that created the subscription it belongs to.

---

## Reaction Patterns

Below are four illustrative patterns for reacting to FlowPay events. These are **sketches**, not production-ready code — see [Reference Implementations](#reference-implementations) for the scripts that actually run.

### 1. Keeper pattern

A keeper doesn't strictly need to _consume_ events to do its job (it drives `batch_charge()` proactively based on subscriber state, see [`docs/KEEPER.md`](KEEPER.md)) — but keepers commonly watch `charged` / `GracePeriodElapsed`-adjacent state to decide retry cadence and to avoid re-attempting users who were already charged this cycle by a concurrent keeper run.

```ts
async function reactToChargeEvents(events: ParsedEvent[]) {
  for (const event of events) {
    if (event.type !== "charged") continue;
    if (isDuplicate(event)) continue;

    // Mark this user as "settled for this cycle" so a concurrent keeper
    // run (or a retry after a partial batch failure) skips them.
    await markChargedThisCycle(event.user, event.ledger);
  }
}
```

### 2. Analytics pattern

Aggregate revenue, active-subscriber counts, and churn by folding events into a time-series store.

```ts
async function ingestForAnalytics(event: ParsedEvent) {
  if (isDuplicate(event)) return;

  switch (event.type) {
    case "charged":
      await analyticsDb.recordRevenue({
        merchant: event.merchant,
        grossStroops: event.amount,
        ledger: event.ledger,
        timestamp: event.timestamp,
      });
      break;
    case "subscribed":
      await analyticsDb.incrementActiveSubscribers(event.merchant);
      break;
    case "cancelled":
      await analyticsDb.decrementActiveSubscribers(event.merchant, event.user);
      break;
  }
}
```

### 3. Notification pattern

React to user-facing events by sending an email/push/webhook. The key discipline here is gating the side effect (sending the notification) on the dedup/upsert succeeding, so a replay never double-sends.

```ts
async function notifyUser(event: ParsedEvent) {
  const inserted = await db.query(
    `INSERT INTO notification_log (dedup_key) VALUES ($1)
     ON CONFLICT DO NOTHING RETURNING dedup_key`,
    [dedupKey(event)],
  );
  if (inserted.rowCount === 0) return; // already notified for this event

  switch (event.type) {
    case "charged":
      await sendEmail(event.user, "payment-successful", {
        amount: event.amount,
      });
      break;
    case "cancelled":
      await sendEmail(event.user, "subscription-cancelled", {});
      break;
    case "merchant_frozen":
      await sendMerchantAlert(event.merchant, "account-frozen");
      break;
  }
}
```

### 4. Reconciliation pattern

Periodically replay a ledger range (using [`replay-events.ts`](../scripts/replay-events.ts) as the engine) and compare the reconstructed state against your live database to catch drift — e.g., a charge your indexer missed due to downtime.

```ts
async function reconcile(fromLedger: number, toLedger: number) {
  const chainEvents = await fetchEventsInRange(fromLedger, toLedger); // via getEvents, paginated
  const chainCharges = chainEvents.filter((e) => e.type === "charged");

  for (const chainEvent of chainCharges) {
    const stored = await db.findCharge(dedupKey(chainEvent));
    if (!stored) {
      console.warn(
        `Reconciliation gap: missing charge ${dedupKey(chainEvent)}`,
      );
      await upsertEvent(chainEvent); // backfill
    }
  }
}
```

Run reconciliation on a schedule (e.g., hourly, covering the last few hours) rather than only reactively — this is what catches gaps from the reliability failure modes below before they compound.

---

## Reliability

### When RPC is unavailable

A single public RPC endpoint going down should not silently stop your keeper or indexer. Practical mitigations:

- **Configure a fallback RPC URL** and retry with exponential backoff before failing the poll tick — do not crash the whole process on one failed `getEvents` call. [`watch-events.ts`](../scripts/watch-events.ts)'s `fetchAndPrintEvents()` already wraps each poll in try/catch so one failed tick doesn't kill the loop; production consumers should add capped exponential backoff on top of that.
- **Never advance your cursor on a failed fetch.** Only persist the new cursor after you've successfully processed the events for that range — otherwise a failure right after fetching (but before processing) silently drops events.
- **Alert on sustained failure**, not on a single failed poll. A few consecutive failures during a ledger close is normal network noise; failures sustained for multiples of your poll interval indicate a real outage.

### Event gap detection

Because polling can silently stall (process hung, cursor stuck, RPC serving stale `latestLedger`), actively detect gaps rather than assuming "no errors" means "no gaps":

```ts
async function detectGap(lastProcessedLedger: number): Promise<void> {
  const latest = await server.getLatestLedger();
  const lag = latest.sequence - lastProcessedLedger;

  // ~1 ledger every 5s; alert if we're more than ~2 minutes behind.
  if (lag > 24) {
    await alert(`Event consumer is ${lag} ledgers behind chain tip`);
  }
}
```

Combine this with the [reconciliation pattern](#4-reconciliation-pattern) run on a schedule: gap detection catches "my consumer stopped moving", reconciliation catches "my consumer moved but missed something in the middle."

### Reliability pattern matrix

| Failure mode                      | Symptom                                              | Mitigation                                                                                             |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| RPC endpoint down                 | `getEvents` throws / times out                       | Retry with backoff; fall back to a secondary RPC URL; don't advance cursor                             |
| Consumer crash mid-batch          | Some events in a batch processed, some not           | Idempotent upsert keyed on `ledger:txHash:eventName:user`; only persist cursor after full batch commit |
| Cursor stuck / stale              | Consumer alive but chain tip keeps moving away       | Gap detection (`latestLedger - lastProcessedLedger`) with alerting threshold                           |
| RPC event retention expiry        | Old ledger range no longer queryable via `getEvents` | Never let the cursor fall behind the RPC's retention window; page proactively, don't wait to backfill  |
| Duplicate delivery                | Same event observed twice across polls/replay        | Composite dedup key + upsert semantics (never plain insert)                                            |
| Out-of-order arrival across polls | Later state applied before earlier state             | Sort by `(ledger, position-in-ledger)` before applying; never trust receipt order                      |

---

## Event → Consumer Reference Table

| Event                                              | Typical consumer                                 | Why                                                         |
| -------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| `subscribed`                                       | Analytics, Notifications                         | New subscriber count; welcome/confirmation message          |
| `charged`                                          | Keeper, Analytics, Notifications, Reconciliation | Core revenue signal; payment receipt; reconciliation anchor |
| `pay_per_use`                                      | Analytics, Notifications                         | One-off usage billing signal                                |
| `paused` / `resumed`                               | Analytics                                        | Active-subscriber accounting                                |
| `cancelled`                                        | Analytics, Notifications                         | Churn tracking; cancellation confirmation                   |
| `referred`                                         | Analytics                                        | Referral attribution                                        |
| `sub_amount_updated` / `sub_interval_updated`      | Analytics, Notifications                         | Plan-change confirmation; MRR recalculation                 |
| `merchant_added` / `merchant_removed`              | Analytics, Notifications                         | Merchant directory sync                                     |
| `merchant_frozen` / `merchant_unfrozen`            | Notifications, Reconciliation                    | Urgent operational alert to the affected merchant           |
| `merchant_withdrawal`                              | Analytics, Reconciliation                        | Merchant payout ledger                                      |
| `merch_hist_cleared`                               | Analytics, Reconciliation                        | Merchant revenue-history wipe — reset aggregates            |
| `daily_limit_set` / `daily_limit_removed`          | Analytics                                        | User risk/spend-limit configuration tracking                |
| `contract_paused` / `contract_unpaused`            | Notifications, Reconciliation                    | Protocol-wide incident signal — page operators              |
| `admin_transferred` / `upgraded`                   | Reconciliation                                   | Security-sensitive audit trail                              |
| `min_interval`                                     | Analytics, Reconciliation                        | Protocol policy change — billing eligibility floor          |
| `fee_proposed` / `fee_committed`                   | Analytics, Reconciliation                        | Fee-schedule audit trail                                    |
| `grace_period_proposed` / `grace_period_committed` | Analytics                                        | Billing-policy audit trail                                  |

See [`docs/EVENTS.md`](EVENTS.md) for the full payload schema of each event.

---

## Reference Implementations

| Script                                                    | Demonstrates                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`scripts/watch-events.ts`](../scripts/watch-events.ts)   | Live polling loop, in-memory dedup (`ledger:txHash:eventType:user`), color-coded real-time output, 3 s poll interval |
| [`scripts/replay-events.ts`](../scripts/replay-events.ts) | Cursor-based pagination over a historical ledger range, batch processing, upsert integration point                   |

Both scripts are intentionally minimal reference implementations — the patterns above show how to extend them into keeper, analytics, notification, or reconciliation services.

```bash
# Live tail (requires a deployed contract id)
CONTRACT_ID=C... RPC_URL=https://soroban-testnet.stellar.org npx tsx scripts/watch-events.ts

# Backfill a ledger window into your indexer upsert path
CONTRACT_ID=C... npx tsx scripts/replay-events.ts --from-ledger 50000 --to-ledger 51000
```

---

## Related Documentation

- [`docs/EVENTS.md`](EVENTS.md) — full event payload reference
- [`docs/KEEPER.md`](KEEPER.md) — keeper bot operations (batch charging; complements event-driven charge tracking)
- [`docs/INTEGRATION-GUIDE.md`](INTEGRATION-GUIDE.md) — transaction/read integration for third-party apps
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — overall system architecture
- [`docs/TESTING.md`](TESTING.md) — including live-mode event-count validation against keepers
