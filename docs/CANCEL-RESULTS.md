# CancelResult Wire Encoding

## Overview

`CancelResult` is returned by `batch_cancel` to describe the outcome for each user address. It is a Soroban `#[contracttype]` enum encoded on the wire as a `ScVal::U32` discriminant.

## Wire Format

Each variant maps to a fixed `u32` discriminant:

| Discriminant | Variant | Meaning |
|--------------|---------|---------|
| `0` | `Cancelled` | Subscription was cancelled successfully (normal case) |
| `1` | `NoSubscription` | No subscription entry found for this address |
| `2` | `AlreadyCancelled` | Subscription was already inactive (`active = false`) |
| `3` | `PausedCancelled` | A paused (but active) subscription was cancelled |
| `4` | `MerchantFrozen` | Subscription belongs to a frozen merchant and was cancelled |

## Append-Only Invariant

**New variants MUST be appended at the end.** Off-chain consumers (keepers, indexers, alert scripts) that only know discriminants 0-2 will continue to decode those values correctly when newer contracts return 3 or 4.

Renaming or reordering existing discriminants is a **breaking change** for all off-chain parsers.

## Example XDR Encoding

A `Vec<CancelResult>` of `[Cancelled, PausedCancelled, MerchantFrozen]` encodes as:

```
ScVec [
  ScVal::U32(0),  // Cancelled
  ScVal::U32(3),  // PausedCancelled
  ScVal::U32(4),  // MerchantFrozen
]
```

## Handling in Off-Chain Code

### TypeScript/JavaScript Example

```typescript
enum CancelResult {
  Cancelled = 0,
  NoSubscription = 1,
  AlreadyCancelled = 2,
  PausedCancelled = 3,
  MerchantFrozen = 4,
}

function parseCancelResult(scval: xdr.ScVal): CancelResult | number {
  if (scval.switch() === xdr.ScValType.scvU32()) {
    const discriminant = scval.u32();
    
    // Handle known variants
    if (discriminant <= 4) {
      return discriminant as CancelResult;
    }
    
    // Unknown future variant - return raw discriminant
    console.warn(`Unknown CancelResult discriminant: ${discriminant}`);
    return discriminant;
  }
  
  throw new Error('Invalid CancelResult encoding');
}
```

### Rust Example

```rust
use soroban_sdk::xdr::{ScVal, ScValType};

fn decode_cancel_result(scval: &ScVal) -> Result<u32, String> {
    match scval {
        ScVal::U32(discriminant) => Ok(*discriminant),
        _ => Err("Expected U32 discriminant".to_string()),
    }
}

// In your keeper logic:
match decode_cancel_result(&result)? {
    0 => println!("Cancelled"),
    1 => println!("NoSubscription"),
    2 => println!("AlreadyCancelled"),
    3 => println!("PausedCancelled - investigate why subscription was paused"),
    4 => println!("MerchantFrozen - frozen merchant cancellation"),
    n => println!("Unknown discriminant {}", n),
}
```

## Backward Compatibility

### Before This Change

Old contracts returned only discriminants 0-2:
- `Cancelled (0)`
- `NoSubscription (1)`
- `AlreadyCancelled (2)`

A paused subscription or frozen merchant would report `Cancelled (0)` without distinction.

### After This Change

New contracts return discriminants 0-4:
- `Cancelled (0)` - only for routine cancellations
- `NoSubscription (1)` - unchanged
- `AlreadyCancelled (2)` - unchanged
- `PausedCancelled (3)` - **NEW** - was paused when cancelled
- `MerchantFrozen (4)` - **NEW** - merchant is frozen

**Compatibility guarantee:** Discriminants 0-2 have identical semantics. Off-chain parsers that pre-date this change will:
- ✅ Correctly decode `Cancelled`, `NoSubscription`, `AlreadyCancelled`
- ⚠️ Encounter unknown discriminants 3-4, which they should handle gracefully (log a warning, treat as "cancelled" generically, etc.)

## Usage in batch_cancel

The `batch_cancel` function checks subscription state before cancelling and returns the appropriate result:

