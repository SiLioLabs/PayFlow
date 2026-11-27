# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

- `package.json`, `contract/Cargo.toml`, `vesting/Cargo.toml`, and `frontend/package.json` currently declare `0.1.0`. No git tags or GitHub Releases exist yet.
- A release MAJOR/MINOR/PATCH change follows SemVer. **MAJOR** covers incompatible contract or public ABI changes; **MINOR** adds backward-compatible functions or fields; **PATCH** fixes behavior without changing the public interface.
- Storage layout and migration changes are release-breaking unless an existing instance can migrate automatically. The contract schema version, ABI, and migration requirement must be called out explicitly in the changelog.
- Breaking entries use `**BREAKING**` and describe the affected function, wire/schema field, migration, and required caller action.
- Contract WASM and schema changes should be tagged together with a release where practical. Until formal releases exist, `[0.1.0]` is the cumulative baseline and `[Unreleased]` contains work not yet released.

## [Unreleased]

- **BREAKING** `contract_health_check` returns the optional `instance_bump_age_ledgers` field in place of `instance_ttl_ledgers`. Update consumers and submit a TTL maintenance call to initialize telemetry on idle upgraded deployments.
- Schema v4 moves legacy subscriptions to ID zero through `migrate` and `finalize_migration`. Additional subscriptions have independent per-user IDs and token-specific settlement analytics.
- Soroban SDK 30 requires Stellar CLI 30 or later to build deployable contract Wasm.
- Emergency operators use `set_contract_paused_as`, `freeze_merchant_as`, and `unfreeze_merchant_as` with their address and signature. Admin entrypoints retain their argument lists.
- **BREAKING** Disambiguate conflicting error codes. Migration incomplete is 53, skip cooldown is 54, and invalid merchant fee basis points is 55.

### Added

- Add `get_version()`, which returns the release semver embedded from `contract/Cargo.toml` (`CARGO_PKG_VERSION`), and a matching `version` field on `ContractConfig` (`get_contract_config`). `scripts/deploy-pipeline.ts` gains a `contract-version` gate and records `contractVersion`/`buildVersion` in `deployments/manifest.json`. **ABI:** `ContractConfig` has a new trailing field, so clients that decode it must regenerate bindings.
- Reserve error code 37 with a deprecated `Reserved37` variant so the slot can never be reused. `scripts/check-error-codes.mjs` now fails on any undeclared numeric gap and on any deprecated error variant referenced from contract code. The Documentation Guards workflow now also runs on `contract/src/**` changes.
- Publish a deprecation schedule for `ContractPausedError` (30) and `Reserved31` (31) in `docs/ERROR-CODES.md`: removal criteria and earliest removal release.
- Add instruction-budget benchmarks for `batch_cancel` (25), `batch_pause_subscriptions` (25), `get_next_charge_batch` (dense and worst-case sparse 50-slot pages) and `transfer_subscription`, with documented `MAX_*_INSTRUCTIONS` thresholds.
- Add `get_charges_due_between(from, to, offset, limit)`, a bounded keeper read of subscribers due inside a time window, with their `next_charge_at`. The bundled keeper uses it to wake up when the next subscription comes due, and never sleeps longer than `INTERVAL_SECONDS`.
- Add an optional keeper tip. `set_keeper_tip_bps` (admin, capped at 5000 bps of the protocol fee; default 0) and `charge_with_tip(user, keeper)` pay the keeper out of the protocol fee. Emits `keeper_tip_bps_set` and `keeper_tip`.
- Add `finalize_migration(expected_total)` and `get_migration_progress()`. Migration is now resumable and tracks processed accounts.
- Document and test which entrypoints the contract pause blocks (the pause matrix in `docs/spec/LIFECYCLE-SPEC.md`). Exit paths (`cancel`, `resume`, `remove_daily_limit`) stay available while paused.
- Add `subscribe_with_metadata` composite subscription flow.
- Enforce global volume cap with rolling hourly volume checks.
- Add contract pause/unpause emergency guardrails.
- Add protocol stats snapshot retrieval.
- Add deprecation aliases for environment variables: `KEEPER_SECRET` → `SECRET_KEY`, `NETWORK_PASSTHRASE` → `NETWORK_PASSPHRASE` (with fallback and warning).
- Add config tests for environment variable normalization and alias resolution.
- Document `batch_charge_skips` event as the canonical signal for charge failures (allowance_insufficient field).

### Changed

- Add pause validation checks in subscription and charge operations.
- Improve error handling for metadata and volume limit violations.
- **BREAKING (config):** `.env.example` now documents canonical env var names: `SECRET_KEY` and `NETWORK_PASSPHRASE`. Old names (`KEEPER_SECRET`, `NETWORK_PASSTHRASE`) are deprecated but supported for backwards compatibility.
- **Fixed:** Charge failure alerting now correctly reads `batch_charge_skips` events with `allowance_insufficient > 0` instead of querying non-existent `charge_failed` event.
- **BREAKING (migration):** `migrate(users)` no longer advances the schema version. Operators must call `finalize_migration(expected_total)` after processing every account. Before, the version jumped to current after any batch, which could clear `SchemaMigrationRequired` while accounts were still unmigrated. `migrate` is now idempotent per account.
- **Fixed:** `scripts/migrate-contract.ts` resumes from `migrated_accounts` and simulates `finalize_migration`. It previously referenced an undefined `RPC_URL` and always failed its own version check.

### Fixed

- **Broken build on `master`:** `contract/src/lib.rs` (`get_next_charge_batch`) and `contract/src/test.rs` had leftover fragments from merge #1222 that did not parse. Removed them. `test.rs` also had three duplicate `test_cancelled_subscription_not_listed` definitions and a truncated grace-period test. Repaired.

### Fixed

- Charge failure alerting now correctly reads `batch_charge_skips` events with `allowance_insufficient > 0` instead of querying no `charge_failed` event.
- `scripts/config.ts` normalizes deprecated aliases to canonical names before validation, with startup warnings for legacy names.
- **Dead charge-failure alerting:** Indexer now documents which contract topics map to charge failures; alert-failed-charges reads the correct `batch_charge_skips` event.
- **Secret key naming chaos:** Config reads canonical `SECRET_KEY` and `NETWORK_PASSPHRASE`; aliases (`KEEPER_SECRET`, `NETWORK_PASSTHRASE`) are supported with deprecation warnings.
- **ESM/CJS mismatch:** Verified all scripts use consistent ESM (import.meta.url, top-level awaits, .js-style imports). No CJS require.main or module.exports patterns detected.

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
