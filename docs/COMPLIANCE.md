# Compliance and Audit Trails

This guide is for merchants, finance teams, auditors, and payment operations staff who need a verifiable record of PayFlow (FlowPay) billing activity for accounting, tax preparation, or internal controls.

It explains what the protocol records, how to assemble an audit trail from on-chain data and the repository scripts, how to read each billing event in plain language, and what PayFlow does **not** provide.

> **Disclaimer:** This document is operational guidance, not legal, tax, or regulatory advice. Requirements vary by jurisdiction. Engage qualified counsel and accountants for compliance decisions. FlowPay is currently deployed on **Testnet only** and has **not** been formally audited — see [SECURITY.md](./SECURITY.md).

---

## Why an on-chain audit trail matters

PayFlow does not custody customer funds in a merchant bank account. Recurring charges move SAC tokens (for example XLM) from the subscriber’s wallet to the merchant (minus any protocol fee) through the Soroban contract.

That means:

- The **ledger of record** for each successful charge is the Stellar network (contract events + token transfers).
- Your finance team can reconcile merchant inflows against wallet or exchange deposits using event amounts and transaction hashes.
- Incomplete off-chain books are recoverable **only if** you indexed or exported events before RPC providers drop them.

---

## What’s on-chain vs ephemeral

### Durable enough for audit _if you retain it_

| Artifact                                                  | Where it lives              | What finance can use it for                                   |
| --------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| Contract events (`charged`, `subscribed`, `cancelled`, …) | Stellar ledger history      | Complete billing journal: who paid whom, when, gross/fee/net  |
| `Subscription` record                                     | Persistent contract storage | Current terms: merchant, amount, interval, pause/active flags |
| Merchant revenue counters / day buckets / history         | Persistent storage          | Cumulative and daily revenue snapshots                        |
| Charge history timestamps                                 | Persistent storage          | Recent charge _times_ only (see limits below)                 |
| Whitelist / freeze / referral / metadata                  | Persistent storage          | Merchant directory and labels — not full payment proof        |

### Ephemeral — do **not** treat as long-term evidence

| Artifact                                            | Storage tier | Behavior                                                                        |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| Daily spend limit / daily spent / day-start markers | Temporary    | Expire after ~24 hours (`17,280` ledgers). Permanently deleted; not restorable. |
| Pending fee / grace / upgrade proposals             | Temporary    | Short-lived propose → commit state (~1 day TTL).                                |

