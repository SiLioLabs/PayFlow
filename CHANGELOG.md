# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Versioning note:** `package.json` and `contract/Cargo.toml` declare `0.1.0`.
> There are no git tags and no GitHub Releases. `[0.1.0]` is the cumulative
> documented baseline for that declared version. Undated entries under
> `[Unreleased]` are preserved from the prior changelog and track work not
> yet cut as a tagged release.

## [Unreleased]

### Added

- Add `subscribe_with_metadata` composite subscription flow.
- Enforce global volume cap with rolling hourly volume checks.
- Add contract pause/unpause emergency guardrails.
- Add protocol stats snapshot retrieval.

### Changed

- Add pause validation checks in subscription and charge operations.
- Improve error handling for metadata and volume limit violations.

## [0.1.0]

Declared package version (`0.1.0`). Documents the contract and supporting
surface built since the initial FlowPay commit. Features landed over time
on `master`; they were never published as separate SemVer tags.

### Added

- Initial FlowPay / PayFlow Soroban contract: `initialize`, `subscribe`,
  `charge`, `pay_per_use`, `cancel`, and `get_subscription`, plus React
  frontend and core docs.
- Multi-token (SAC) support so subscriptions can use XLM, USDC, or other
  custom tokens.
- Subscription `pause` / `resume`.
- `batch_charge` for keeper-style multi-user charging in one transaction.
- Protocol fee, admin, and merchant whitelist modules.
- Contract-wide grace period (`GracePeriod` storage, charge-window
  enforcement, getters/setters; later two-step propose/commit).
- Optional trial periods on subscribe (`trial_period` /
  `trial_duration`, `get_trial_end`).
- Referral tracking on subscribe (`Referral` storage, referrer on
  `Subscription`, related events).
- Subscription metadata and charge history (ring buffer of up to 12
  charge timestamps per user), including paginated reads and admin clear.
- Daily spending limits for `pay_per_use` (`set_daily_limit`,
  `get_daily_spent`, `remove_daily_limit`, enforce on spend).
- Public `get_daily_limit` read API (symmetric to `set_daily_limit`).
- Merchant freeze / unfreeze (`freeze_merchant`, `unfreeze_merchant`,
  `MerchantFrozen` storage).
- Append-only subscriber index with paginated keeper reads
  (`get_subscriber_count` / `get_subscriber_at` / `get_subscriber_page`).
- Admin emergency `batch_pause_subscriptions`.
- Schema versioning and `migrate` for storage upgrades.

### Changed

- **BREAKING:** `initialize` gained a required `admin` argument (was
  `initialize(token)` only).
- **BREAKING:** Subscription storage schema v1 → v2 adds `paused: bool`.
  Callers and off-chain indexers that decode raw subscription entries must
  use the v2 layout; run `migrate(users)` after upgrade.
- **BREAKING:** `migrate` signature evolved from a no-arg version stamp to
  `migrate(users: Vec<Address>)` that rewrites per-user v1 subscriptions.
- Spending-limit reset model improved: `DayStart` temporary anchor so the
  daily window does not slide on every spend; `remove_daily_limit` also
  clears `DailySpent` / `DayStart`.
- Grace-period admin path moved to propose/commit (two-step) with TTL
  bumping and safety checks.
- Charge history exposed as public contract reads (full list + page) and
  TTL handling on history entries.

### Fixed

- Self-referral rejected in `subscribe` / `store_referral`.
- Daily-limit removal left stale spend counters (cleared on remove).
- Various charge / referral / revenue-path correctness fixes accompanying
  feature merges.

### Security

- **BREAKING:** `migrate` requires contract admin auth and emits
  `MigrationCompleted`.
- Merchant freeze blocks frozen merchants from receiving new subscription
  activity as enforced in validation/whitelist paths.
- Daily spending caps limit unbounded `pay_per_use` drain.
- Contract- and subscription-level pause controls for emergency halt.