1. **Priority 1:** Check if merchant is frozen → `MerchantFrozen`
2. **Priority 2:** Check if subscription is paused → `PausedCancelled`
3. **Default:** Regular cancellation → `Cancelled`

This priority order ensures that the most critical state (merchant frozen) is always reported, even if the subscription is also paused.

## Related Documentation

- `docs/CHARGE-RESULTS.md` - Similar wire encoding for `ChargeResult`
- `scripts/EVENT-MAPPING.md` - Event and result type mappings
- `contract/src/batch.rs:20-27` - ChargeResult discriminant stability note

## Testing

See `contract/src/test.rs`:
- `test_batch_cancel_distinguishes_paused_cancellation`
- `test_batch_cancel_distinguishes_frozen_merchant`
- `test_batch_cancel_frozen_merchant_takes_precedence_over_paused`

## Summary

`CancelResult` uses an append-only discriminant scheme to maintain backward compatibility with off-chain parsers. New variants distinguish unusual cancellation states (paused subscriptions, frozen merchants) that admins need to review.
Reference for the `CancelResult` outcome values that `batch_cancel` returns.
Similar to `ChargeResult` (documented in [`CHARGE-RESULTS.md`](CHARGE-RESULTS.md)),
but simpler: no aggregate event, and fewer variants.

**Scope.** Byte-level encoding and variant semantics. For batch cancellation
workflow see [`API.md`](API.md) (`batch_cancel`).

**Related docs:**
[`CHARGE-RESULTS.md`](CHARGE-RESULTS.md) (ChargeResult encoding) |
[`ERROR-CODES.md`](ERROR-CODES.md) (contract errors) |
[`API.md`](API.md) (API reference)

---

## Table of Contents