See [architecture/storage_and_ttl.md](./architecture/storage_and_ttl.md) for storage tiers and TTL policy, and [ARCHITECTURE.md](./ARCHITECTURE.md#storage-strategy) for the high-level map.

**Practical rule:** Events are the audit trail. Contract storage is a convenience snapshot. Temporary keys are operational controls, not archives.

---

## Generating an audit trail

> **Note on `scripts/audit-trail.ts`:** Issue acceptance criteria refer to a dedicated `scripts/audit-trail.ts` consolidator. That script is **not present in this repository yet** (tracked as the planned audit-trail tooling work). The steps below produce an equivalent merchant audit package with the scripts that **do** ship today: event replay/watch, merchant export, subscription snapshot, and on-chain charge-history reads.

### Prerequisites

1. Node.js 18+ and dependencies under `scripts/` (`cd scripts && npm install`).
2. Environment (Testnet defaults shown):

| Variable                            | Purpose                                  |
| ----------------------------------- | ---------------------------------------- |
| `VITE_CONTRACT_ID` or `CONTRACT_ID` | FlowPay contract ID                      |
| `VITE_RPC_URL` / `RPC_URL`          | Soroban RPC endpoint                     |
| `VITE_NETWORK_PASSPHRASE`           | Network passphrase (defaults to Testnet) |

3. Your merchant Stellar address (`G…`).
4. Optionally, an indexer database if you run continuous event ingestion (required for day-summary and churn scripts).

### Step 1 — Capture events continuously (recommended)

Soroban RPC only retains recent events (on the order of about a week — see [EVENT-DRIVEN-GUIDE.md](./EVENT-DRIVEN-GUIDE.md)). For compliance-grade retention, index early.

Live watch (human-readable):

```bash
cd scripts
CONTRACT_ID=C... npm run watch-events
```

Example line:

```text
2026-07-25T12:00:00.000Z charged | User: GABC...XYZ | Merchant: GDEF...ABC | Amount: 5.0000000 XLM | Ledger: 123456
```

Backfill a ledger window into your own store (the upsert hook in the script is a stub — wire it to your database):

```bash
CONTRACT_ID=C... npx tsx scripts/replay-events.ts --from-ledger 50000 --to-ledger 51000
```

Keep every event where the merchant field or topic matches your merchant address, especially: `subscribed`, `charged`, `pay_per_use`, `cancelled`, `paused`, `resumed`, `merchant_withdrawal`.

### Step 2 — Export a merchant revenue snapshot

```bash
npx tsx scripts/export-merchant-report.ts --merchant GDEF...ABC --output report.json
```

Example output shape:

```json
{
  "generated_at": "2026-07-25T14:00:00.000Z",
  "merchant": "GDEF...ABC",
  "total_revenue": "1000000000",
  "subscriber_count": 3,
  "daily_revenue_last_30_days": ["0", "50000000"]
}
```

Amounts are in **stroops** (1 XLM = 10,000,000 stroops) unless your export path converts them.

### Step 3 — Optional point-in-time subscription state

```bash
CONTRACT_ID=C... node --experimental-require-module scripts/subscription-snapshot.ts \
  --addresses GABC...,GXYZ... --out snapshot.json
```

Useful for proving _current_ terms, not historical charges.

### Step 4 — Cross-check recent charge timestamps on-chain

Contract storage keeps at most the last **12** charge timestamps per subscriber (`get_charge_history` / `get_charge_history_page`). That list has **no** amounts, fees, or transaction hashes. Use it only as a quick “were they charged recently?” check — not as the full journal. Details: [API.md](./API.md) charge-history sections.

### Step 5 — Assemble the audit package

Store together, with generation timestamp and contract/network identifiers:

1. Filtered event export (CSV or JSON) for the reporting period.
2. `export-merchant-report.ts` JSON.
3. Optional subscription snapshots.
4. Wallet / exchange deposit statements for the same period (for bank reconciliation).

### Example composite package (illustrative)

This is a reconstructed example combining real event and report shapes — **not** output from a single `audit-trail.ts` binary:

```json
{
  "generated_at": "2026-07-25T15:00:00.000Z",
  "network": "Testnet",
  "contract_id": "C...",
  "merchant": "GDEF...ABC",
  "entries": [
    {
      "event_type": "subscribed",
      "subscriber": "GABC...XYZ",
      "merchant": "GDEF...ABC",
      "amount_stroops": "50000000",
      "interval_seconds": 2592000,
      "ledger": 100001,
      "tx_hash": "abc123..."
    },
    {
      "event_type": "charged",
      "subscriber": "GABC...XYZ",
      "merchant": "GDEF...ABC",
      "gross": "50000000",
      "fee": "500000",
      "net": "49500000",
      "charged_at": 1719388800,
      "ledger": 105432,
      "tx_hash": "def456..."
    },
    {
      "event_type": "merchant_withdrawal",
      "merchant": "GDEF...ABC",
      "amount": "1000000000",
      "ledger": 106000,
      "tx_hash": "ghi789..."
    }
  ],
  "merchant_report": {
    "total_revenue": "1000000000",
    "subscriber_count": 1
  }
}
```

Full event schemas: [EVENTS.md](./EVENTS.md). Indexing patterns: [EVENT-DRIVEN-GUIDE.md](./EVENT-DRIVEN-GUIDE.md).

### Scripts that need an indexer database

If you already persist events to SQLite:

| Script                               | Purpose                                    |
| ------------------------------------ | ------------------------------------------ |
| `scripts/daily-revenue-summary.ts`   | UTC-day charge / fee / subscription totals |
| `scripts/fee-revenue-report.ts`      | Protocol fee totals from `charged.fee`     |
| `scripts/subscriber-churn-report.ts` | Cancellation / churn rates                 |

These do **not** replace a primary event archive; they summarize one.

---

## Interpreting the audit trail

### Billing events in finance language

| Event                                         | Meaning for books                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `subscribed`                                  | Customer enrolled; recurring price (`amount`) and period (`interval` seconds) set                                     |
| `charged`                                     | Recurring invoice collected: **gross** charged to customer, **fee** to protocol, **net** to merchant, at `charged_at` |
| `pay_per_use`                                 | One-off usage charge against an active subscription                                                                   |
| `cancelled` / `cancelled_with_refund`         | Subscription ended; no further recurring charges (refund amount only on the refund variant)                           |
| `paused` / `resumed`                          | Customer temporarily stopped / restarted billing                                                                      |
| `sub_amount_updated` / `sub_interval_updated` | Price or billing period changed                                                                                       |
| `sub_transferred`                             | Subscription moved to another Stellar address                                                                         |
| `merchant_withdrawal`                         | Merchant withdrew accrued protocol-tracked revenue (payout)                                                           |
| `daily_limit_set` / `daily_limit_removed`     | Customer changed pay-per-use daily cap (control, not revenue)                                                         |
| `fee_proposed` / `fee_committed`              | Protocol fee schedule change (policy audit)                                                                           |
| `merchant_frozen` / `merchant_unfrozen`       | Admin blocked / unblocked the merchant from new activity                                                              |
| `contract_paused` / `contract_unpaused`       | Protocol-wide halt / resume                                                                                           |

Amounts on `charged` are the structured source for revenue recognition splits (gross vs fee vs net). Prefer event payloads over reconstructing from token transfers alone.

### Reconciling with bank or exchange records

1. For each `charged` or `pay_per_use` event in the period, note `net` (or amount), `tx_hash`, and ledger time.
2. In the merchant wallet or the exchange that received deposits, match inbound SAC transfers by amount and timestamp (allow for network latency and batching).
3. Match `merchant_withdrawal` events to withdrawals from the contract’s revenue accounting into the merchant wallet.
4. Expect **gross − fee = net**. Protocol fees go to the configured fee collector, not the merchant — do not book fee as merchant revenue.
5. Investigate gaps: missing events usually mean RPC retention lapsed without an indexer, or filters excluded the merchant.

Token transfers prove value movement; contract events prove _why_ (subscription charge vs pay-per-use vs withdrawal). Keep both in the audit package when possible.

---

## Data retention

| Concern                     | Fact                                                             | Recommendation                                                                      |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| RPC event history           | Short retention (~week order)                                    | Run `watch-events` / indexer continuously; archive to your own storage              |
| Subscription / metadata TTL | Persistent keys target ~1 year (`6,307,200` ledgers) when bumped | Idle subscriptions may archive; call `extend_subscription_ttl` or restore if needed |
| Merchant revenue keys       | Extended ~90 days on write in current code                       | Export reports regularly; do not rely on day buckets alone for multi-year books     |
| Charge history storage      | Max **12** timestamps; clearable by user                         | Never use as sole multi-year evidence                                               |
| Temporary daily limits      | Deleted after ~24h                                               | Irrelevant for long-term audit                                                      |
| Admin clears                | Admin can clear merchant revenue history / reset revenue         | Treat admin actions as privileged; log them off-chain                               |

**Retention recommendation:** Keep an off-chain append-only event store (and periodic merchant report exports) for as long as your accounting and tax rules require. The chain is the source of truth, but RPC nodes and temporary storage will not keep a multi-year merchant archive for you.

---

## Limitations

PayFlow / FlowPay does **not** provide:

| Expectation                       | Reality                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| KYC / identity verification       | Addresses only — no identity documents or sanctions screening                                            |
| Tax calculation or filing         | No tax engine, jurisdiction rules, or Form exports                                                       |
| Legal dispute resolution          | No on-chain arbitration for failed or disputed charges                                                   |
| Guaranteed charge timing          | Recurring charges depend on an external [keeper](./GLOSSARY.md#keeper) calling `charge` / `batch_charge` |
| Complete on-chain invoice archive | Storage keeps only recent timestamps; full history requires indexed events                               |
| Production Mainnet assurance      | Testnet deployment; no formal security audit yet ([SECURITY.md](./SECURITY.md))                          |
| Custody or bank statements        | Non-custodial protocol — bank-style statements are your responsibility off-chain                         |

Broad admin powers (pause, freeze merchants, clear history, upgrade) exist. Treat admin key holders as highly trusted for any compliance narrative.

---

## Related documentation

| Document                                                             | Topic                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| [SECURITY.md](./SECURITY.md)                                         | Security model, auth table, known limitations, disclosure |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                                 | Modules, storage strategy, event architecture             |
| [EVENTS.md](./EVENTS.md)                                             | Full event payload reference                              |
| [EVENT-DRIVEN-GUIDE.md](./EVENT-DRIVEN-GUIDE.md)                     | Indexing, replay, RPC retention                           |
| [architecture/storage_and_ttl.md](./architecture/storage_and_ttl.md) | Storage tiers and TTL                                     |
| [API.md](./API.md)                                                   | Charge and charge-history APIs                            |
| [GLOSSARY.md](./GLOSSARY.md)                                         | Protocol terminology                                      |
