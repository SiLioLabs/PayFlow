# ChargeResult Wire Encoding

Reference for the `ChargeResult` outcome values that `batch_charge` and
`get_batch_charge_estimate` return, and for the three different places those
outcomes can be observed. It is the document to read before writing a DLQ
replayer, a charge alerting rule, or a CSV export column.

**Scope.** Byte-level encoding only. This document does not describe *which*
outcome a charge produces for a given subscription state; for that see
[`API.md`](API.md) (`batch_charge`) and [`KEEPER.md`](KEEPER.md).

**Related docs:**
[`EVENTS.md`](EVENTS.md) (event payloads) |
[`ERROR-CODES.md`](ERROR-CODES.md) (contract errors) |
[`scripts/EVENT-MAPPING.md`](../scripts/EVENT-MAPPING.md) (indexer schema) |
[`scripts/README.md`](../scripts/README.md) (DLQ + export tooling) |
[`KEEPER.md`](KEEPER.md) (keeper runbook)

---

## Table of Contents

- [Cheat sheet](#cheat-sheet)
- [The three channels](#the-three-channels)
- [Channel 1: the per-address return value](#channel-1-the-per-address-return-value)
  - [The variant table](#the-variant-table)
  - [Worked XDR example](#worked-xdr-example)
  - [A correct TypeScript decoder](#a-correct-typescript-decoder)
  - [A correct Python decoder](#a-correct-python-decoder)
  - [Why `scvSymbol` is the wrong assumption](#why-scvsymbol-is-the-wrong-assumption)
- [Channel 2: the aggregate event](#channel-2-the-aggregate-event)
  - [The one place `scvSymbol` really is used](#the-one-place-scvsymbol-really-is-used)
  - [PascalCase vs snake_case](#pascalcase-vs-snake_case)
  - [Reconciliation invariant](#reconciliation-invariant)
- [Channel 3: the dead-letter queue row](#channel-3-the-dead-letter-queue-row)
- [`null` vs failure](#null-vs-failure)
- [`ChargeSimResult` is a different enum](#chargesimresult-is-a-different-enum)
- [Known decoder gaps in this repository](#known-decoder-gaps-in-this-repository)
- [Writing a decoder: checklist](#writing-a-decoder-checklist)
- [Verifying this document](#verifying-this-document)

---

## Cheat sheet

| Question                                  | Answer                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| What XDR type is one `ChargeResult`?       | `scvU32` carrying the variant discriminant. **Not** `scvSymbol`.                              |
| What is the whole return value?            | `scvVec` of those `scvU32`, one element per input address, in input order.                   |
| How many variants?                         | 7, discriminants `0`..`6`, append-only.                                                      |
| Where is `scvSymbol` used then?            | The `batch_charge_skips` event topic, and the field names inside that event's `scvMap`.       |
| Is a failure a distinct value?             | No. A per-user failure is just a non-zero discriminant. See [`null` vs failure](#null-vs-failure). |
| What does an aborted transaction return?   | `scvVoid`. No `ChargeResult` exists at all, and no per-user outcome is available.            |
| Which enum gives me a *string*?            | Neither. You must map the discriminant to a name yourself.                                   |

---

## The three channels

A charge outcome can reach you three ways, and they are encoded completely
differently. Mixing them up is the most common cause of a decoder that "works"
but reports every subscription as failed.

| Channel                | Scope           | Carries per-subscriber data? | XDR shape                                    |
| ---------------------- | --------------- | --------------------------- | -------------------------------------------- |
| Transaction return     | Per address     | **Yes**                     | `scvVec<scvU32>`                             |
| `batch_charge_skips`   | Per batch       | No, aggregate counts only   | topic `scvSymbol`, value `scvMap<scvSymbol, scvU32>` |
| Dead-letter queue row  | Per failed batch | No, the error that aborted it | JSON object, one line of JSONL             |

Only the return value gives you per-subscriber attribution. The event gives you
batch-level counts, and the DLQ row tells you a batch aborted without saying
which subscriber caused it.

---

## Channel 1: the per-address return value

`batch_charge(users) -> Vec<ChargeResult>` and
`get_batch_charge_estimate(users) -> Vec<ChargeResult>` both return one
`ChargeResult` per input address, **in the same order as the input**. The result
for address `i` in the returned vector always corresponds to `users[i]`, so you
never need to re-derive the mapping.

`ChargeResult` is a Soroban `#[contracttype]` enum with no payload fields (see
[`contract/src/batch.rs`](../contract/src/batch.rs)). A fieldless
`#[contracttype]` enum serialises as a `u32` holding the variant index. So each
element is an `scvU32`.

### The variant table

The discriminants are the declaration order in `ChargeResult`. They are
append-only: adding a variant means appending, and renumbering an existing one
breaks every off-chain decoder that has ever been written.

| Discriminant | Rust variant             | Meaning                                                                                             | Transfer happened? |
| -----------: | ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------ |
| `0`          | `Charged`                | Funds transferred, `last_charged` advanced.                                                         | Yes                |
| `1`          | `Skipped`                | Interval has not elapsed yet. Not an error.                                                        | No                 |
| `2`          | `NoSubscription`         | No subscription exists for this address.                                                           | No                 |
| `3`          | `Inactive`               | Subscription exists but is cancelled.                                                              | No                 |
| `4`          | `Paused`                 | Subscription is paused.                                                                            | No                 |
| `5`          | `GracePeriodElapsed`     | The charge window closed; the subscription is overdue beyond its grace period.                      | No                 |
| `6`          | `AllowanceInsufficient`  | Subscriber's token allowance is below the gross amount. The subscription stays active; retry next cycle. | No             |

`AllowanceInsufficient` is the only variant that represents a per-subscriber
*failure* that a human has to fix. `Skipped` and `NoSubscription` are routine and
need no action. Note that a non-`Charged` result for one address never aborts the
rest of the batch, so you always get the full-length vector.

### Worked XDR example

Three addresses submitted, producing `Charged`, `Skipped`, and
`AllowanceInsufficient`:

```
scvVec[ scvU32(0), scvU32(1), scvU32(6) ]
```

base64:

```
AAAAEAAAAAEAAAADAAAAAwAAAAAAAAADAAAAAQAAAAMAAAAG
```

hex, split into big-endian 32-bit words:

```
00000010  00000001  00000003   00000003  00000000
00000003  00000001  00000003   00000006
         ^^^^^^^^^^^^  ^^^^^^^^^^^^  ^^^^^^^^^^^^
         scvVec arm  count = 3  element 0 = Charged
```

Walking it:

| Offset | Bytes            | Meaning                                                             |
| -----: | ---------------- | ------------------------------------------------------------------- |
| 0      | `00000010`       | `ScValType` discriminant: `16` = `scvVec`                            |
| 4      | `00000001`       | Constant structural word the XDR writer emits for the `scvVec` arm.  |
| 8      | `00000003`       | Element count: 3                                                     |
| 12     | `00000003`       | `ScValType` discriminant: `3` = `scvU32`                             |
| 16     | `00000000`       | Element 0: discriminant `0` = `Charged`                              |
| 20     | `00000003`       | `ScValType` discriminant: `3` = `scvU32`                             |
| 24     | `00000001`       | Element 1: discriminant `1` = `Skipped`                              |
| 28     | `00000003`       | `ScValType` discriminant: `3` = `scvU32`                             |
| 32     | `00000006`       | Element 2: discriminant `6` = `AllowanceInsufficient`               |

Every element therefore costs exactly 8 bytes: a 4-byte `ScValType` of `3`
followed by a 4-byte big-endian value. The header is a fixed 12 bytes. Total is
`12 + 8 * count`.

Do not hand-parse this in production. The layout above is what the pinned
`@stellar/stellar-sdk` emits and it round-trips cleanly through
`xdr.ScVal.fromXDR`, but the structural word at offset 4 is a property of that
writer rather than anything the contract controls. Use the SDK.

Single elements, for comparison:

| Value                        | base64         | hex                              |
| ---------------------------- | -------------- | -------------------------------- |
| `scvU32(0)` (`Charged`)      | `AAAAAAwAAAAA=` | `00000003 00000000`              |
| `scvU32(1)` (`Skipped`)      | `AAAAAAwAAAAE=` | `00000003 00000001`              |
| `scvU32(2)` (`NoSubscription`)| `AAAAAAwAAAAI=` | `00000003 00000002`              |
| `scvU32(3)` (`Inactive`)     | `AAAAAAwAAAAM=` | `00000003 00000003`              |
| `scvU32(4)` (`Paused`)       | `AAAAAAwAAAAQ=` | `00000003 00000004`              |
| `scvU32(5)` (`GracePeriodElapsed`) | `AAAAAAwAAAAU=` | `00000003 00000005`         |
| `scvU32(6)` (`AllowanceInsufficient`) | `AAAAAAwAAAAY=` | `00000003 00000006`    |
| `scvVoid` (no return value)  | `AAAAAQ==`     | `00000001`                       |

The `scvVoid` row is the one to watch for. It is what you get instead of a vector
when the transaction panicked; see [`null` vs failure](#null-vs-failure).

The `ScValType` discriminants used above, as emitted by the pinned
`@stellar/stellar-sdk` (v12). Note how close the two "named" encodings are to
the numeric one:

| `ScValType` | Value | Used for                                     |
| ----------- | ----: | -------------------------------------------- |
| `scvVoid`   | 1     | No return value                              |
| `scvError`  | 2     | Contract error                               |
| `scvU32`    | 3     | **A `ChargeResult` discriminant**            |
| `scvU64`    | 5     | Timestamps, ledger numbers                   |
| `scvString` | 14    | A string (never a `ChargeResult`)            |
| `scvSymbol` | 15    | Event topics and event map keys only         |
| `scvVec`    | 16    | The `Vec<ChargeResult>` return value         |
| `scvMap`    | 17    | The `batch_charge_skips` event value         |

### A correct TypeScript decoder

```ts
import { xdr } from "@stellar/stellar-sdk";

/** Discriminant order in `contract/src/batch.rs`. Append-only. */
const CHARGE_RESULTS = [
  "Charged",
  "Skipped",
  "NoSubscription",
  "Inactive",
  "Paused",
  "GracePeriodElapsed",
  "AllowanceInsufficient",
] as const;

export type ChargeResultName = (typeof CHARGE_RESULTS)[number];

/**
 * Decode the return value of `batch_charge` / `get_batch_charge_estimate`.
 * Returns one entry per input address, in input order.
 *
 * Returns null when the transaction produced no return value at all
 * (`scvVoid`), which means the invocation panicked.
 */
export function decodeChargeResults(
  retval: xdr.ScVal | undefined | null,
): ChargeResultName[] | null {
  if (!retval) return null;
  if (retval.switch().name !== "scvVec") return null;

  return retval.vec().map((item) => {
    const type = item.switch().name;
    if (type !== "scvU32") {
      throw new Error(`expected scvU32 ChargeResult, got ${type}`);
    }
    const n = item.u32();
    const name = CHARGE_RESULTS[n];
    if (!name) {
      // A variant this decoder predates. Do not guess.
      throw new Error(`unknown ChargeResult discriminant ${n}`);
    }
    return name;
  });
}
```

The three guards are deliberate and each one covers a distinct real failure:

- `!retval` covers a missing field, which is different from a present `scvVoid`;
- `switch().name !== "scvVec"` covers a caller that passed the wrong ScVal;
- the inner `!== "scvU32"` check catches a decoder that assumed the wrong
  element type, which is exactly the bug described in
  [Why `scvSymbol` is the wrong assumption](#why-scvsymbol-is-the-wrong-assumption).

For a live charge the return value is on the simulation/result object, not on
the transaction envelope:

```ts
const sim = await server.simulateTransaction(tx);
if (sim.error) {
  // The whole invocation failed. There is no ChargeResult to read.
  throw new Error(sim.error);
}
const results = decodeChargeResults(sim.result?.retval);
```

An unknown discriminant is thrown, not swallowed. If a future contract version
appends variant 7, a decoder that silently returns "unknown" will quietly
mis-file every new outcome, and a decoder that throws will tell you immediately.

### A correct Python decoder

Hand-decoding is only a teaching aid; use the SDK in real code. This is the
layout above implemented directly, useful if you are reading a `returnValue`
out of a raw JSON-RPC response and do not want a Stellar dependency:

```python
CHARGE_RESULTS = [
    "Charged", "Skipped", "NoSubscription", "Inactive",
    "Paused", "GracePeriodElapsed", "AllowanceInsufficient",
]

SCV_U32 = b"\x00\x00\x00\x03"   # ScValType.scvU32 == 3
SCV_VEC = b"\x00\x00\x00\x10"   # ScValType.scvVec  == 16
SCV_VOID = b"\x00\x00\x00\x01"  # ScValType.scvVoid == 1


def decode_charge_results(xdr_b64: str) -> list[str] | None:
    import base64
    raw = base64.b64decode(xdr_b64)

    if raw == SCV_VOID:
        return None                      # the invocation panicked

    if raw[:4] != SCV_VEC:
        raise ValueError("expected scvVec, got " + raw[:4].hex())
    # bytes 4..8 are a constant structural word in the pinned SDK's encoding
    count = int.from_bytes(raw[8:12], "big")

    out = []
    off = 12
    for _ in range(count):
        if raw[off:off + 4] != SCV_U32:
            raise ValueError("expected scvU32 at offset %d" % off)
        n = int.from_bytes(raw[off + 4:off + 8], "big")
        if n >= len(CHARGE_RESULTS):
            raise ValueError("unknown ChargeResult discriminant %d" % n)
        out.append(CHARGE_RESULTS[n])
        off += 8
    return out


assert decode_charge_results(
    "AAAAEAAAAAEAAAADAAAAAwAAAAAAAAADAAAAAQAAAAMAAAAG"
) == ["Charged", "Skipped", "AllowanceInsufficient"]
assert decode_charge_results("AAAAAQ==") is None          # scvVoid
assert decode_charge_results("AAAAEAAAAAEAAAAAAA") == []  # empty vector

# A bare scvU32 is not a valid return value: the contract always returns a vec.
# Wrap it to decode a single-outcome batch:
#   xdr.ScVal.scvVec([xdr.ScVal.scvU32(6)]).toXDR("base64")
```

### Why `scvSymbol` is the wrong assumption

It is tempting to model the outcome as a symbol, because the Rust variants are
named and because Soroban events really do use symbols. But a fieldless
`#[contracttype]` enum has no symbol payload, so there is nothing to serialise
as one.

The two encodings are also easy to confuse at a glance, because the only
difference is a single byte:

```
scvSymbol("Charged")  base64: AAAADwAAAAdDaGFyZ2VkAA==   hex: 0000000f 00000007 4368617267656400
scvString("Charged")  base64: AAAADgAAAAdDaGFyZ2VkAA==   hex: 0000000e 00000007 4368617267656400
scvU32(0)            base64: AAAAAwAAAAA=                hex: 00000003 00000000
```

A decoder that branches on `scvSymbol` never matches a real `ChargeResult`, and
the usual fallback (`String(item)`) yields a stringified object rather than a
variant name. The result is that every subscriber looks non-charged.

---

## Channel 2: the aggregate event

`batch_charge` emits a single `batch_charge_skips` event when the batch
contained at least one *interesting* non-success outcome, so event-driven
consumers can see it without reading the return value. A batch where everything
was either `Charged` or `Skipped` emits nothing. The per-address breakdown is
deliberately **not** in the event; it stays in the return value.

### The one place `scvSymbol` really is used

`BatchChargeSkipsEventData` is a `#[contracttype]` **struct**, so its value is an
`scvMap` whose keys are `scvSymbol` and whose values are `scvU32`. This is the
real wire shape, taken verbatim from a committed test snapshot
(`contract/test_snapshots/test/test_batch_charge_allowance_insufficient_counted_in_skips_summary.1.json`):

```json
{
  "topics": [ { "symbol": "batch_charge_skips" } ],
  "data": {
    "map": [
      { "key": { "symbol": "allowance_insufficient" }, "val": { "u32": 1 } },
      { "key": { "symbol": "charged" },                  "val": { "u32": 1 } },
      { "key": { "symbol": "grace_elapsed" },            "val": { "u32": 0 } },
      { "key": { "symbol": "inactive" },                  "val": { "u32": 0 } },
      { "key": { "symbol": "ledger_sequence" },           "val": { "u32": 0 } },
      { "key": { "symbol": "no_subscription" },           "val": { "u32": 0 } },
      { "key": { "symbol": "not_due" },                   "val": { "u32": 0 } },
      { "key": { "symbol": "paused" },                    "val": { "u32": 0 } },
      { "key": { "symbol": "total" },                     "val": { "u32": 2 } }
    ]
  }
}
```

So there are exactly two `scvSymbol`s in play, and they are both structural:

- `topics[0]`, the event name, used to build the topic filter;
- the `scvMap` keys, which are the struct's field names.

The values are all `scvU32` counts. The event carries no addresses at all,
because the topic list has only one element. A parser that expects
`topics[1]` to be a subscriber address will store an empty address for these
rows; that is correct behaviour, not a parse failure. See
[`EVENTS.md`](EVENTS.md) for the per-event topic layouts.

### PascalCase vs snake_case

The event field names are **not** the enum variant names:

| `ChargeResult` variant      | Event map key            |
| --------------------------- | ------------------------ |
| `Charged`                   | `charged`                |
| `Skipped`                   | `not_due`                |
| `NoSubscription`            | `no_subscription`        |
| `Inactive`                  | `inactive`               |
| `Paused`                    | `paused`                 |
| `GracePeriodElapsed`        | `grace_elapsed`          |
| `AllowanceInsufficient`     | `allowance_insufficient` |

`Skipped` maps to `not_due`, and `NoSubscription` becomes `no_subscription`.
Never derive one naming from the other programmatically. The only extra key is
`ledger_sequence`, which is the ledger the event was emitted in, not an outcome.

### Reconciliation invariant

Every submitted address lands in exactly one bucket, so a correct event payload
satisfies:

```
total == charged + not_due + no_subscription + inactive + paused
       + grace_elapsed + allowance_insufficient
```

If you are writing a CSV or metrics export from the event, assert this. A
payload that fails the invariant means a variant was added to the contract
without adding a field to `BatchChargeSkipsEventData`, and your export is
silently dropping outcomes.

---

## Channel 3: the dead-letter queue row

When a keeper batch fails at the **transaction** level, the keeper writes one
JSON object per line to a JSONL file (default
`dlq/failed-batches.jsonl`, overridable with `DLQ_FILE`). This is what
[`scripts/replay-dlq.ts`](../scripts/replay-dlq.ts) reads. The row schema,
written by [`scripts/keeper.ts`](../scripts/keeper.ts):

| Field      | Type              | Meaning                                                                    |
| ---------- | ----------------- | -------------------------------------------------------------------------- |
| `timestamp`| string            | ISO-8601 time the failure was recorded.                                     |
| `offset`   | number            | Keeper page offset the batch started at.                                    |
| `limit`    | number            | Number of addresses in the batch.                                           |
| `users`    | string[]          | The addresses in the batch, in submission order.                            |
| `error`    | string            | The thrown error message.                                                   |
| `tx_xdr`   | `null`            | Always `null`; the keeper does not persist the signed envelope.             |
| `attempts` | number            | Replay attempts so far. `0` until `replay-dlq.ts` increments it.            |
| `ledger`   | number \| undefined | Latest ledger seen when the failure was recorded. Absent if the RPC call that reads it failed. |

```json
{
  "timestamp": "2026-06-15T12:00:00.000Z",
  "offset": 100,
  "limit": 2,
  "users": ["GCAX2XXXXX", "GBYYYXXXXX"],
  "error": "Error: Transaction simulation failed: HostError: Error(Contract, #20)",
  "tx_xdr": null,
  "attempts": 0,
  "ledger": 12345
}
```

Three consequences worth stating explicitly, because they are the usual source of
DLQ tooling bugs:

1. **There is no `ChargeResult` in a DLQ row.** A DLQ row records that a
   transaction *aborted*, which is the `scvVoid` case. Individual outcomes were
   never produced. Trying to read outcomes out of a DLQ row cannot work.
2. **`tx_xdr` is always `null`.** Replay rebuilds the transaction from `users`
   and re-derives the current on-chain state, so a replayed batch is not
   guaranteed to reproduce the original failure if state moved on.
3. **The error is a message, not a code.** `error` is free-form text. To react
   programmatically, match on substrings; `replay-dlq.ts` classifies permanent
   (non-retryable) errors by pattern for exactly this reason.

Because `AllowanceInsufficient` is a *successful* transaction that simply did
not transfer one subscriber's funds, it is never written to the DLQ. Alerting on
it has to come from the event channel, which is what
[`scripts/alert-failed-charges.ts`](../scripts/alert-failed-charges.ts) does.

---

## `null` vs failure

"Outcome" and "failure" are not the same axis, and conflating them is what
produces alert storms. There are four distinct things:

| Situation                                | What you observe                                                              | Is it a failure? |
| ---------------------------------------- | ----------------------------------------------------------------------------- | ---------------- |
| Address charged successfully             | `scvU32(0)` in the return vector, and the address appears in `charged`         | No               |
| Address skipped, nothing wrong           | `scvU32(1)`, and the address appears in `not_due`                              | No               |
| Address has too little allowance         | `scvU32(6)`, and the address appears in `allowance_insufficient`               | **Yes**, needs subscriber action |
| Whole batch rejected, e.g. over the cap   | Transaction panics with `BatchTooLarge` (20). Return value is `scvVoid`. No outcomes at all. | **Yes**, operator action |
| No return value available (decode failed) | `null` / `undefined` from your own helper                                      | Unknown. Do not treat as success or as failure. |

The practical rules:

- **A `null` return value is not a failure result.** It means the invocation did
  not produce a return value. Decide explicitly whether to retry, and if you
  alert on it, say "could not determine", not "failed".
- **A `ContractError` in the simulation is not a `ChargeResult`.** Errors carry
  a numeric code from [`ERROR-CODES.md`](ERROR-CODES.md); outcomes carry a
  discriminant from the table above. They live in different fields.
- **`AllowanceInsufficient` keeps the subscription active.** Nothing was
  transferred, the subscription is still live, and the next cycle will try
  again. Removing the subscriber is the wrong response.
- **Never map an unrecognised value to a success bucket.** A decoder that
  returns a default of "charged" for an unknown discriminant will report
  revenue that was never collected.

---

## `ChargeSimResult` is a different enum

`simulate_charge` returns `ChargeSimResult`, not `ChargeResult`. The two
overlap only partially and the names do **not** line up. Using a `ChargeResult`
decoder on simulation output produces wrong answers that look plausible.

| Discriminant | `ChargeSimResult` (from `simulate_charge`) | `ChargeResult` (from `batch_charge`) |
| -----------: | ----------------------------------------- | ------------------------------------- |
| `0`          | `WouldSucceed`                            | `Charged`                             |
| `1`          | `NotDue`                                  | `Skipped`                             |
| `2`          | `Inactive`                                | `NoSubscription`                      |
| `3`          | `InsufficientAllowance`                   | `Inactive`                            |
| `4`          | `GracePeriodElapsed`                      | `Paused`                              |
| `5`          | `ContractPaused`                          | `GracePeriodElapsed`                  |
| `6`          | `SubscriptionPaused`                      | `AllowanceInsufficient`               |

The trap cases: `NotDue` (sim) is not `Skipped` (batch); `InsufficientAllowance`
(sim) is not `AllowanceInsufficient` (batch); and `Inactive` means *cancelled*
in the batch enum but *has-a-record* in the simulation enum. Also note
`ContractError::InsufficientAllowance` is error code 8, a third distinct thing.

`get_batch_charge_estimate` is the exception: it returns `ChargeResult`, not
`ChargeSimResult`, so dry-run tooling can share a decoder with live charging.

---

## Known decoder gaps in this repository

The encoding above is what the contract emits. These in-repo consumers do not
match it yet, so their numbers should not be trusted until they are fixed. They
are listed here so that a reader who has already run into them knows the doc
agrees with them rather than contradicting them by accident.

| Consumer                      | Assumes            | Actually sees       | Effect                                                    |
| ----------------------------- | ------------------ | ------------------- | --------------------------------------------------------- |
| `scripts/keeper.ts` `decodeEnumVec` | `scvSymbol`   | `scvU32`            | Non-`Charged` branches never match, so dry-run volume reads as `0` and every result lands in `skipCounts` under a garbage key. |
| `scripts/replay-dlq.ts` `parseChargeResults` | `scvVec` / `scvMap` | `scvU32` | Neither branch is reachable; `charged` is always `0` and `skipped` equals the batch size. |
| `scripts/replay-dlq.ts` `returnValue` read | `returnValue` on `getTransaction` | nested `result.retVal` in current SDK | Falls back to a zero tally that is indistinguishable from a genuinely empty batch. |
| `frontend/src/stellar.ts` `BatchChargeOutcome` | variant name from `switch()` | `"scvU32"` | Every outcome renders as the failure state. |

The consumers that read the **event** path are unaffected, because they work from
the indexer's stored JSON (or a plain RPC `getEvents` response) and never touch
`ScVal`: `scripts/alert-failed-charges.ts`, `scripts/export-merchant-report.ts`,
`scripts/audit-trail.ts`, `scripts/merchant-analytics.ts`, and
`scripts/churn-analysis.ts`. None of them decodes a `ChargeResult` at all, so
none of them is subject to the discriminants above.

Fixing these is behaviour-changing work and is deliberately out of scope for
this document. The decoders above are drop-in replacements for the three
`ChargeResult` readers.

---

## Writing a decoder: checklist

1. Read the return value from `sim.result.retval` (simulation) or from the
   transaction result. Do not assume `returnValue` on the envelope.
2. Check for `scvVoid` **before** trying to read a vector. Treat it as "no
   result", not as "all failed".
3. Assert the outer type is `scvVec` and the element type is `scvU32`.
4. Map the discriminant through the variant table above. Keep the table in one
   place in your codebase so it can be diffed against the contract.
5. Throw on an unknown discriminant. Do not default it.
6. Line the result vector up with the input address vector by index. Do not
   sort or filter either one.
7. If you also consume events, remember the event counts are aggregate and the
   field names are snake_case. Check the reconciliation invariant.
8. If you persist to a DLQ or a CSV, store the **name**, not the discriminant,
   so the data stays readable after the contract adds variant 7.

---

## Verifying this document

From the repository root:

```bash
# The variant list and its declaration order (the source of the table above)
sed -n '/pub enum ChargeResult/,/^}/p' contract/src/batch.rs

# The on-wire discriminants, locked by a contract test
rg -n "test_charge_result_discriminants|scvU32 discriminant" contract/src/test.rs

# The event payload struct
rg -n "struct BatchChargeSkipsEventData" -A 25 contract/src/events.rs

# A real encoded event, to confirm the scvMap-of-scvSymbol shape
rg -l "batch_charge_skips" contract/test_snapshots/test | head -1

# The DLQ row schema, as written
rg -n "writeDlqEntry" -A 12 scripts/keeper.ts
```

The `ScValType` numbers in this document come from the SDK this repository
pins (`scripts/package.json` -> `@stellar/stellar-sdk`). To re-read them:

```bash
cd scripts
node -e "const {xdr}=require('@stellar/stellar-sdk');
for (const k of ['scvVoid','scvU32','scvString','scvSymbol','scvVec','scvMap'])
  console.log(k, xdr.ScValType[k].value);"
```

---

## Related

- [`API.md`](API.md) - `batch_charge`, `get_batch_charge_estimate`, `simulate_charge` signatures and error codes
- [`EVENTS.md`](EVENTS.md) - full event reference, including `batch_charge_skips`
- [`ERROR-CODES.md`](ERROR-CODES.md) - `BatchTooLarge` (20), `InvalidBatchSize` (29)
- [`KEEPER.md`](KEEPER.md) - keeper runbook and the `ChargeResult` table it uses
- [`scripts/EVENT-MAPPING.md`](../scripts/EVENT-MAPPING.md) - how events land in the indexer SQLite schema
- [`scripts/README.md`](../scripts/README.md) - DLQ replay and CSV export tooling
- [`contract/src/batch.rs`](../contract/src/batch.rs) - the enum definition
- [`contract/src/events.rs`](../contract/src/events.rs) - the summary event