- [Cheat sheet](#cheat-sheet)
- [The return value](#the-return-value)
  - [The variant table](#the-variant-table)
  - [XDR encoding](#xdr-encoding)
- [Why these variants matter](#why-these-variants-matter)
- [Append-only rule](#append-only-rule)

---

## Cheat sheet

| Question                                  | Answer                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| What XDR type is one `CancelResult`?       | `scvU32` carrying the variant discriminant. **Not** `scvSymbol`.                              |
| What is the whole return value?            | `scvVec` of those `scvU32`, one element per input address, in input order.                   |
| How many variants?                         | 5, discriminants `0`..`4`, append-only.                                                      |
| Does `batch_cancel` emit an aggregate event? | No. Unlike `batch_charge`, there is no summary event.                                      |
| What does an aborted transaction return?   | `scvVoid`. No `CancelResult` exists at all.                                                  |

---

## The return value

`batch_cancel(users) -> Vec<CancelResult>` returns one `CancelResult` per input
address, **in the same order as the input**. The result for address `i` in the
returned vector always corresponds to `users[i]`.

`CancelResult` is a Soroban `#[contracttype]` enum with no payload fields (see
[`contract/src/batch.rs`](../contract/src/batch.rs)). A fieldless
`#[contracttype]` enum serializes as a `u32` holding the variant index. So each
element is an `scvU32`.

### The variant table

The discriminants are the declaration order in `CancelResult`. They are
append-only: adding a variant means appending, and renumbering an existing one
breaks every off-chain decoder.

| Discriminant | Rust variant             | Meaning                                                                                             | Was cancelled? |
| -----------: | ------------------------ | --------------------------------------------------------------------------------------------------- | -------------- |
| `0`          | `Cancelled`              | Subscription was cancelled successfully.                                                            | Yes            |
| `1`          | `NoSubscription`         | No subscription found for this address.                                                            | No             |
| `2`          | `AlreadyCancelled`       | Subscription was already cancelled.                                                                | No (idempotent)|
| `3`          | `PausedCancelled`        | Subscription was paused; cancel succeeded but state was unusual.                                    | Yes            |
| `4`          | `MerchantFrozen`         | Subscription's merchant was frozen; cancel succeeded but state was unusual.                         | Yes            |

**New in this version:** `PausedCancelled` and `MerchantFrozen` (discriminants 3–4)
allow an admin operating a batch cancel to distinguish routine cancels from those
that hit a paused subscription or a frozen-merchant subscription, which are
exactly the cases worth reviewing.

All variants except `NoSubscription` emit a `cancelled` event. Variants 0, 3, and 4
all successfully cancel the subscription; the distinction is for auditing purposes.

### XDR encoding

The encoding is identical to `ChargeResult`: a `scvVec` of `scvU32` discriminants.

Example: three addresses submitted, producing `Cancelled`, `PausedCancelled`, and
`MerchantFrozen`:

```
scvVec[ scvU32(0), scvU32(3), scvU32(4) ]
```

base64:

```
AAAAEAAAAAEAAAADAAAAAwAAAAAAAAADAAAAAQAAAAMAAAAE
```

See [`CHARGE-RESULTS.md`](CHARGE-RESULTS.md) for the full XDR breakdown. The
layout is the same; only the discriminant meanings differ.

Single elements:

| Value                              | base64         | hex                              |
| ---------------------------------- | -------------- | -------------------------------- |
| `scvU32(0)` (`Cancelled`)          | `AAAAAwAAAAA=` | `00000003 00000000`              |
| `scvU32(1)` (`NoSubscription`)     | `AAAAAwAAAAE=` | `00000003 00000001`              |
| `scvU32(2)` (`AlreadyCancelled`)   | `AAAAAwAAAAI=` | `00000003 00000002`              |
| `scvU32(3)` (`PausedCancelled`)    | `AAAAAwAAAAM=` | `00000003 00000003`              |
| `scvU32(4)` (`MerchantFrozen`)     | `AAAAAwAAAAQ=` | `00000003 00000004`              |
| `scvVoid` (no return value)        | `AAAAAQ==`     | `00000001`                       |

---

## Why these variants matter

Before variants 3–4 were added, a paused subscription and a merchant-frozen
subscription both reported `Cancelled` (discriminant 0), with no signal that the
state was unusual.

**Problem:** An admin operating a batch cancel cannot distinguish a routine cancel
from one that hit a paused or frozen subscription, which is exactly the case worth
reviewing.

**Solution:** The new variants allow off-chain tooling to flag these for review
without requiring a separate state query for every cancelled address.

**Precedence:** When both conditions are true (paused *and* merchant frozen),
`MerchantFrozen` (4) takes precedence over `PausedCancelled` (3), because the
merchant freeze is the more critical operational state to surface.

---

## Append-only rule

When adding new variants, **always append** at the end so existing off-chain
parsers continue to recognize the original discriminants 0–4. Renaming or
reordering is a breaking change for all consumers.

This rule is documented in the enum's doc comment in `contract/src/batch.rs` and
mirrors the `ChargeResult` append-only convention.

---

## Decoding example (TypeScript)

```ts
import { xdr } from "@stellar/stellar-sdk";

/** Discriminant order in `contract/src/batch.rs`. Append-only. */
const CANCEL_RESULTS = [
  "Cancelled",
  "NoSubscription",
  "AlreadyCancelled",
  "PausedCancelled",
  "MerchantFrozen",
] as const;

export type CancelResultName = (typeof CANCEL_RESULTS)[number];

export function decodeCancelResults(
  retval: xdr.ScVal | undefined | null,
): CancelResultName[] | null {
  if (!retval) return null;
  if (retval.switch().name !== "scvVec") return null;

  return retval.vec().map((item) => {
    const type = item.switch().name;
    if (type !== "scvU32") {
      throw new Error(`expected scvU32 CancelResult, got ${type}`);
    }
    const n = item.u32();
    const name = CANCEL_RESULTS[n];
    if (!name) {
      throw new Error(`unknown CancelResult discriminant ${n}`);
    }
    return name;
  });
}
```

---

## Verifying this document

From the repository root:

```bash
# The variant list and its declaration order
sed -n '/pub enum CancelResult/,/^}/p' contract/src/batch.rs

# The batch_cancel function that produces these
rg -A 40 "pub fn batch_cancel" contract/src/batch.rs
```
