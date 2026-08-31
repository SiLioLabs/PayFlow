# PayFlow Open-Source Contribution Wave Issues

This file contains **125** GitHub-ready issues for an upcoming contribution wave. Every issue is grounded in the current PayFlow/FlowPay repository architecture (Soroban contract under `contract/`, React app under `frontend/`, operational TypeScript under `scripts/`, and docs under `docs/`).

**Distribution:** 45 Contract · 30 Frontend · 30 Backend · 20 Documentation  
**Complexity:** 200 points each

---

## Issue 001: Make batch_charge tolerate insufficient allowance without aborting the batch

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`batch_charge` in `contract/src/batch.rs` is the keeper workhorse documented in `docs/KEEPER.md` and `docs/ARCHITECTURE.md`. It returns per-user `ChargeResult` values so one bad subscriber should not fail peers. Transfers run through `fee::transfer_subscription_charge` → SAC `transfer_from`.

### Problem

When a due subscriber lacks allowance/balance, `transfer_from` panics inside `charge_exec::execute_charge`, aborting the whole transaction and rolling back earlier successful charges in the same batch—breaking the non-aborting batch model keepers rely on.

### Goal

Convert allowance/transfer shortfalls on the batch path into per-user `ChargeResult` outcomes so healthy subscribers in the same call still charge.

### Scope

Includes: `ChargeResult` extension, pre-check or catch strategy on batch path, unit tests for mixed batches.
Does NOT include: changing single-user `charge()` panic semantics (unless shared safely), or frontend work.

### Implementation Guidelines

- Primary files: `batch.rs`, `charge_exec.rs`, `fee.rs`, `errors.rs`, `test.rs`.
- Mirror `simulate_charge` allowance checks before `execute_charge`.
- Watch fee+net split: allowance must cover gross `sub.amount`.
- Security: do not bypass `transfer_from` auth model.
- Edge cases: exact allowance, zero allowance, auto-resume then under-allowanced.

### Acceptance Criteria

- [ ] Batch with mixed healthy/under-allowanced users charges healthy ones and reports failures for others
- [ ] New result variant(s) documented for keeper parsers
- [ ] Existing skip/inactive/paused batch tests still pass
- [ ] No silent success when allowance is insufficient

### Validation

Run `cargo test` in `contract/`. Add tests that set one user's allowance below `sub.amount` in a multi-user batch and assert partial success plus token balance deltas.

### PR Expectations

The PR should include:

- Contract + test changes
- PR note describing new ChargeResult semantics for `scripts/keeper.ts` consumers

---

---

## Issue 002: Enforce global volume cap before any SAC transfers

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`check_and_update_global_volume` in `contract/src/lib.rs` backs the hourly volume safety limit (`GlobalVolumeWindow`, `GlobalVolumeCapOverride`, `GLOBAL_MAX_VOLUME_PER_HOUR`).

### Problem

In `charge_exec::execute_charge` and `pay_per_use_inner`, the volume check runs after `fee::transfer_*`. Cap breaches can panic after transfer calls are attempted, violating fail-closed expectations and confusing simulation vs execution ordering.

### Goal

Check and reserve volume capacity before transfers; only mutate the window when the charge is allowed to proceed.

### Scope

Includes: reorder/pre-check in charge and pay-per-use paths; align `simulate_charge` where applicable; regression tests.
Does NOT include: changing default cap economics.

### Implementation Guidelines

- Files: `charge_exec.rs`, `lib.rs`, existing `test_global_volume_*` tests.
- Ensure window rollover (`HOUR_IN_SECONDS`) still works.
- Keep `GlobalVolumeExceeded` behavior for callers.

### Acceptance Criteria

- [ ] Over-cap attempts move zero tokens
- [ ] Under-cap paths unchanged functionally
- [ ] simulate/estimate do not claim success when cap blocks
- [ ] Boundary tests at exact cap

### Validation

`cargo test` with balance assertions on over-cap failures.

### PR Expectations

The PR should include:

- Reorder + tests
- Short security rationale in PR body

---

---

## Issue 003: Enforce MinFeeBps/MaxFeeBps inside propose_fee

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`set_fee_bounds` / `get_fee_bounds` store governance guardrails on `MinFeeBps`/`MaxFeeBps`. `fee::propose_fee` only rejects `bps > 10_000` and self collectors.

### Problem

Admins can propose fees outside configured bounds, making `set_fee_bounds` ineffective against the misconfiguration risk its own docs describe.

### Goal

Reject out-of-bounds proposals with a typed `ContractError` and test propose/commit under bounds.

### Scope

Includes: validation on propose (optional defense on commit), tests, error docs if needed.
Does NOT include: new timelock beyond `PendingFee` TTL.

### Implementation Guidelines

- Files: `fee.rs`, `lib.rs` propose_fee wrapper, `errors.rs`, `test.rs`.
- Default bounds remain `(0, 10000)` when unset.
- Edge: min==max, exact boundaries.

### Acceptance Criteria

- [ ] Out-of-bounds propose fails
- [ ] Boundary values accepted
- [ ] commit still works for valid pending fee
- [ ] Tests prove set_fee_bounds constrains propose_fee

### Validation

`cargo test` fee proposal suites.

### PR Expectations

The PR should include:

- Validation + tests
- ERROR-CODES / API note if error surface changes

---

---

## Issue 004: Harden set_initial_admin with require_auth and typed errors

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`initialize` sets admin via `admin::initialize_admin` (auth required). `set_initial_admin` writes `DataKey::Admin` if absent using a string `panic!` and no `require_auth`.

### Problem

An unauthenticated caller can claim admin on a partially initialized deployment, and string panics bypass `ContractError` mapping used by frontend/scripts (`docs/ERROR-CODES.md`).

### Goal

Require the proposed admin to authorize the call, use typed errors for already-set cases, and clarify bootstrap vs `initialize`.

### Scope

Includes: auth, typed errors, tests.
Does NOT include: multi-admin or redesign of `initialize`.

### Implementation Guidelines

- Files: `lib.rs`, `admin.rs`, `errors.rs`, `test.rs`; align `docs/SECURITY.md` auth row if touched.
- Edge: after initialize; Admin missing but Token present.

### Acceptance Criteria

- [ ] admin.require_auth() enforced
- [ ] Second call returns typed ContractError
- [ ] Success-once tested
- [ ] Auth matrix accurate

### Validation

`cargo test` for bootstrap paths; verify try_ error codes.

### PR Expectations

The PR should include:

- Hardened entrypoint + tests
- Security note

---

---

## Issue 005: Align get_batch_charge_estimate skip outcomes with simulate_charge for existing ChargeResult reasons

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`get_batch_charge_estimate` and `simulate_charge` (`charge_exec.rs`, `lib.rs`) are the keeper dry-run surfaces used by `scripts/keeper.ts`. Live `batch_charge` already returns `Skipped`, `Paused`, `Inactive`, `GracePeriodElapsed`, and `NoSubscription` without requiring the allowance-tolerance work tracked separately.

### Problem

Estimate and simulate can disagree on pause auto-resume, grace windows, and not-due timing for those existing skip reasons. That drift causes false-positive dry-runs and wasted fees even when allowance handling is unchanged.

### Goal

Introduce a shared precheck used by `simulate_charge` and `get_batch_charge_estimate` so their outcomes match for the existing skip/pause/grace/inactive/not-due matrix, with intentional differences documented in code comments.

### Scope

Includes: shared precheck helper for existing skip reasons, parity tests, comments listing intentional differences (e.g. estimate never transfers).
Does NOT include: allowance/InsufficientAllowance handling (owned by Issue 001), volume-cap precheck redesign, or keeper TypeScript changes.

### Implementation Guidelines

- Files: `charge_exec.rs`, `batch.rs` / estimate path in `lib.rs`, `test.rs`.
- Build a table-driven parity matrix: paused (with/without expiry), grace elapsed, not due, inactive, missing subscription, contract paused.
- Explicitly leave allowance shortfalls out of this issue’s acceptance criteria.
- Keep instruction cost low; reuse existing helpers where possible.

### Acceptance Criteria

- [ ] simulate_charge and get_batch_charge_estimate agree on the existing skip/pause/grace/inactive/not-due cases covered by tests
- [ ] Code comments document any intentional remaining differences
- [ ] No ChargeResult/ChargeSimResult allowance variants are introduced in this PR
- [ ] Existing successful charge paths remain unchanged

### Validation

`cargo test` including new parity-matrix tests. Confirm Issue 001 concerns are not re-implemented here.

### PR Expectations

The PR should include:

- Shared precheck for existing skip reasons + parity tests
- Comment block listing intentional differences and explicit non-goals (allowance)

---

## Issue 006: Preflight gross allowance before two-leg fee and net transfers

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`fee::transfer_subscription_charge` and `transfer_pay_per_use` may call `transfer_from` twice (collector then merchant/recipient) and bump `TotalProtocolFees`.

### Problem

Without an explicit gross-allowance preflight inside the helpers, auditors and integrators cannot see the invariant “allowance ≥ amount” next to the two-leg pattern, and edge failures are harder to reason about even though Soroban aborts atomically.

### Goal

Check allowance ≥ gross amount before either transfer; document two-leg atomicity for auditors; test fee_bps > 0 with exact allowance.

### Scope

Includes: helper preflight, comments, tests.
Does NOT include: redesigning to escrow/pull-once unless clearly better and SAC-safe.

### Implementation Guidelines

- Files: `fee.rs`, fee-related tests in `test.rs`.
- Edges: fee rounds to 0; high bps within bounds.

### Acceptance Criteria

- [ ] Preflight present before transfers
- [ ] Exact allowance == amount succeeds with fees
- [ ] Auditor comment documents atomic two-leg model

### Validation

`cargo test` fee and pay-per-use tests.

### PR Expectations

The PR should include:

- Helper hardening + tests

---

---

## Issue 007: Resolve whitelist batch TODO by wiring configurable batch limits

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`whitelist_batch_add`/`remove` hardcode `MAX_WHITELIST_BATCH_SIZE` with TODOs referencing a configurable limit. `MaxBatchSize` already configures charge batches via `set_max_batch_size`.

### Problem

Unfinished TODOs in production entrypoints and inconsistent admin batch caps complicate operations and reviews.

### Goal

Remove TODOs by deliberately wiring whitelist batches to a documented cap strategy (shared `MaxBatchSize` or dedicated setter) with safe defaults.

### Scope

Includes: implementation, tests, getter clarity.
Does NOT include: unbounded batches.

### Implementation Guidelines

- Files: `lib.rs`, `whitelist.rs`, `batch.rs`/`limits.rs`, `test_whitelist_batch_*`.
- Default remains ≤ 50 unless bench justifies more.
- Panic with `BatchTooLarge`/`InvalidBatchSize` consistently.

### Acceptance Criteria

- [ ] TODOs removed
- [ ] Over-limit panics tested
- [ ] Default behavior preserved
- [ ] Design choice explained in PR

### Validation

`cargo test` whitelist batch tests.

### PR Expectations

The PR should include:

- Limit wiring + tests
- Design rationale

---

---

## Issue 008: Replace unwrap/unchecked arithmetic in trial, fee, and volume paths

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`trial.rs` uses `checked_add(...).unwrap()`; fee multiply and volume adds use plain arithmetic near large caps (`MAX_SUBSCRIPTION_AMOUNT`, `GLOBAL_MAX_VOLUME_PER_HOUR`).

### Problem

Overflow becomes string panics or undefined failure modes instead of typed `ContractError`, hurting safety and client mapping.

### Goal

Use checked arithmetic with typed errors across trial extend, fee calculation, and volume accumulation.

### Scope

Includes: safe math, tests for overflow fixtures.
Does NOT include: changing economic caps unless needed for fixtures.

### Implementation Guidelines

- Files: `trial.rs`, `fee.rs`, `lib.rs` volume helper, `errors.rs`.
- Prefer panic_with_error on None from checked_*.

### Acceptance Criteria

- [ ] No unwrap on trial extend arithmetic
- [ ] Fee/volume checked
- [ ] Overflow tests fail closed with typed errors

### Validation

`cargo test` including overflow cases.

### PR Expectations

The PR should include:

- Safe math + tests

---

---

## Issue 009: Emit indexer-friendly events for non-success batch_charge outcomes

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`events.rs` emits `charged` on success. Indexer (`scripts/indexer.ts`) and `watch-events.ts` are event-driven; skip results only appear in return values.

### Problem

Event-only monitoring cannot see GracePeriodElapsed/Paused/allowance failures, undercutting alerts and analytics.

### Goal

Add additive event(s) for interesting non-success batch outcomes without flooding every not-due skip.

### Scope

Includes: event design, emission, tests; light EVENTS.md touch OK.
Does NOT include: full indexer migration (backend issue can follow).

### Implementation Guidelines

- Files: `events.rs`, `batch.rs`, `test.rs`.
- Prefer summarizing interesting failures to control fees/size.
- Measure instruction impact vs `bench.rs`.

### Acceptance Criteria

- [ ] Interesting failures observable on-chain via events
- [ ] charged events unchanged
- [ ] Tests assert topics/data
- [ ] Instruction impact noted

### Validation

`cargo test` event tests; optional bench.

### PR Expectations

The PR should include:

- Events + tests
- Parser note for indexers

---

---

## Issue 010: Clarify and correct contract_health_check TTL and duplicate pending fields

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`HealthReport` from `contract_health_check` exposes `instance_ttl_ledgers` (hardcoded `100_000` on-chain) and duplicate `pending_merchant_rev_count` / `pending_merchant_revenue_count` filled identically.

### Problem

`scripts/health-check.ts` and UI health widgets can misread placeholder TTL as real; duplicate fields confuse API consumers of `docs/API.md`.

### Goal

Honest health signaling for TTL limitations and a clear single semantic for pending merchant revenue indicators.

### Scope

Includes: HealthReport cleanup (additive/deprecate carefully), tests, consumer notes.
Does NOT include: metrics-server work.

### Implementation Guidelines

- Files: `lib.rs` HealthReport + health_check.
- Document Soroban TTL read limits rather than inventing precision.

### Acceptance Criteria

- [ ] No undocumented fake TTL precision
- [ ] Duplicate fields resolved or differentiated
- [ ] Healthy/paused/unconfigured cases tested

### Validation

`cargo test`; sanity-check script compatibility.

### PR Expectations

The PR should include:

- HealthReport update + tests + note

---

---

## Issue 011: Add decoder-stability tests and docs for ChargeResult discriminant ordering after batch outcome extensions

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`ChargeResult` in `batch.rs` is decoded by keepers, `alert-failed-charges.ts`, and indexers. Wave work that adds new batch outcomes (for example allowance failures in Issue 001) can silently break off-chain discriminants if variant order or naming drifts.

### Problem

Off-chain parsers assume stable enum layout. Without contract-side golden tests and a short decode note, a benign enum reorder becomes a production classification bug.

### Goal

Add contract tests that lock `ChargeResult` (and closely related estimate mappings) to documented discriminant/name expectations, plus a brief decode-compatibility note for script authors.

### Scope

Includes: golden/unit tests for ChargeResult variant set and ordering semantics, a short in-repo note (test module comment or docs/ERROR-CODES or EVENTS cross-link as appropriate).
Does NOT include: implementing allowance tolerance itself (Issue 001), frontend mappers, or indexer schema migrations.

### Implementation Guidelines

- Files: `batch.rs`, `test.rs`; optional light touch to `docs/ERROR-CODES.md` or `docs/KEEPER.md` only for discriminant notes.
- Prefer tests that fail if variants are reordered or renamed unexpectedly.
- If Issue 001 has already added a variant, lock that extended set; otherwise lock the current set and document extension rules.
- Keep this a verification/compatibility deliverable, not a second batch-charge behavior change.

### Acceptance Criteria

- [ ] Automated tests assert ChargeResult variant identity/order expectations used by off-chain parsers
- [ ] A short decode-compatibility note exists for script/indexer authors
- [ ] PR does not change batch_charge transfer behavior beyond what tests require for assertions
- [ ] CI `cargo test` covers the new golden/compatibility tests

### Validation

`cargo test` focusing on ChargeResult compatibility tests. Optionally demonstrate a deliberate rename would fail the suite.

### PR Expectations

The PR should include:

- Compatibility/golden tests + decode note
- Clear statement that behavioral allowance handling remains Issue 001

---

## Issue 012: Fail closed when fee bounds storage is inconsistent at commit time

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Two-step fee flow uses temporary `PendingFee` and instance `FeeCollector`/`FeeBps`. Bounds can change between propose and commit.

### Problem

An admin could propose in-bounds fees then tighten bounds before commit (or vice versa) without commit-time validation, surprising operators.

### Goal

Re-validate pending bps against current bounds at `commit_fee`, with clear errors and tests for bounds changed mid-flight.

### Scope

Includes: commit-time check, tests.
Does NOT include: multi-party governance.

### Implementation Guidelines

- Files: `fee.rs` commit_fee, tests.
- Decide: reject commit vs auto-clear pending—document choice.

### Acceptance Criteria

- [ ] Commit rejects out-of-bounds pending
- [ ] Tests cover bounds tightened after propose
- [ ] Pending cleared or retained per documented policy

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- Commit validation + tests

---

---

## Issue 013: Extend PauseExpiry TTL whenever Subscription TTL is bumped

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`storage::extend_subscription_ttl` refreshes `DataKey::Subscription(user)`. Bounded pause stores a separate persistent `PauseExpiry(user)` key used by `try_auto_resume` in `charge_exec.rs`. Keepers call `bump_subscription` / `batch_extend_subscription_ttl` for dormant subscribers.

### Problem

If Subscription TTL is extended but PauseExpiry is not, pause expiry can archive while the subscription remains. Auto-resume then silently stops working even though `sub.paused` is still true—breaking `pause_until` semantics.

### Goal

Whenever subscription TTL is extended via the existing bump helpers, also extend `PauseExpiry` when that key exists, with unit tests covering bump and batch_extend paths.

### Scope

Includes: TTL extend for `PauseExpiry` inside subscription bump helpers, tests for present/absent expiry keys.
Does NOT include: rewriting merchant revenue TTL policy, charge-history TTL redesign, or metadata key TTL sweeps.

### Implementation Guidelines

- Files: `storage.rs`, `batch.rs` (`batch_extend_subscription_ttl`), pause paths that already write PauseExpiry, `test.rs` (`test_pause_until_*`).
- Use existing `SUBSCRIPTION_TTL_LEDGERS` thresholds for consistency.
- No-op safely when PauseExpiry is absent.
- Edge: pause_until then batch_extend then advance ledger near TTL boundary.

### Acceptance Criteria

- [ ] bump_subscription / batch_extend_subscription_ttl extend PauseExpiry when present
- [ ] Absent PauseExpiry remains a no-op
- [ ] Auto-resume still observes expiry after TTL maintenance in tests
- [ ] No unrelated persistent keys are modified

### Validation

`cargo test` pause_until + TTL bump tests with PauseExpiry present and absent.

### PR Expectations

The PR should include:

- PauseExpiry TTL coupling + tests
- Brief comment in storage helper documenting the invariant

---

## Issue 014: Add authorization-boundary tests for administrative entrypoints

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Admin operations use `admin::require_admin` across whitelist, freeze, fees, pause_contract, migrate, revenue resets, etc. `docs/SECURITY.md` stresses reviewing auth when adding functions.

### Problem

Test coverage is uneven across admin entrypoints; missing negative tests risk regressions that ship unauthenticated admin mutations.

### Goal

Add a systematic authorization-boundary test module covering representative admin entrypoints (success with admin auth, panic without, reject non-admin).

### Scope

Includes: tests grouping in `test.rs` or new test module file if repo pattern allows.
Does NOT include: changing auth model except bugfixes discovered.

### Implementation Guidelines

- Cover at least: `freeze_merchant`, `propose_fee`, `pause_contract`, `set_min_interval`, `batch_cancel`, `migrate`, `set_global_volume_cap`, `whitelist_batch_add`.
- Use try_ invocations and `ContractError` where applicable.

### Acceptance Criteria

- [ ] Each listed entrypoint has auth success and failure coverage
- [ ] Failures do not mutate storage
- [ ] Suite runs in CI via existing rust.yml

### Validation

`cargo test` auth boundary module.

### PR Expectations

The PR should include:

- New tests only (or minimal fixes)
- Matrix table in PR description

---

---

## Issue 015: Harden transfer_subscription subscriber-index and MerchantSubCount integrity

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`transfer_subscription` moves ownership between addresses and emits `subscription_transferred`. Keepers rely on `SubscriberIndex` / tombstones (`SubscriberIndexRemoved`) and `MerchantSubCount` (`subscription_count.rs`, `merchant_stats.rs`) when paging due users.

### Problem

Transfers that mishandle index slots or merchant counters leave orphan index entries or wrong merchant subscriber counts, causing missed or duplicate keeper work.

### Goal

Ensure `transfer_subscription` updates subscriber-index membership and `MerchantSubCount` correctly for source/target edge cases (inactive target record, tombstoned slots), with focused regression tests.

### Scope

Includes: index + MerchantSubCount integrity on transfer, tests for success and reject paths already gated by `SubscriptionAlreadyActive`.
Does NOT include: referral/metadata/charge-history/pause-expiry migration policy changes in this PR.

### Implementation Guidelines

- Files: `lib.rs` (`transfer_subscription`), `subscription_count.rs`, merchant count helpers, existing `test_transfer_subscription_*`.
- Require source auth; reject active targets.
- After transfer: source should not remain an active indexed subscriber; target should be indexed once; merchant counts must not double-count or underflow.
- Leave referral/metadata/history/pause keys untouched unless required to keep compile/tests green—out of scope for behavioral changes.

### Acceptance Criteria

- [ ] Successful transfer keeps a single correct index membership for the new owner
- [ ] MerchantSubCount remains accurate for the subscription’s merchant
- [ ] Active-target transfers still panic/reject as today
- [ ] Regression tests cover inactive-target and tombstone-adjacent cases

### Validation

`cargo test` transfer suites including index pagination and merchant sub count assertions after transfer.

### PR Expectations

The PR should include:

- Index/count hardening + tests
- PR explicitly lists non-goals (referral/metadata/history/pause)

---

## Issue 016: Make cancel_and_refund_prorated failure modes explicit and typed

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Prorated cancel transfers from merchant balance to user (`docs/SUBSCRIBER-LIFECYCLE.md`). Implementation lives in `lib.rs` near `cancel_and_refund_prorated`.

### Problem

Merchant underfunding or token transfer failures can surface as opaque SAC panics; proration math edge cases (zero remaining interval, paused, trial) need clearer typed errors and tests for contributor confidence.

### Goal

Validate preconditions (active sub, merchant matches, positive refund, merchant balance/allowance as applicable) with typed errors and thorough tests.

### Scope

Includes: validation, errors, tests.
Does NOT include: protocol-escrowed refunds.

### Implementation Guidelines

- Files: `lib.rs`, `errors.rs`, lifecycle tests.
- Keep merchant-funded model; document clearly in code.

### Acceptance Criteria

- [ ] Typed errors for missing sub / wrong merchant / zero refund cases
- [ ] Underfunded merchant fails without cancelling state (atomic)
- [ ] Proration math tests at period start/mid/end

### Validation

`cargo test` refund tests with balance assertions.

### PR Expectations

The PR should include:

- Validation + tests + comment on funding model

---

---

## Issue 017: Add batch_charge stress coverage for max batch size and instruction ceilings

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`bench.rs` and `test_batch_charge_stress` exist; `set_max_batch_size` can raise caps. CI runs `cargo test` but instruction regressions can slip in with new prechecks/events.

### Problem

New logic in charge paths increases CPU; without updated stress assertions, keepers may hit unexpected tx failures at PAGE_SIZE.

### Goal

Strengthen stress/bench coverage so max-size batches remain within documented resource envelopes after recent features (auto-resume, fees, volume).

### Scope

Includes: stress/bench updates, documenting safe max sizes.
Does NOT include: rewriting keeper.

### Implementation Guidelines

- Files: `test.rs`, `bench.rs`, `batch.rs` defaults.
- Test at configured max and max+1 panic.

### Acceptance Criteria

- [ ] Max-size batch test passes on CI
- [ ] max+1 panics BatchTooLarge
- [ ] PR cites approximate resource usage

### Validation

`cargo test`; optional `--features bench`.

### PR Expectations

The PR should include:

- Stress tests + notes

---

---

## Issue 018: Close error-code gaps and remove duplicate ContractPaused variants

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`errors.rs` defines typed errors; numbering skips 31 and includes both `ContractPaused` and `ContractPausedError`. Frontend `utils/errors.ts` and `docs/ERROR-CODES.md` need a coherent map.

### Problem

Duplicate/ skipped codes cause mapper bugs and auditor confusion.

### Goal

Normalize error enumerations (deprecate or alias carefully), document stable codes, and add mapping tests on the contract side for published codes.

### Scope

Includes: error enum cleanup with compatibility strategy, docs touch, tests.
Does NOT include: full frontend rewrite (can note coupling).

### Implementation Guidelines

- Prefer additive compatibility if off-chain already depends on values.
- Files: `errors.rs`, tests, ERROR-CODES.md if updated here.

### Acceptance Criteria

- [ ] No unexplained gaps/duplicates without docs
- [ ] Each public panic path uses typed errors
- [ ] Compatibility strategy stated

### Validation

`cargo test`; grep for string panic! in contract src excluding tests.

### PR Expectations

The PR should include:

- Error normalization + docs/tests

---

---

## Issue 019: Require schema migration invariants before enabling new subscription writes post-upgrade

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`migration.rs` supports v1→v2→v3 (`CURRENT_VERSION = 3`) with `migrate(users)` admin-only. Subscribe paths write current `Subscription` shape including `referrer`, `paused`, `created_at`.

### Problem

If schema_version lags after WASM upgrade, mixed v1 blobs and v3 reads can panic or mis-decode, especially when operators migrate users in pages.

### Goal

Add explicit guards/tests for subscribe/charge behavior relative to `get_schema_version`, and safer paginated migrate recommendations encoded as tests/helpers.

### Scope

Includes: invariant checks or documented hard requirements enforced in code where safe; migration tests.
Does NOT include: automatic full-index migrate in one tx.

### Implementation Guidelines

- Files: `migration.rs`, `lib.rs` subscribe_inner, `test_migration_*`, root `test_migration.rs` if relevant.
- Consider refusing mutate when version < CURRENT_VERSION after upgrade flag.

### Acceptance Criteria

- [ ] Documented invariant enforced or explicitly rejected with typed error
- [ ] Paged migrate tested
- [ ] Idempotent migrate at CURRENT_VERSION

### Validation

`cargo test` migration suites.

### PR Expectations

The PR should include:

- Invariant handling + tests

---

---

## Issue 020: Add get_pause_expiry read API and event consistency for pause_until auto-resume

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`pause_until` stores `PauseExpiry`; `try_auto_resume` clears it and emits auto-resume events during charge.

### Problem

Clients cannot read pause expiry on-chain without knowing storage keys; UX and keepers guess from subscription.paused alone.

### Goal

Expose `get_pause_expiry(user) -> Option<u64>` (or equivalent) and ensure auto-resume clears storage + emits events consistently on charge and batch_charge.

### Scope

Includes: getter, tests for resume-on-charge/batch, event asserts.
Does NOT include: frontend countdown (separate).

### Implementation Guidelines

- Files: `storage.rs`, `lib.rs`, `charge_exec.rs`, `events.rs`, tests `test_pause_until_*`.

### Acceptance Criteria

- [ ] Getter returns expiry when set
- [ ] Auto-resume clears expiry on both charge paths
- [ ] Events covered by tests

### Validation

`cargo test` pause_until suites.

### PR Expectations

The PR should include:

- Getter + consistency tests

---

---

## Issue 021: Enforce a max MerchantRevenueDayIndex size with typed overflow error

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`merchant_stats.rs` maintains `MerchantRevenueDay` buckets and `MerchantRevenueDayIndex`. Admin prune APIs (`prune_merchant_revenue_days`, `bump_merchant_revenue_day`) already exist for manual cleanup.

### Problem

High-volume merchants can grow the day index without a hard on-chain ceiling, increasing storage pressure and making analytics reads expensive.

### Goal

Enforce a documented maximum day-index length when recording a new revenue day; reject growth beyond the cap with a typed `ContractError`, and cover the boundary with unit tests. Operators continue to use existing prune APIs to free capacity.

### Scope

Includes: max index size constant, enforcement at day-index append time, typed error, tests at boundary.
Does NOT include: automatic oldest-day pruning, ETL redesign, or changing prune API semantics beyond what enforcement requires.

### Implementation Guidelines

- Files: `merchant_stats.rs`, `errors.rs`, `lib.rs` revenue increment paths, `test.rs`.
- Choose a conservative default cap justified in code comments (instruction/storage awareness).
- When at cap, adding a *new* day fails closed; updating an existing day’s bucket may still succeed.
- When at cap, adding a _new_ day fails closed; updating an existing day’s bucket may still succeed.
- Document that admins must prune before the cap blocks new days.

### Acceptance Criteria

- [ ] Appending a new day beyond the cap returns a typed ContractError
- [ ] Updates to an existing day at cap still succeed (if applicable)
- [ ] Boundary tests cover cap-1 success and cap+1 failure
- [ ] Constant and operator prune expectation are documented in code comments

### Validation

`cargo test` merchant revenue day-index cap tests.

### PR Expectations

The PR should include:

- Cap enforcement + typed error + tests
- Comment explaining cap choice and prune expectation

---

## Issue 022: Validate token contract address and SAC interface on subscribe

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`validation.rs` / subscribe paths accept a token `Address`. `InvalidTokenAddress` exists. Multi-token design is core (`docs/MULTI-TOKEN.md`).

### Problem

Subscribing with a non-token contract or malformed token can fail later at allowance/charge time, leaving poor UX and messy state if partially written.

### Goal

Strengthen subscribe-time token validation (contract existence / SAC client probes as feasible in Soroban) before writing `Subscription`.

### Scope

Includes: validation helper, tests with mock token vs random address.
Does NOT include: allowlisting tokens beyond existing patterns.

### Implementation Guidelines

- Files: `validation.rs`, `subscribe_inner`, `token.rs` helpers, tests `test_custom_sac_token_*`.
- Avoid heavy probes that blow CPU—balance safety vs cost.

### Acceptance Criteria

- [ ] Non-token address rejected with InvalidTokenAddress
- [ ] Valid SAC subscribe still works
- [ ] No subscription row written on validation failure

### Validation

`cargo test` token validation cases.

### PR Expectations

The PR should include:

- Validation + tests

---

---

## Issue 023: Convert string panic/expect failures in admin, fee, grace, and upgrade modules to ContractError

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Most public entrypoints use `ContractError`, but `admin.rs`, `fee.rs`, `grace.rs`, and `upgrade.rs` still have (or risk) string `panic!` / `expect` failure paths that frontend `utils/errors.ts` and scripts cannot classify.

### Problem

String panics break typed error mapping and produce inconsistent client UX for two-step admin, fee, grace, and upgrade flows.

### Goal

Replace string `panic!`/`expect` failure paths in those four modules (and their thin `lib.rs` wrappers where needed) with typed `ContractError` values, with unit tests for the converted sites.

### Scope

Includes: admin/fee/grace/upgrade typed-error conversion + tests.
Does NOT include: auditing every unrelated module under `contract/src`, i18n of messages, or frontend mapper work.

### Implementation Guidelines

- Grep `panic!` / `expect` in `admin.rs`, `fee.rs`, `grace.rs`, `upgrade.rs` (and call sites in `lib.rs`).
- Prefer existing codes (`NoPendingProposal`, etc.) before adding new ones.
- Keep two-step temporary-storage semantics unchanged.
- Edge: missing pending proposals, missing admin, expired pending where applicable.

### Acceptance Criteria

- [ ] No string panic!/expect remains on public failure paths in the four modules
- [ ] Converted failures return typed ContractError in try_ tests
- [ ] Two-step happy paths still succeed
- [ ] PR lists each converted site

### Validation

`cargo test` for admin/fee/grace/upgrade flows; `rg 'panic!|expect\('` on those modules shows no public-path string failures.

### PR Expectations

The PR should include:

- Typed error conversions + tests
- Inventory of converted call sites in the PR description

---

## Issue 024: Implement idempotent whitelist and freeze operations with event suppression rules

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Whitelist add/remove and freeze/unfreeze already have some idempotent behaviors (tests for duplicates/noops).

### Problem

Event emission on no-ops can spam indexers; inconsistent noop vs event policy across admin ops increases noise in `indexer.ts`.

### Goal

Standardize idempotent admin mutation policy: storage unchanged and either no event or a documented suppressed path; add tests.

### Scope

Includes: whitelist/freeze/unfreeze/set_whitelist_enabled edge consistency.
Does NOT include: batch UI.

### Implementation Guidelines

- Files: `whitelist.rs`, `events.rs`, related lib wrappers, tests.

### Acceptance Criteria

- [ ] No-op calls do not duplicate state
- [ ] Event policy documented in code
- [ ] Tests for duplicate add and unfreeze-non-frozen

### Validation

`cargo test` whitelist/freeze tests with event counts.

### PR Expectations

The PR should include:

- Policy + tests

---

---

## Issue 025: Add simulate_pay_per_use dry-run helper mirroring spending limits

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Daily limits live in `spending_limit.rs` with temporary `DailyLimit`/`DailySpent`/`DayStart`. `simulate_charge` exists for recurring charges only.

### Problem

Wallets/UI cannot dry-run pay-per-use against daily limits, pause, and allowance without submitting a failing tx.

### Goal

Add `simulate_pay_per_use(user, amount)` (and optionally recipient variant) returning a structured result enum.

### Scope

Includes: new view entrypoint, tests, enum.
Does NOT include: frontend wiring (separate issue).

### Implementation Guidelines

- Files: `spending_limit.rs`, `lib.rs`, `charge_exec.rs` or new module, tests `test_daily_limit_*`.

### Acceptance Criteria

- [ ] Returns distinct outcomes for limit exceeded, paused, inactive, would succeed
- [ ] No storage writes
- [ ] Tests cover day-window reset boundary

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- New API + tests + brief API blurb

---

---

## Issue 026: Guard extend_trial against inactive, paused, and overflowed trial ends

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`extend_trial` adjusts trial via `trial.rs` affecting `last_charged` semantics described in lifecycle docs.

### Problem

Extending trials on cancelled/paused subscriptions or overflowing timestamps can create chargeable states that violate product rules.

### Goal

Enforce eligibility rules and typed errors; emit an event when trial extends.

### Scope

Includes: validation, event, tests.
Does NOT include: paid trial marketplace features.

### Implementation Guidelines

- Files: `trial.rs`, `lib.rs`, `events.rs`, tests.

### Acceptance Criteria

- [ ] Inactive/paused rejected
- [ ] Overflow typed error
- [ ] Event emitted on success
- [ ] Lifecycle tests updated

### Validation

`cargo test` trial suites.

### PR Expectations

The PR should include:

- Guards + event + tests

---

---

## Issue 027: Add pagination safety tests for get_active_subscriber_page with tombstones

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`get_active_subscriber_page` scans `SubscriberIndex` and filters `sub.active`. Cancel removes index entries via tombstones (`SubscriberIndexRemoved`).

### Problem

Sparse indexes can make offset/limit pages return fewer than limit forever or skip users depending on removal strategy—keepers may undercharge.

### Goal

Define pagination semantics under tombstones and add tests proving keepers can eventually scan all active users.

### Scope

Includes: semantic clarification + possible code fix + tests.
Does NOT include: replacing append-only index architecture.

### Implementation Guidelines

- Files: `lib.rs` get_active_subscriber_page, `subscription_count.rs`, keeper-oriented tests.

### Acceptance Criteria

- [ ] Documented pagination semantics
- [ ] Tests with cancels mid-index
- [ ] No infinite loops; bounded scan per call

### Validation

`cargo test` subscriber index tests.

### PR Expectations

The PR should include:

- Semantics + tests (+ fix if needed)

---

---

## Issue 028: Block charge, batch_charge, and pay_per_use when the subscription merchant is frozen

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`MerchantFrozen` already blocks new subscriptions (`test_subscribe_to_frozen_merchant_panics`). Freeze is independent of whitelist and exposes `get_merchant_freeze_reason`.

### Problem

Existing subscribers can still be charged or call pay-per-use while their merchant is frozen, so freeze does not stop cashflow—undermining the operational intent of an emergency freeze.

### Goal

Fail closed: if `sub.merchant` is frozen, `charge`, `batch_charge` (per-user result or skip), and `pay_per_use` / `pay_per_use_to` must not move funds. Use typed errors / batch result behavior consistently and test freeze reason readability remains intact.

### Scope

Includes: freeze checks on charge, batch_charge, and pay-per-use paths + tests.
Does NOT include: auto-cancelling subscriptions, changing whitelist rules, or legal-policy documentation beyond a short code comment.

### Implementation Guidelines

- Files: `charge_exec.rs`, `batch.rs`, `pay_per_use_inner` in `lib.rs`, `whitelist.rs`, `errors.rs`, freeze tests.
- Prefer a clear `MerchantFrozen` panic for single-user paths; for batch, choose a per-user non-charge outcome that keepers can classify (document the choice).
- Do not transfer tokens on frozen merchants.
- Edge: freeze after subscribe; unfreeze restores chargeability.

### Acceptance Criteria

- [ ] charge and pay_per_use fail closed for frozen merchants without transferring tokens
- [ ] batch_charge does not charge frozen-merchant subscribers and reports a classifiable outcome
- [ ] Unfreeze restores successful charging in tests
- [ ] Short code comment states freeze = stop cashflow policy

### Validation

`cargo test` freeze × charge / batch_charge / pay_per_use interaction tests with balance assertions.

### PR Expectations

The PR should include:

- Fail-closed freeze enforcement + tests
- Keeper-facing note on batch outcome choice

---

## Issue 029: Add upgrade pending TTL refresh and cancellation entrypoint

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`upgrade.rs` propose/commit uses temporary `PendingUpgrade` with TTL extend 17280. `get_pending_upgrade` is view-only.

### Problem

Operators cannot cancel a bad proposal except overwriting; TTL may expire mid-governance causing confusing `NoPendingProposal` at commit.

### Goal

Add `cancel_pending_upgrade` (admin) and ensure propose refreshes TTL; test expire/cancel/commit paths.

### Scope

Includes: cancel API, TTL refresh, tests.
Does NOT include: removing test-only `upgrade` cfg.

### Implementation Guidelines

- Files: `upgrade.rs`, `lib.rs`, events, tests `test_upgrade_*`.

### Acceptance Criteria

- [ ] Cancel clears pending
- [ ] Propose refreshes TTL
- [ ] Commit still requires pending
- [ ] Events for cancel/propose/commit

### Validation

`cargo test` upgrade flows.

### PR Expectations

The PR should include:

- API + tests

---

---

## Issue 030: Record protocol fee accrual events distinct from charged

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`TotalProtocolFees` accumulates in `fee.rs`. `charged` / `pay_per_use` events include fee amounts in some payloads.

### Problem

Indexers building fee-revenue reports (`fee-revenue-report.ts`) must infer fees from heterogeneous events; a dedicated fee accrual event would improve observability.

### Goal

Emit a dedicated `protocol_fee_collected` (name flexible) event whenever fees accrue, without breaking existing charge events.

### Scope

Includes: event + tests; additive only.
Does NOT include: changing fee math.

### Implementation Guidelines

- Files: `events.rs`, `fee.rs`, tests.
- Include collector, bps context optional, amount, user, token.

### Acceptance Criteria

- [ ] Event emitted on fee>0 charge and pay-per-use
- [ ] fee==0 emits no fee event
- [ ] Tests assert payload

### Validation

`cargo test` fee event cases.

### PR Expectations

The PR should include:

- Event + tests + parser note

---

---

## Issue 031: Unify subscription label reads to prefer SubscriptionMeta without a schema version bump

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`Subscription` embeds `label: Symbol` while `subscription_metadata.rs` also stores labels under `SubscriptionMeta`. Getters `get_subscription_label` / `get_metadata` overlap, confusing contributors reading `ARCHITECTURE.md`.

### Problem

Dual write/read paths make it unclear which value wins after `set_metadata` vs subscribe-time labels, without needing a full schema v4 migration in this wave.

### Goal

Make read APIs use a single precedence rule: prefer `SubscriptionMeta` when present, otherwise fall back to `Subscription.label`, preserving existing public getters. Align write helpers so new metadata updates stay consistent with that rule, with tests—**no** `SchemaVersion` bump.

### Scope

Includes: read-layer unification + write consistency for labels + tests.
Does NOT include: schema v4 migration, removing the `label` field from `Subscription`, or adding new metadata fields.

### Implementation Guidelines

- Files: `subscription_metadata.rs`, `lib.rs` getters/setters/`subscribe_with_metadata`, tests.
- Document precedence in a short module comment.
- Ensure `clear_metadata` behavior is explicit under the precedence rule.
- Backwards compatibility: old subscriptions with only struct labels must still return that label.

### Acceptance Criteria

- [ ] get_subscription_label/get_metadata follow documented SubscriptionMeta-first precedence
- [ ] Subscriptions with only struct labels still read correctly
- [ ] set_metadata/clear_metadata behavior matches the documented rule in tests
- [ ] SchemaVersion is unchanged

### Validation

`cargo test` metadata/label suites covering meta-present, meta-absent, and clear paths.

### PR Expectations

The PR should include:

- Read/write unification without migration + tests
- Precedence comment for future contributors

---

## Issue 032: Bound metadata label validation uniformly across set_metadata and subscribe_with_metadata

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`MetadataLabelTooLong` and subscribe_with_metadata tests mention label failure should not leave subscriptions.

### Problem

Validation may differ between paths (Symbol vs String, length, charset), causing inconsistent UX and storage.

### Goal

Centralize label validation in one helper used by all write paths with shared tests.

### Scope

Includes: helper + tests for both entrypoints.
Does NOT include: free-form large text storage.

### Implementation Guidelines

- Files: `subscription_metadata.rs`, `validation.rs`, `lib.rs`.

### Acceptance Criteria

- [ ] Identical rejection rules on both paths
- [ ] Failed subscribe_with_metadata leaves no subscription
- [ ] Tests for max length and empty label policy

### Validation

`cargo test` metadata suites.

### PR Expectations

The PR should include:

- Shared validation + tests

---

---

## Issue 033: Add negative tests for grace period propose/commit temporary TTL expiry

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Grace period uses temporary `PendingGracePeriod` similar to fees (`grace.rs`).

### Problem

Expired pending proposals are poorly tested; operators hitting `NoPendingProposal` lack regression coverage.

### Goal

Add tests that advance ledger TTL/time to expire pending grace proposals and assert commit failure, plus successful propose→commit within TTL.

### Scope

Includes: tests (+ small code fixes if expiry handling buggy).
Does NOT include: changing grace economics.

### Implementation Guidelines

- Use soroban testutils TTL controls.
- Files: `grace.rs`, `test.rs`.

### Acceptance Criteria

- [ ] Expire-then-commit fails typed
- [ ] Happy path still works
- [ ] TTL extend on propose verified

### Validation

`cargo test` grace suites.

### PR Expectations

The PR should include:

- Tests (+fixes)

---

---

## Issue 034: Prevent self-transfer and contract-as-user hazards on transfer_subscription and subscribe

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`validation` already rejects some contract self addresses for recipients (`InvalidRecipient`). Users could still attempt odd address shapes.

### Problem

Transferring a subscription to the contract address or self may create bricked entries or noop confusion.

### Goal

Reject self-transfers and contract-address users/targets with typed errors; test these hazards.

### Scope

Includes: validation on transfer_subscription and subscribe user/merchant where applicable.
Does NOT include: full address denylist service.

### Implementation Guidelines

- Files: `validation.rs`, `lib.rs`, tests.

### Acceptance Criteria

- [ ] Self-transfer rejected
- [ ] Contract address as user/target rejected
- [ ] Typed errors

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- Validation + tests

---

---

## Issue 035: Expose get_next_charge_batch filtering that excludes grace-lapsed subscriptions

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`get_next_charge_batch` helps keepers select due users. Grace-lapsed users should not be repeatedly submitted if they will only return `GracePeriodElapsed`.

### Problem

Keepers waste fees repeatedly batching permanently lapsed users still present in the index.

### Goal

Optionally filter or annotate next-charge batch results to exclude grace-lapsed (or return a side channel), with tests.

### Scope

Includes: query improvement + tests.
Does NOT include: auto-cancel lapsed subs (could be separate).

### Implementation Guidelines

- Files: `lib.rs` get_next_charge_batch, charge_exec compute_next, grace helpers.

### Acceptance Criteria

- [ ] Grace-lapsed users not returned as charge candidates
- [ ] Due users still returned
- [ ] Tests with grace_period > 0

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- Query filter + tests

---

---

## Issue 036: Add contract-side property tests for fee split conservation

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Fee math must satisfy fee + net == gross for all allowed bps/amounts (except intentional rounding toward fee or net—must be explicit).

### Problem

Rounding direction is easy to get wrong when changing `calculate_fee_amount`; merchant revenue and protocol totals can drift.

### Goal

Add property-style unit tests over ranges of amount×bps asserting conservation and non-negative parts.

### Scope

Includes: tests in `test.rs` or fee module tests.
Does NOT include: changing rounding without documenting.

### Implementation Guidelines

- Files: `fee.rs`, tests.
- Include bps 0, 1, 9999, 10000 if allowed.

### Acceptance Criteria

- [ ] Conservation asserted across sampled space
- [ ] Negatives impossible
- [ ] Document rounding rule in fee.rs

### Validation

`cargo test` property suite.

### PR Expectations

The PR should include:

- Property tests + rounding comment

---
---

## Issue 037:  Harden batch_cancel auth and result parity with cancel_inner side effects

---

## Issue 037: Harden batch_cancel auth and result parity with cancel_inner side effects

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`batch_cancel` is admin-only and uses `cancel_inner` + cancelled events. `CancelResult` mirrors charge-style reporting.

### Problem

Side effects (index removal, merchant counts, referral clear) must match single `cancel`; gaps cause analytics drift (`get_merchant_sub_count`).

### Goal

Add differential tests proving batch_cancel == per-user cancel for state, and strengthen caps/`BatchTooLarge` behavior.

### Scope

Includes: tests + fixes if drift found.
Does NOT include: user-modeled mass cancel.

### Implementation Guidelines

- Files: `batch.rs`, `lib.rs`, `subscription_count.rs`, tests.

### Acceptance Criteria

- [ ] State parity tested for active/inactive/missing
- [ ] Events count matches cancels
- [ ] Over-cap panics

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- Parity tests (+fixes)

---

---

## Issue 038: Add read API for day-window spending limit status composite

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

UI and scripts use `get_daily_limit`, `get_daily_spent`, `get_day_start` separately (`docs/DAILY-LIMITS.md`).

### Problem

Multiple RPC round-trips and racey reads across temporary storage keys yield inconsistent dashboards.

### Goal

Add `get_daily_limit_status(user)` returning limit/spent/day_start/remaining in one view call.

### Scope

Includes: composite getter + tests.
Does NOT include: frontend card wiring.

### Implementation Guidelines

- Files: `spending_limit.rs`, `lib.rs`, daily limit tests.

### Acceptance Criteria

- [ ] Single call returns consistent snapshot
- [ ] Absent limit handled
- [ ] Day rollover fields correct

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- API + tests

---

---

## Issue 039: Add a permissionless bump_instance_ttl entrypoint for liveness probes

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Mutating entrypoints call private `bump_instance_ttl` so instance storage (Admin, Token, fees, etc.) stays alive. View-only traffic and simulate-heavy keepers may not refresh instance TTL, as noted in `lib.rs` comments.

### Problem

If the network is read/simulate-heavy, instance TTL can decay even while the deployment looks “active,” risking a bricked contract until a mutator runs.

### Goal

Expose a permissionless `bump_instance_ttl` (name flexible) public entrypoint that only extends instance TTL, with unit tests proving the extend occurs and that no privileged state mutates.

### Scope

Includes: public bump entrypoint + tests + brief API note.
Does NOT include: changing TTL constants, requiring keepers to call unrelated mutators as the only fix, or documenting-only alternatives.

### Implementation Guidelines

- Files: `lib.rs` (next to private `bump_instance_ttl`), tests around `test_initialize_sets_instance_ttl` / subscribe TTL families.
- No auth required; must not write Admin/Token/Fee state.
- Safe to call repeatedly.
- Security: ensure it cannot be used to bypass pause or move funds.

### Acceptance Criteria

- [ ] Public entrypoint extends instance TTL in tests
- [ ] No admin/token/fee/subscription state changes on bump
- [ ] Callable without auth
- [ ] Short docs/API blurb or lib rustdoc describes keeper probe usage

### Validation

`cargo test` TTL bump entrypoint tests; confirm try_ paths cannot transfer tokens via this method.

### PR Expectations

The PR should include:

- Permissionless instance TTL bump + tests
- Rustdoc/API note for operators

---

## Issue 040: Add fuzz/property coverage for subscribe interval floor vs min_interval

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`min_interval.rs` + `IntervalTooShort` / zero interval hardening exist.

### Problem

Contributors can reintroduce zero/short interval exploits without broad generative tests.

### Goal

Add property tests over interval values relative to `get_min_interval` and zero.

### Scope

Includes: generative/property tests.
Does NOT include: changing min interval defaults.

### Implementation Guidelines

- Files: `test.rs`, `validation.rs`, `min_interval.rs`.

### Acceptance Criteria

- [ ] All sampled invalid intervals fail
- [ ] Valid intervals subscribe
- [ ] min_interval updates respected

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- Property tests

---

---

## Issue 041: Synchronize MerchantFeeRecipient clearing when merchants are removed or frozen

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`set_merchant_fee_recipient` stores per-merchant fee routing used in `transfer_subscription_charge`.

### Problem

Removed/frozen merchants may retain fee recipient entries, surprising future re-enablement or directing fees incorrectly if whitelist toggles.

### Goal

Define lifecycle: clear or retain fee recipient on remove/freeze; implement + test + event.

### Scope

Includes: lifecycle hooks + tests.
Does NOT include: UI for fee recipient.

### Implementation Guidelines

- Files: `fee.rs`, `whitelist.rs`, lib wrappers.

### Acceptance Criteria

- [ ] Documented lifecycle implemented
- [ ] Tests for remove/freeze interactions
- [ ] Events when cleared

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- Lifecycle handling + tests

---

---

## Issue 042: Centralize subscribe/charge allowance requirement helper with failing-case unit tests

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`token.rs` and `validation.rs` participate in allowance checks used by subscribe and charge-related flows. `simulate_charge` already reads SAC allowance; fee splits require allowance ≥ gross amount.

### Problem

Allowance requirement logic is scattered, so contributors updating fee splits or subscribe prechecks can miss edge cases (exact allowance, fee>0, zero allowance) without a single tested helper.

### Goal

Extract or formalize a shared allowance-requirement helper used by subscribe validation and charge simulation/precheck paths, with table-driven unit tests for exact/insufficient/zero cases and fee-on vs fee-off gross amounts.

### Scope

Includes: shared helper + integration into existing check sites that already conceptually need it + unit tests.
Does NOT include: MultiEndpoint/RPC work, changing SAC transfer behavior, or batch allowance tolerance (Issue 001) beyond calling the helper if already present.

### Implementation Guidelines

- Files: `token.rs`, `validation.rs`, `charge_exec.rs` / subscribe path as needed, `test.rs`.
- Helper should answer “is allowance sufficient for this gross amount?” without performing transfers.
- Cover fee_bps = 0 and fee_bps > 0 using gross `amount` (not net-only).
- Keep WASM size impact small.

### Acceptance Criteria

- [ ] Shared helper exists and is used by at least subscribe validation and simulate/precheck paths
- [ ] Table-driven tests cover zero, exact, and insufficient allowance
- [ ] Fee-on gross requirement is tested
- [ ] No transfer behavior changes except via shared precondition clarity

### Validation

`cargo test` for helper unit tests and existing subscribe/simulate suites.

### PR Expectations

The PR should include:

- Allowance requirement helper + tests
- Call-site list in PR description

---

## Issue 043: Implement safe clear_subscriber_index_entry admin repair with audit event

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

Prior wave added index cleanup concepts; subscriber index can retain stale slots affecting keepers.

### Problem

Without a carefully authorized repair tool and audit event, operators either ignore corruption or edit storage unsafely.

### Goal

Provide/verify admin repair entrypoint that tombstones/clears a stale index slot after validation, emitting an audit event.

### Scope

Includes: repair API hardening + tests.
Does NOT include: automatic GC of entire index in one call.

### Implementation Guidelines

- Files: `subscription_count.rs`, `lib.rs`, `events.rs`, admin auth.
- Validate target really has no active subscription before clear.

### Acceptance Criteria

- [ ] Admin auth required
- [ ] Refuses to clear active subscribers
- [ ] Event emitted
- [ ] Tests cover success and refuse paths

### Validation

`cargo test`.

### PR Expectations

The PR should include:

- Repair API + tests

---

---

## Issue 044: Harden initialize against double-init and missing admin auth with deploy-facing invariants

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

`initialize(token, admin)` is the deploy entrypoint used by `scripts/deploy-pipeline.ts` / `testnet-setup.ts`. `AlreadyInitialized` and `test_initialize_backward_compat` exist, and admin setup goes through `admin::initialize_admin`.

### Problem

Regressions in arity/auth or partial initialization (token set without admin, or double-init string panics) break deploy scripts and leave ambiguous on-chain state.

### Goal

Enforce and test deploy-facing invariants: admin auth required on initialize, double-initialize returns typed `AlreadyInitialized` (not a string panic), and successful initialize stores both token and admin as expected.

### Scope

Includes: initialize hardening as needed + focused invariant tests tied to deploy expectations.
Does NOT include: rewriting deploy-pipeline.ts or adding multi-admin.

### Implementation Guidelines

- Files: `lib.rs` `initialize`, `admin.rs`, `errors.rs`, `test.rs`.
- Align failure modes with `ContractError` for client/script mapping.
- Edge: second initialize attempt; initialize without admin auth; storage reads via `get_admin`/`get_token`.
- Keep backward-compat coverage for the current `(token, admin)` signature.

### Acceptance Criteria

- [ ] Double initialize returns typed AlreadyInitialized
- [ ] Initialize without admin auth fails
- [ ] Successful initialize persists token and admin
- [ ] Tests are named/documented so deploy script authors can rely on them

### Validation

`cargo test` initialize suites; confirm no string panic on double-init path.

### PR Expectations

The PR should include:

- Initialize invariant hardening + deploy-facing tests
- Note linking scripts that depend on these invariants

---

## Issue 045: Reject resume on grace-lapsed subscriptions with a typed error while allowing cancel

**Category:** Contract
**Complexity:** 200 points
**Labels:** contract, wave-200

### Context

When grace elapses, `charge`/`batch_charge` surface `GracePeriodElapsed`. The subscription may remain `active` while no longer chargeable. Users can still call `resume`, `pause`, and `cancel`; health helpers expose related flags.

### Problem

Allowing `resume` after grace lapse implies recoverability that does not restore chargeability, confusing subscribers and keepers that keep retrying.

### Goal

Enforce one recovery rule: if a subscription is past `last_charged + interval + grace_period` (grace > 0), `resume` rejects with a typed `ContractError`; `cancel` remains allowed so users can exit cleanly. Cover with unit tests.

### Scope

Includes: grace-lapse detection helper reuse, resume rejection, cancel-still-works tests, short comment linking `docs/SUBSCRIBER-LIFECYCLE.md`.
Does NOT include: designing a full reactivate/re-subscribe state machine, auto-cancel on grace lapse, or lifecycle doc rewrites.

### Implementation Guidelines

- Files: `lib.rs` resume/cancel, `charge_exec.rs`/`grace.rs` helpers, `errors.rs`, tests.
- Define lapse using the same next-charge + grace math as charge paths.
- paused + grace-lapsed should still reject resume under this rule (document interaction).
- Do not change charge’s GracePeriodElapsed behavior except for shared helper reuse.

### Acceptance Criteria

- [ ] resume on grace-lapsed subscription returns typed ContractError
- [ ] cancel on grace-lapsed subscription still succeeds
- [ ] Non-lapsed resume behavior unchanged
- [ ] Code comment states the single recovery rule (cancel or re-subscribe outside this issue)

### Validation

`cargo test` grace-lapse × resume/cancel matrix.

### PR Expectations

The PR should include:

- Typed resume rejection + tests
- Explicit non-goals: no new reactivate entrypoint in this PR

---

## Issue 046: Wire WalletSelectModal into App connect flow for multi-wallet UX

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`WalletSelectModal.tsx` and adapters (Freighter, xBull, Lobstr, Hana) exist via `useWallet`, but `App.tsx` still hardcodes `connect(AVAILABLE_WALLETS[0])` and Freighter-only copy.

### Problem

Users with non-Freighter wallets cannot discover supported wallets despite completed adapter work.

### Goal

Integrate modal + WalletBar patterns into the primary connect path with accessible selection and error states.

### Scope

Includes: App/connect UX wiring, tests.
Does NOT include: new wallet adapters.

### Implementation Guidelines

- Files: `App.tsx`, `WalletSelectModal.tsx`, `WalletBar.tsx`, `useWallet.ts`, `App.test.tsx`.
- Preserve passphrase/network checks from `useNetworkCheck`.

### Acceptance Criteria

- [ ] Connect opens wallet selector
- [ ] Each installed adapter selectable in UI tests/mocks
- [ ] Freighter-only copy removed
- [ ] Keyboard/focus trap covered via existing hooks if used

### Validation

`cd frontend && npm test` for App/Wallet tests; manual smoke with mocked adapters.

### PR Expectations

The PR should include:

- UI wiring + tests + screenshot optional

---

---

## Issue 047: Route MerchantDashboard and AdminDashboard through TabBar in the main app shell

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`MerchantDashboard`, `AdminDashboard`, `TabBar`, and related tests exist, but `App.tsx` only toggles subscribe/dashboard locally.

### Problem

Merchants and admins cannot reach built dashboards from the running app entrypoint.

### Goal

Compose a cohesive shell using `TabBar`/`WalletBar` that exposes subscriber, merchant, and admin views with auth-gated admin.

### Scope

Includes: App composition, conditional admin via `useAdmin`, tests.
Does NOT include: visual redesign unrelated to navigation.

### Implementation Guidelines

- Files: `App.tsx`, `TabBar.tsx`, `pages/AdminDashboard.tsx`, `MerchantDashboard.tsx`, `useAdmin.ts`.
- Keep stellar calls inside `stellar.ts`.

### Acceptance Criteria

- [ ] Tabs switch views
- [ ] Admin tab hidden/disabled for non-admin
- [ ] Existing dashboard tests still pass
- [ ] Responsive behavior preserved

### Validation

Vitest App + dashboard tests; `npm run build`.

### PR Expectations

The PR should include:

- Shell wiring + tests

---

---

## Issue 048: Use getServer() consistently for transaction build and simulation paths

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`stellar.ts` documents that tx builds should prefer `getServer()` for custom RPC from `RpcSettings`, but `buildTx` still uses module singleton `server`.

### Problem

Users selecting a custom RPC in UI can still submit against the build-time endpoint, causing confusing failures.

### Goal

Route account fetch, simulate, and submit helpers through `getServer()` (or a single resolver) including batch charge helpers.

### Scope

Includes: `stellar.ts`, `stellarBatchCharge.ts`, tests.
Does NOT include: backend RPC failover.

### Implementation Guidelines

- Files: `stellar.ts`, `services/rpcCache.ts`, `RpcSettings.tsx`, tests `stellar.test.ts`, `RpcSettings.test.tsx`.

### Acceptance Criteria

- [ ] Custom RPC used for build/simulate
- [ ] Fallback to env default works
- [ ] Tests mock getServer

### Validation

`npm test` stellar/RpcSettings.

### PR Expectations

The PR should include:

- Server resolution fix + tests

---

---

## Issue 049: Surface subscription health and simulate_charge before pay/charge actions

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`get_subscription_health` wrapper exists in `stellar.ts`; `SubscriptionHealthWidget` exists. `simulate_charge` is on-contract.

### Problem

Users attempt pay-per-use/cancel/pause without seeing allowance/grace/pause diagnostics already available on-chain.

### Goal

Integrate health widget + optional simulate readout into `SubscriptionCard`/`Dashboard` action flows with actionable ErrorRecovery tips.

### Scope

Includes: wiring + tests.
Does NOT include: new contract methods.

### Implementation Guidelines

- Files: `SubscriptionCard.tsx`, `Dashboard.tsx`, `SubscriptionHealthWidget.tsx`, `ErrorRecovery.tsx`, `stellar.ts`.

### Acceptance Criteria

- [ ] Health visible for active subs
- [ ] Unhealthy states disable or warn on risky actions
- [ ] Tests cover rendering states

### Validation

Vitest card/dashboard tests.

### PR Expectations

The PR should include:

- Integration + tests

---

---

## Issue 050: Add daily spending limit status UX on PayPerUseForm and DailyLimitCard

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

Components `PayPerUseForm`, `DailyLimitCard`, `DailyLimitModal` and docs `DAILY-LIMITS.md` exist alongside contract getters.

### Problem

Spend remaining vs limit is easy to miss; users hit `DailyLimitExceeded` without proactive UX.

### Goal

Show limit/spent/remaining (and reset timing via day_start) in pay-per-use flow with validation before wallet prompt.

### Scope

Includes: UI + stellar read helpers + tests.
Does NOT include: contract composite getter dependency (use existing reads or optional new API).

### Implementation Guidelines

- Files: `PayPerUseForm.tsx`, `DailyLimitCard.tsx`, `stellar.ts`, format utils.

### Acceptance Criteria

- [ ] Remaining displayed
- [ ] Block submit when amount > remaining
- [ ] Loading/empty states handled
- [ ] Tests included

### Validation

Vitest + manual check on testnet if available.

### PR Expectations

The PR should include:

- UX + tests

---

---

## Issue 051: Add mainnet/testnet safety gate before first mutating transaction

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`NetworkBadge`, `useNetworkCheck`, `NETWORK_PASSPHRASE` env exist; mainnet caution is in `SECURITY.md`.

### Problem

A misconfigured `VITE_NETWORK_PASSPHRASE` / RPC pair can point a production build at mainnet without explicit user confirmation.

### Goal

Require explicit confirmation when passphrase is public/mainnet before subscribe/pay/admin mutations; show persistent badge.

### Scope

Includes: gate in tx path + badge visibility in shell.
Does NOT include: blocking all mainnet usage.

### Implementation Guidelines

- Files: `useNetworkCheck.ts`, `NetworkBadge.tsx`, `WalletBar.tsx`, `useTransaction.ts`/`useWallet.ts`, App shell.

### Acceptance Criteria

- [ ] Mainnet confirmation required once per session
- [ ] Testnet unaffected
- [ ] Badge visible
- [ ] Tests for gate

### Validation

Vitest network tests.

### PR Expectations

The PR should include:

- Safety gate + tests

---

---

## Issue 052: Implement transaction lifecycle recovery for interrupted wallet submissions

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`txQueue.ts`, `TxQueuePanel.tsx`, and `useTransaction` track submissions; Freighter can close mid-sign.

### Problem

Interrupted signing leaves users unsure whether to resubmit; duplicate subscribe risk.

### Goal

Detect pending/unknown tx states, offer resume/discard with simulation re-check, and persist queue across refresh via `useLocalStorage`.

### Scope

Includes: queue recovery UX + tests.
Does NOT include: server-side tx indexer.

### Implementation Guidelines

- Files: `services/txQueue.ts`, `TxQueuePanel.tsx`, `useTransaction.ts`, `useWallet.ts`.

### Acceptance Criteria

- [ ] Pending items survive reload
- [ ] User can discard or retry safely
- [ ] UI explains risk of double-submit
- [ ] Tests for persistence

### Validation

Vitest tx queue tests.

### PR Expectations

The PR should include:

- Recovery UX + tests

---

---

## Issue 053: Map all ContractError codes in frontend error utilities with recovery hints

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`utils/errors.ts` and `ErrorRecovery.tsx` exist; contract errors expanded (volume, fee bounds, pause expiry, etc.).

### Problem

Unhandled codes fall through to generic messages, hurting UX for common failures like `GracePeriodElapsed` or `DailyLimitExceeded`.

### Goal

Complete mapping from contract error codes/strings to user-visible guidance aligned with `docs/ERROR-CODES.md`.

### Scope

Includes: mapper + recovery copy + tests.
Does NOT include: rewriting docs entirely.

### Implementation Guidelines

- Files: `utils/errors.ts`, `ErrorRecovery.tsx`, related component tests.

### Acceptance Criteria

- [ ] All current ContractError variants mapped
- [ ] Recovery CTA where actionable
- [ ] Unit tests per code

### Validation

Vitest errors tests.

### PR Expectations

The PR should include:

- Mapper completeness + tests

---

---

## Issue 054: Integrate NextChargeCountdown and trial countdown into SubscriptionCard states

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`NextChargeCountdown.tsx` and prior trial countdown work exist; card tests cover responsiveness.

### Problem

Overdue/trial-active/paused visual states may still be incomplete relative to on-chain `next_charge_at` / `get_trial_end` / pause expiry.

### Goal

Ensure card shows the correct countdown mode for trial, active, overdue, paused-until, and cancelled, with a11y text.

### Scope

Includes: card integration + tests.
Does NOT include: CSS redesign beyond necessary states.

### Implementation Guidelines

- Files: `SubscriptionCard.tsx`, `NextChargeCountdown.tsx`, hooks `useSubscription.ts`, tests.

### Acceptance Criteria

- [ ] Each lifecycle state has distinct UI/SR text
- [ ] Paused-until shows expiry if available
- [ ] Tests for states

### Validation

Vitest SubscriptionCard/NextChargeCountdown.

### PR Expectations

The PR should include:

- State UX + tests

---

---

## Issue 055: Add multi-token token selector and allowance display on SubscribeForm

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

Contract is multi-token; `DEFAULT_TOKEN` / `TOKEN_CONTRACT_ID` env exist; `AllowanceDisplay`/`BalanceDisplay` already used in places.

### Problem

Subscribe form may not let users pick SAC token or verify allowance for the selected token before signing.

### Goal

Token field/selector with balance+allowance for selected token and validation vs `CONTRACT_LIMITS`.

### Scope

Includes: form UX + stellar reads + tests.
Does NOT include: on-chain token registry.

### Implementation Guidelines

- Files: `SubscribeForm.tsx`, `stellar.ts`, `constants.ts`, `AllowanceDisplay.tsx`, `BalanceDisplay.tsx`.

### Acceptance Criteria

- [ ] User can set token address/preset
- [ ] Allowance/balance reflect selection
- [ ] Submit disabled when allowance insufficient
- [ ] Tests included

### Validation

Vitest SubscribeForm tests.

### PR Expectations

The PR should include:

- Multi-token subscribe UX + tests

---

---

## Issue 056: Persist and restore RpcHealthContext failover selection across sessions

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`RpcSettings`, `useRpcHealth`, `RpcHealthContext` support endpoint health; issue #54 historically targeted failover UI.

### Problem

Custom RPC / failover choices may not consistently persist or re-validate on load, causing flaky reads.

### Goal

Harden persistence, health polling backoff, and unsafe endpoint warnings with tests.

### Scope

Includes: context/hooks/UI hardening.
Does NOT include: scripts MultiEndpointServer port.

### Implementation Guidelines

- Files: `context/RpcHealthContext.tsx`, `hooks/useRpcHealth.ts`, `RpcSettings.tsx`, tests.

### Acceptance Criteria

- [ ] Selection persists
- [ ] Unhealthy endpoints flagged
- [ ] Tests for persistence and failure

### Validation

Vitest RpcHealth/RpcSettings.

### PR Expectations

The PR should include:

- Hardening + tests

---

---

## Issue 057: Require ConfirmModal for withdraw, freeze, revenue reset, and batch cancel actions

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`ConfirmModal.tsx` is already used in parts of the admin/merchant UI. High-impact actions include merchant withdraw (`withdraw_merchant_revenue`), admin freeze, revenue reset, and admin `batch_cancel` / batch pause panels under `components/admin/` and `MerchantDashboard.tsx`.

### Problem

These destructive actions can still be one-click in places, creating irreversible on-chain effects from misclicks.

### Goal

Wrap the explicit action set—merchant withdraw, merchant/admin freeze (if exposed), revenue reset, and batch cancel (and batch pause if in the same panels)—with `ConfirmModal`, including consequence copy naming the action.

### Scope

Includes: ConfirmModal wiring for the listed actions + tests.
Does NOT include: inventing new admin contract APIs or confirming every read-only click.

### Implementation Guidelines

- Files: `ConfirmModal.tsx`, `MerchantDashboard.tsx`, `pages/AdminDashboard.tsx`, `components/admin/BatchPausePanel.tsx` / related batch panels, tests.
- Confirm must be required before `onSign`/submit.
- Cancel/dismiss must not submit.
- Keep copy specific (funds move / subscribers paused / revenue zeroed).

### Acceptance Criteria

- [ ] Withdraw, freeze, revenue reset, and batch cancel/pause each require confirmation before submit
- [ ] Dismissing the modal performs no transaction
- [ ] Consequence text identifies the action
- [ ] Component tests cover confirm and cancel paths for each listed action

### Validation

Vitest for merchant/admin panels touched; manual click-through of confirm/cancel once.

### PR Expectations

The PR should include:

- ConfirmModal wiring for the named actions + tests
- Screenshot or short note of confirm copy optional

---

## Issue 058: Expose referral share/track UI with clipboard and validation against self-referral

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`ReferralPanel.tsx`, clipboard hook, and contract self-referral rejection exist.

### Problem

Users may not see referral status or may attempt self-referral only to fail on-chain.

### Goal

Complete referral panel integration on subscribe/dashboard with client-side self-referral checks and copy link UX.

### Scope

Includes: panel wiring + validation + tests.
Does NOT include: off-chain referral rewards ledger.

### Implementation Guidelines

- Files: `ReferralPanel.tsx`, `SubscribeForm.tsx`, `useClipboard.ts`, `addressValidation.ts`.

### Acceptance Criteria

- [ ] Self-referral blocked client-side
- [ ] Copy works
- [ ] On-chain referral displayed when present
- [ ] Tests included

### Validation

Vitest ReferralPanel/SubscribeForm.

### PR Expectations

The PR should include:

- Referral UX + tests

---

---

## Issue 059: Add accessible keyboard shortcut help and ensure ShortcutRegistry covers critical actions

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`ShortcutRegistry`, `useKeyboardShortcuts`, `ShortcutHelpOverlay` exist.

### Problem

Shortcuts may be under-registered for subscribe submit, tab switching, or queue panel, reducing power-user a11y benefits.

### Goal

Register core shortcuts, ensure help overlay lists them, avoid conflicts with input fields.

### Scope

Includes: registry wiring + tests.
Does NOT include: custom user keybind editor.

### Implementation Guidelines

- Files: `context/ShortcutRegistry.tsx`, `ShortcutHelpOverlay.tsx`, App shell, tests `useKeyboardShortcuts.test.*`.

### Acceptance Criteria

- [ ] Help lists shortcuts
- [ ] Inputs do not trigger global shortcuts unexpectedly
- [ ] Tests for ignore-while-typing

### Validation

Vitest shortcut tests.

### PR Expectations

The PR should include:

- Shortcuts + tests

---

---

## Issue 060: Harden OfflineBanner and network status interactions with tx submission

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`OfflineBanner.tsx` and `useNetworkStatus` detect offline.

### Problem

Users can still click mutate actions offline, causing opaque wallet errors.

### Goal

Disable mutating CTAs while offline and announce status via `useAccessibility` live region.

### Scope

Includes: banner + button disabled states + tests.
Does NOT include: offline tx caching beyond existing queue.

### Implementation Guidelines

- Files: `OfflineBanner.tsx`, `useNetworkStatus.ts`, Dashboard/SubscribeForm, App.

### Acceptance Criteria

- [ ] Mutations disabled offline
- [ ] Banner visible
- [ ] SR announcement
- [ ] Tests with mocked offline

### Validation

Vitest.

### PR Expectations

The PR should include:

- Offline UX + tests

---

---

## Issue 061: Add Protocol Stats view using get_protocol_stats and contract_health_check

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

Contract exposes `get_protocol_stats` and `contract_health_check`; `SystemHealthCard` exists.

### Problem

No first-class UI aggregates active_count, fee, grace, pause, schema version for operators.

### Goal

Build a read-only Protocol Stats panel in admin/merchant shell using stellar read helpers.

### Scope

Includes: panel + stellar reads + tests.
Does NOT include: historical charts beyond existing sparkline reuse optional.

### Implementation Guidelines

- Files: new panel component or AdminDashboard section, `stellar.ts`, `SystemHealthCard.tsx`.

### Acceptance Criteria

- [ ] Shows key ProtocolStats fields
- [ ] Handles RPC errors
- [ ] Tests render with mocks

### Validation

Vitest.

### PR Expectations

The PR should include:

- Stats panel + tests

---

---

## Issue 062: Improve MerchantSubscriberTable virtualization performance with useVirtualList

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`MerchantSubscriberTable`, `useVirtualList`, and merchant dashboard tests exist for large subscriber lists.

### Problem

Large merchant lists can still jank if virtualization is incomplete or not wired to sorted/filtered data paths.

### Goal

Ensure filtered/sorted data feeds the virtual list correctly and remains accessible.

### Scope

Includes: table virtualization hardening + tests.
Does NOT include: server-side pagination API.

### Implementation Guidelines

- Files: `MerchantSubscriberTable.tsx`, `useVirtualList.ts`, merchant tests.

### Acceptance Criteria

- [ ] Only visible rows mounted in DOM for large mocks
- [ ] Filter/sort works with virtualization
- [ ] a11y roles preserved

### Validation

Vitest merchant table tests.

### PR Expectations

The PR should include:

- Perf wiring + tests

---

---

## Issue 063: Add pause_until datetime UX with validation for InvalidPauseExpiry

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

Contract supports `pause_until` with `InvalidPauseExpiry`; frontend pause hooks may only do unbounded pause/resume.

### Problem

Users lack UX for bounded pause despite on-chain support.

### Goal

Allow subscribers to set a bounded pause end time, validate future expiry client-side, and show scheduled resume.

### Scope

Includes: pause UI + stellar tx builder + tests.
Does NOT include: admin batch pause_until.

### Implementation Guidelines

- Files: `usePauseResume.ts`, `SubscriptionCard.tsx`, `stellar.ts`, ConfirmModal.

### Acceptance Criteria

- [ ] Future expiry required
- [ ] Builds pause_until tx
- [ ] Shows expiry on card
- [ ] Tests validation

### Validation

Vitest pause tests.

### PR Expectations

The PR should include:

- Bounded pause UX + tests

---

---

## Issue 064: Integrate EventFeed into dashboards with deduped polling

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`EventFeed.tsx`, `useContractEvents.ts`, and `rpcCache`/`dedupedCall` exist.

### Problem

Live event feed may be unused in App dashboards, reducing observability for users.

### Goal

Embed EventFeed in subscriber/merchant dashboards with polling backoff and error quieting.

### Scope

Includes: embedding + hook hardening + tests.
Does NOT include: replacing scripts indexer.

### Implementation Guidelines

- Files: `EventFeed.tsx`, `useContractEvents.ts`, Dashboard/MerchantDashboard.

### Acceptance Criteria

- [ ] Feed renders mocked events
- [ ] Dedup prevents duplicate keys
- [ ] Pause polling when tab hidden if feasible

### Validation

Vitest event feed tests.

### PR Expectations

The PR should include:

- Integration + tests

---

---

## Issue 065: Version SubscriptionExport schema with on-chain health, token, and referral fields

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`SubscriptionExport.tsx` exports CSV/JSON for support workflows. Contract reads already expose token (`get_subscription_token`), referral (`get_referral`/`get_referrer`), and health (`get_subscription_health`).

### Problem

Exports that omit newer fields—or add columns without schema versioning—break downstream support tooling and cannot be validated against live RPC reads.

### Goal

Extend export rows with token, referral, and key health flags; introduce an export schema version field; and add tests that assert headers/fields and that exported values match mocked on-chain reads.

### Scope

Includes: export field expansion, schema versioning, validation tests against mocked stellar reads.
Does NOT include: Excel binary formats or server-side report generation.

### Implementation Guidelines

- Files: `SubscriptionExport.tsx`, `stellar.ts` read helpers, `types.ts`, export tests.
- Stable headers documented in component.
- Schema version increments when columns change.
- Include enough health flags to be useful (e.g. active, paused, charge_due, has_sufficient_allowance) without dumping unrelated UI state.

### Acceptance Criteria

- [ ] CSV/JSON include token, referral, and selected health fields
- [ ] Export payload includes a schema version
- [ ] Tests assert stable headers and values from mocked contract reads
- [ ] Missing optional fields serialize deterministically (empty/null policy documented)

### Validation

Vitest for SubscriptionExport with mocked stellar health/token/referral responses.

### PR Expectations

The PR should include:

- Versioned export schema + tests
- Header/field policy documented in component

---

## Issue 066: Gate mutating flows on valid CONTRACT_ID and matching wallet network

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`useContractId`, `NetworkBadge`/`useNetworkCheck`, and `stellar.ts` env (`VITE_CONTRACT_ID`, `VITE_NETWORK_PASSPHRASE`) configure the app. Empty contract IDs currently produce cryptic SDK failures.

### Problem

Users can also pass wallet network mismatch checks while still attempting mutations, compounding empty-config failures with wrong-network submissions.

### Goal

Block mutating builders/CTAs unless `VITE_CONTRACT_ID` is present and well-formed **and** the wallet network matches the configured passphrase; show a single actionable empty/mismatch state.

### Scope

Includes: combined config+network gate in App/shell and stellar guards, tests for missing ID and network mismatch.
Does NOT include: deploy automation or mainnet confirmation UX beyond network matching (see separate mainnet safety issue).

### Implementation Guidelines

- Files: `useContractId.ts`, `useNetworkCheck.ts`, App/`WalletBar`, `stellar.ts` guards, `.env.example` comments, tests.
- Validate C-prefixed contract ID shape at a practical level.
- Disable subscribe/pay/admin mutate CTAs when gated.
- Announce via existing accessibility live region if available.

### Acceptance Criteria

- [ ] Missing/invalid CONTRACT_ID shows actionable empty state and blocks mutations
- [ ] Wallet network mismatch blocks mutations with a clear message
- [ ] Valid config + matching network allows mutations
- [ ] Tests cover missing ID and mismatch cases

### Validation

Vitest for useContractId/useNetworkCheck/App gate behavior.

### PR Expectations

The PR should include:

- Combined config/network gate + tests
- .env.example clarification

---

## Issue 067: Add Stroop/XLM dual display consistency via useAmountDisplay across forms

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`useAmountDisplay`, `AmountUnitToggle`, `StroopInput` exist from prior waves.

### Problem

Some forms may still mix raw stroops and XLM without toggle consistency, causing 10^7 mistakes.

### Goal

Standardize amount entry/display across Subscribe, PayPerUse, DailyLimit, and admin amount edits.

### Scope

Includes: form audits + wiring + tests.
Does NOT include: fiat FX.

### Implementation Guidelines

- Files: amount components/hooks, forms listed, `format.ts`.

### Acceptance Criteria

- [ ] Toggle shared preference persists
- [ ] Displayed unit consistent
- [ ] Tests for conversion

### Validation

Vitest amount tests.

### PR Expectations

The PR should include:

- Consistency + tests

---

---

## Issue 068: Expand frontend Vitest coverage for stellar.ts builders of newer contract APIs

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

Many components are tested, but `stellar.ts` builders for newer admin/batch/health APIs may lack direct unit tests.

### Problem

Broken ScVal encoding ships until manual testnet use.

### Goal

Add unit tests mocking RPC/assembleTransaction for critical builders (pause_until, batch pause, health, stats, pay_per_use_to if exposed).

### Scope

Includes: stellar unit tests.
Does NOT include: full e2e browser suite.

### Implementation Guidelines

- Files: `stellar.ts`, `__tests__/stellar.test.ts`, `services/scval.ts`.

### Acceptance Criteria

- [ ] Builders under test assert method names/args
- [ ] Failure sim paths tested
- [ ] CI frontend workflow remains green

### Validation

`npm test` in frontend; note workflow currently may not run tests—call out adding test step if missing.

### PR Expectations

The PR should include:

- stellar.ts tests
- Optional CI test step if needed for validation

---

---

## Issue 069: Integrate NotificationCenter with toast and contract pause banner priorities

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`NotificationCenter`, `Toast`, `ContractPauseBanner`, `useContractPaused` exist.

### Problem

Overlapping notifications can stack confusingly during pause or tx errors.

### Goal

Define priority/queue rules so pause state, offline, and tx toasts do not conflict; implement and test.

### Scope

Includes: notification orchestration + tests.
Does NOT include: email/push.

### Implementation Guidelines

- Files: `NotificationCenter.tsx`, `Toast.tsx`, `ContractPauseBanner.tsx`, App providers.

### Acceptance Criteria

- [ ] Pause banner takes precedence visually
- [ ] Toasts do not hide critical banners
- [ ] Tests for priority

### Validation

Vitest notification tests.

### PR Expectations

The PR should include:

- Orchestration + tests

---

---

## Issue 070: Add merchant withdraw revenue flow with fee/net transparency

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

Contract `withdraw_merchant_revenue` and merchant dashboard analytics components exist.

### Problem

Merchants may lack a clear withdraw CTA showing withdrawable revenue and confirmation.

### Goal

Implement withdraw UI with read of `get_merchant_revenue`, confirm modal, and success feedback via events/toast.

### Scope

Includes: UI + stellar builder + tests.
Does NOT include: fiat off-ramp.

### Implementation Guidelines

- Files: `MerchantDashboard.tsx`, `stellar.ts`, `ConfirmModal.tsx`, revenue components.

### Acceptance Criteria

- [ ] Shows withdrawable amount
- [ ] Confirm before submit
- [ ] Handles ZeroBalanceAvailable
- [ ] Tests included

### Validation

Vitest merchant tests.

### PR Expectations

The PR should include:

- Withdraw flow + tests

---

---

## Issue 071: Add transfer_subscription guided UI with address book and danger checklist

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`transfer_subscription` is on-contract; `AddressBook` helps pick addresses.

### Problem

Ownership transfer is high risk and likely missing a guided UI with checklist (target empty, auth, irreversible).

### Goal

Provide a guided transfer flow with validation, confirm modal, and post-transfer refresh.

### Scope

Includes: UI flow + tests.
Does NOT include: custody migration services.

### Implementation Guidelines

- Files: Dashboard/SubscriptionCard, AddressBook, stellar builder, ConfirmModal.

### Acceptance Criteria

- [ ] Validates target address
- [ ] Warns about irreversibility
- [ ] Success refreshes subscription state
- [ ] Tests included

### Validation

Vitest.

### PR Expectations

The PR should include:

- Transfer UX + tests

---

---

## Issue 072: Ensure ThemeToggle and CSS variables remain accessible for contrast-sensitive views

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`useTheme`, `ThemeToggle`, and `index.css` theming exist; root script `audit:contrast` currently aliases typecheck only.

### Problem

Critical status colors (overdue, paused, errors) may fail contrast in one theme.

### Goal

Audit status color tokens for light/dark, fix variables, and add a lightweight contrast check test or script meaningful beyond typecheck.

### Scope

Includes: CSS variable fixes + tests/script.
Does NOT include: full design system rewrite.

### Implementation Guidelines

- Files: `index.css`, `ThemeToggle.tsx`, status components, optionally package script.

### Acceptance Criteria

- [ ] Status colors meet agreed contrast target
- [ ] Toggle persists
- [ ] Test/script fails on regressions

### Validation

Run new contrast check + Vitest theme tests.

### PR Expectations

The PR should include:

- Token fixes + check

---

---

## Issue 073: Add pay_per_use_to recipient flow with whitelist validation messaging

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

Contract supports `pay_per_use_to` with recipient whitelist checks; frontend primarily wraps `pay_per_use`.

### Problem

Users cannot route one-shot payments to an alternate recipient when merchants support it.

### Goal

Optional recipient field with validation and clear MerchantNotWhitelisted errors.

### Scope

Includes: form + stellar builder + tests.
Does NOT include: recipient marketplace.

### Implementation Guidelines

- Files: `PayPerUseForm.tsx`, `stellar.ts`, errors mapper.

### Acceptance Criteria

- [ ] Recipient optional
- [ ] Builds pay_per_use_to when set
- [ ] Client validation for address
- [ ] Tests included

### Validation

Vitest.

### PR Expectations

The PR should include:

- Recipient flow + tests

---

---

## Issue 074: Reconcile AddressBook usage across SubscribeForm and admin address list inputs

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

`AddressBook.tsx` and `admin/AddressListInput.tsx` both manage addresses.

### Problem

Inconsistent validation/storage keys lead to duplicate UX bugs and missed invalid address catches.

### Goal

Share validation helpers and persistence conventions; integrate AddressBook where merchants are entered.

### Scope

Includes: refactor reuse + tests.
Does NOT include: cloud sync of address books.

### Implementation Guidelines

- Files: `AddressBook.tsx`, `AddressListInput.tsx`, `addressValidation.ts`, SubscribeForm.

### Acceptance Criteria

- [ ] Shared validators used
- [ ] Persistence key documented
- [ ] Tests for add/remove/invalid

### Validation

Vitest AddressBook/AddressListInput.

### PR Expectations

The PR should include:

- Shared address UX + tests

---

---

## Issue 075: Add loading skeletons and race-safe empty/error states to admin batch panels

**Category:** Frontend
**Complexity:** 200 points
**Labels:** frontend, wave-200

### Context

Admin batch panels (`BatchPausePanel`, `BatchWhitelistPanel`, repair panels) and `Skeleton.tsx` exist under `components/admin/`. RPC latency varies; rapid address edits can complete out of order.

### Problem

Panels flash empty UI during loads and can show stale empty/error states when an older request finishes after a newer one.

### Goal

Apply Skeleton loading to BatchPause, BatchWhitelist, and Repair panels; distinguish loading vs empty vs error; and ignore stale responses (request sequence/AbortController or equivalent) so late RPC results cannot overwrite newer UI state.

### Scope

Includes: skeleton UX + empty/error differentiation + in-flight race handling + tests.
Does NOT include: rewriting batch transaction logic or adding new admin APIs.

### Implementation Guidelines

- Files: `components/admin/*`, `Skeleton.tsx`, `AdminDashboard` tests.
- Prefer aborting or sequencing fetches per panel.
- Error state must be actionable (retry if already patterned).
- Keep a11y: busy/disabled semantics while loading.

### Acceptance Criteria

- [ ] Skeleton shown while loading for the three panel types
- [ ] Empty and error states are visually and semantically distinct from loading
- [ ] Stale responses cannot clobber newer results in tests
- [ ] Tests cover loading, empty, error, and race scenarios

### Validation

Vitest admin panel tests with mocked delayed/out-of-order RPC resolutions.

### PR Expectations

The PR should include:

- Skeleton + race-safe state handling + tests
- Short note on the sequencing approach chosen

---

## Issue 076: Align keeper PAGE_SIZE with contract max batch size and config schema

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`scripts/keeper.ts` defaults PAGE_SIZE up to 100; contract `MAX_BATCH_SIZE` default is 50 (`batch.rs`). `config.ts` allows BATCH_SIZE up to 200. Docs disagree (KEEPER.md still mentions Python in places).

### Problem

Keepers configured above on-chain max will panic every page with `BatchTooLarge`, stalling billing.

### Goal

Unify env schema and keeper clamping to on-chain `get_max_batch_size` (with safe fallback), and fix package.json script duplicates if blocking runs.

### Scope

Includes: keeper.ts, config.ts, validate-config.ts, scripts/package.json repair if needed.
Does NOT include: contract limit redesign.

### Implementation Guidelines

- On startup, read `get_max_batch_size` via RPC when possible.
- Clamp PAGE_SIZE/BATCH_SIZE.
- Fix `scripts/package.json` JSON syntax issues (duplicate keys/missing commas) as part of making scripts runnable.

### Acceptance Criteria

- [ ] Default clamp ≤ on-chain max
- [ ] Config schema max matches reality
- [ ] Startup logs effective page size
- [ ] package.json valid JSON

### Validation

`npm run typecheck` in scripts; dry-run keeper with BATCH_SIZE=100 expecting clamp; `node -e JSON.parse` package.json.

### PR Expectations

The PR should include:

- Keeper/config alignment
- package.json fix if required
- Notes in scripts README

---

---

## Issue 077: Integrate MultiEndpointServer failover into keeper and indexer RPC paths

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`rpc-client.ts` implements `MultiEndpointServer` with passphrase validation and health-based sorting. Keeper/indexer still often construct a single `Server`.

### Problem

Single RPC outages halt charging and indexing even when `RPC_URLS` is set.

### Goal

Route keeper, indexer, and critical scripts through MultiEndpointServer with shared config.

### Scope

Includes: wiring + tests/mocks + env example updates.
Does NOT include: frontend Vite failover.

### Implementation Guidelines

- Files: `rpc-client.ts`, `keeper.ts`, `indexer.ts`, `watch-events.ts`, `.env.example`.

### Acceptance Criteria

- [ ] RPC_URLS failover exercised in unit/integration tests
- [ ] Passphrase mismatch marks endpoint unhealthy
- [ ] Single RPC_URL still works

### Validation

Script tests or minimal node test harness; manual failover simulation.

### PR Expectations

The PR should include:

- Failover wiring + tests
- env example

---

---

## Issue 078: Wire EventDedupCache into indexer and watch-events pipelines

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`event-dedup.ts` provides LRU dedup; indexer upserts SQLite by tx_hash+event_name; watch-events may reprocess overlaps.

### Problem

Dedup module is not consistently applied, risking duplicate side effects in alert hooks.

### Goal

Use EventDedupCache in memory plus DB constraints for a layered dedup strategy; expose stats in logs/metrics.

### Scope

Includes: indexer/watch-events integration + tests.
Does NOT include: distributed Redis unless justified.

### Implementation Guidelines

- Files: `event-dedup.ts`, `indexer.ts`, `watch-events.ts`, `metrics-server.ts` optional counters.

### Acceptance Criteria

- [ ] Duplicates skipped with metrics
- [ ] Restart safety still via SQLite meta ledger
- [ ] Tests for cache+db

### Validation

Unit tests for dedup; indexer dry run with repeated events.

### PR Expectations

The PR should include:

- Integration + tests

---

---

## Issue 079: Expand indexer SQLite schema for fee, merchant, and skip-related event fields

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

Indexer schema version 1 stores generic address/amount/raw_data. New contract events (fees, batch skips) need queryability for `fee-revenue-report.ts` and alerts.

### Problem

Reports re-parse raw JSON inefficiently and miss fields.

### Goal

Migrate to schema v2 with typed columns (merchant, fee_amount, token, result_code) and migration on startup.

### Scope

Includes: schema migration, writers, query-events updates.
Does NOT include: Postgres migration.

### Implementation Guidelines

- Files: `indexer.ts`, `query-events.ts`, `SCHEMA_VERSION` handling.

### Acceptance Criteria

- [ ] Startup migrates v1→v2 safely
- [ ] New columns populated when present
- [ ] Old rows remain readable

### Validation

Run indexer against fixture events; query-events returns new fields.

### PR Expectations

The PR should include:

- Schema v2 + migration + sample queries

---

---

## Issue 080: Harden keeper DLQ writing and replay-dlq idempotency

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`replay-dlq.ts` replays `dlq/failed-batches.jsonl`. Keeper should write DLQ entries on exhausted retries.

### Problem

Partial failures, duplicate DLQ lines, or concurrent replay can double-charge if not idempotent with on-chain interval checks.

### Goal

Ensure DLQ records include batch fingerprint, ledger/timing, and replay skips already-charged users via simulate/estimate precheck.

### Scope

Includes: keeper DLQ emit + replay-dlq precheck + tests.
Does NOT include: external queue service.

### Implementation Guidelines

- Files: `keeper.ts`, `replay-dlq.ts`, `batch-optimizer.ts`.

### Acceptance Criteria

- [ ] Failed pages land in DLQ with enough context
- [ ] Replay dry-run safe
- [ ] Replay prechecks skip not-due users
- [ ] Tests for fingerprinting

### Validation

Unit tests with temp DLQ files; dry-run replay.

### PR Expectations

The PR should include:

- DLQ hardening + tests

---

---

## Issue 081: Make batch-optimizer grace urgency ordering the default keeper path

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`batch-optimizer.ts` builds optimized batches by grace urgency; keeper header comments mention it but code paths may diverge.

### Problem

Unordered paging charges non-urgent users first, increasing grace lapses.

### Goal

Default keeper cycle uses `buildOptimizedBatches` with feature flag to disable, plus metrics on lapsed-vs-charged.

### Scope

Includes: keeper integration + benchmarks notes.
Does NOT include: new contract APIs.

### Implementation Guidelines

- Files: `keeper.ts`, `batch-optimizer.ts`, `keeper-benchmark.ts`.

### Acceptance Criteria

- [ ] Default path optimized
- [ ] Flag to use legacy paging
- [ ] Logs show ordering rationale at debug

### Validation

Dry-run with fixture subscribers; benchmark script optional.

### PR Expectations

The PR should include:

- Integration + flag + docs in scripts README

---

---

## Issue 082: Add Prometheus metrics for keeper charge outcomes and RPC errors

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`metrics-server.ts` and `grafana-dashboard.json` exist for operational monitoring.

### Problem

Charge result histograms and RPC failover counters may be incomplete, limiting production readiness.

### Goal

Emit counters/histograms for Charged/Skipped/Paused/Grace/Allowance/RPC failures and expose `/metrics`.

### Scope

Includes: metrics instrumentation + dashboard panel updates.
Does NOT include: hosted Grafana deployment.

### Implementation Guidelines

- Files: `metrics-server.ts`, `keeper.ts`, `grafana-dashboard.json`, `rpc-client.ts`.

### Acceptance Criteria

- [ ] Metrics endpoint lists new series
- [ ] Dashboard JSON references them
- [ ] Low cardinality labels only

### Validation

Run metrics-server + hit /metrics during a dry keeper cycle.

### PR Expectations

The PR should include:

- Metrics + dashboard update

---

---

## Issue 083: Migrate keeper, indexer, health-check, and alert-failed-charges to shared structured logger

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`logger.ts` provides leveled JSON logging. Core ops entrypoints `keeper.ts`, `indexer.ts`, `health-check.ts`, and `alert-failed-charges.ts` still mix ad hoc `console.log` patterns in places.

### Problem

Inconsistent logs from these primary services break aggregation in Docker and make incident response harder than a full-fleet logger sweep would justify in one PR.

### Goal

Migrate those four scripts to the shared logger with required fields (`script`, `contract`, `rpc` where applicable) and respect `LOG_LEVEL`.

### Scope

Includes: logger adoption for keeper, indexer, health-check, alert-failed-charges only + README example line.
Does NOT include: migrating every analytics/one-off script, or shipping ELK.

### Implementation Guidelines

- Files: `logger.ts`, `keeper.ts`, `indexer.ts`, `health-check.ts`, `alert-failed-charges.ts`, `scripts/README.md` snippet.
- Allow `console.error` only for fatal bootstrap before logger init.
- Preserve existing meaning of log levels.
- Avoid logging secrets (cross-check with keeper redaction practices).

### Acceptance Criteria

- [ ] The four named scripts use shared logger for non-fatal logs
- [ ] LOG_LEVEL is respected
- [ ] Required fields appear on representative log lines
- [ ] README shows one example JSON log line from keeper or indexer

### Validation

Run each script briefly with LOG_LEVEL=debug (dry-run where available) and confirm JSON logs; `rg console.log` limited to those four files shows no remaining ad hoc info logs.

### PR Expectations

The PR should include:

- Logger migration for the fixed four scripts
- README example

---

## Issue 084: Extend health-check.ts to verify batch estimate and instance liveness probes

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`health-check.ts` probes contract responsiveness; contract also exposes `contract_health_check` and batch estimate.

### Problem

Shallow ping may pass while charge path is broken (paused, schema drift, RPC decode errors).

### Goal

Deep health mode: call `contract_health_check`, sample `get_batch_charge_estimate` on empty/max list, and exit non-zero on failed invariants.

### Scope

Includes: health-check enhancements + docs in scripts README.
Does NOT include: Kubernetes operator.

### Implementation Guidelines

- Files: `health-check.ts`, config env flags.

### Acceptance Criteria

- [ ] --deep flag or env enables deep checks
- [ ] Non-zero exit on paused/unhealthy
- [ ] JSON output option

### Validation

Run against mocked server or testnet as available.

### PR Expectations

The PR should include:

- Deep health checks

---

---

## Issue 085: Add indexer catch-up backfill tool with ledger range checkpoints

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

Indexer resumes from meta last_ledger; `replay-events.ts` exists for audit.

### Problem

Gaps after prolonged downtime need controlled backfill without duplicating or skipping ledgers.

### Goal

Implement/harden backfill mode with start/end ledger, checkpointing, and rate limits compatible with RPC.

### Scope

Includes: replay/backfill script UX + tests.
Does NOT include: archive node operations.

### Implementation Guidelines

- Files: `replay-events.ts`, `indexer.ts` shared fetch helpers, `query-events.ts`.

### Acceptance Criteria

- [ ] Checkpoint progressive
- [ ] Idempotent upserts
- [ ] Rate limit configurable

### Validation

Backfill a small ledger range twice; row counts stable.

### PR Expectations

The PR should include:

- Backfill mode + tests

---

---

## Issue 086: Secure keeper secret handling and refuse mainnet without explicit opt-in

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

Keeper requires `KEEPER_SECRET`. Mainnet risk is documented in SECURITY.md.

### Problem

Mis-set NETWORK_PASSPHRASE can spend real funds; secrets may appear in logs.

### Goal

Redact secrets in logs, require `ALLOW_MAINNET=true` when passphrase is public, and validate key matches `KEEPER_PUBLIC_KEY` if provided.

### Scope

Includes: keeper/config safety gates.
Does NOT include: HSM integration.

### Implementation Guidelines

- Files: `keeper.ts`, `config.ts`, `.env.example`.

### Acceptance Criteria

- [ ] Mainnet blocked without opt-in
- [ ] Secrets never logged
- [ ] Public/secret mismatch fails fast

### Validation

Unit tests for config gates.

### PR Expectations

The PR should include:

- Safety gates + tests

---

---

## Issue 087: Repair scripts package.json and add CI typecheck plus config-validation smoke

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

Root CI runs `rust.yml` and `frontend.yml`. `scripts/package.json` has suffered duplicate keys / invalid JSON fragments, and scripts lack CI. `validate-config.ts` can smoke-check env schemas.

### Problem

Broken package metadata and missing CI let TypeScript and config regressions reach operators only at runtime.

### Goal

Repair `scripts/package.json` into valid JSON with a coherent scripts map; add `.github/workflows/scripts.yml` that runs `npm ci`, `npm run typecheck`, and a minimal `validate-config` smoke (with intentionally invalid env asserting non-zero exit).

### Scope

Includes: package.json repair, tsconfig include sanity, scripts CI workflow with typecheck + validate-config smoke.
Does NOT include: full runtime e2e against public RPC in CI.

### Implementation Guidelines

- Files: `scripts/package.json`, `scripts/tsconfig.json`, `validate-config.ts`, `.github/workflows/scripts.yml`.
- Keep Node version aligned with frontend CI (20).
- Smoke step should not need network secrets—use bad env to assert validation failure, and/or a fixtures path if present.
- Ensure npm script names match README.

### Acceptance Criteria

- [ ] scripts/package.json parses as valid JSON and exposes documented npm scripts
- [ ] CI workflow runs typecheck on scripts
- [ ] CI (or documented local twin) runs validate-config smoke expecting failure on bad env and success on minimal good fixture/env
- [ ] tsconfig includes the scripts needed for typecheck

### Validation

`node -e JSON.parse...`; local `npm run typecheck`; run validate-config smoke; confirm workflow YAML is present and references those steps.

### PR Expectations

The PR should include:

- package.json fix + scripts CI workflow with typecheck and config smoke
- Brief CI section note in scripts README

---

## Issue 088: Implement alert-failed-charges classification using ChargeResult and DLQ

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`alert-failed-charges.ts` should notify on failures; batch results and DLQ encode richer reasons.

### Problem

Alerts may treat all failures equally or miss allowance vs grace distinctions.

### Goal

Classify alerts by reason, rate-limit repeats per subscriber, and support webhook via config `WEBHOOK_URL`.

### Scope

Includes: alert script + config + tests.
Does NOT include: PagerDuty-specific proprietary APIs beyond webhook.

### Implementation Guidelines

- Files: `alert-failed-charges.ts`, `config.ts`, keeper integration optional.

### Acceptance Criteria

- [ ] Per-reason grouping
- [ ] Dedup window
- [ ] Webhook payload documented
- [ ] Tests with fixtures

### Validation

Run against fixture result sets.

### PR Expectations

The PR should include:

- Alert classification + tests

---

---

## Issue 089: Enhance grace-period-monitor to prioritize keeper scheduling inputs

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`grace-period-monitor.ts` identifies subscribers in grace windows.

### Problem

Monitor output may not feed keeper optimizer automatically, leaving data unused.

### Goal

Emit machine-readable urgency scores consumed by batch-optimizer/keeper, with CLI human summary.

### Scope

Includes: monitor output schema + optimizer consumer.
Does NOT include: on-chain grace changes.

### Implementation Guidelines

- Files: `grace-period-monitor.ts`, `batch-optimizer.ts`.

### Acceptance Criteria

- [ ] JSON schema stable
- [ ] Optimizer reads monitor file/stdin
- [ ] Human summary remains

### Validation

Fixture pipeline monitor→optimizer.

### PR Expectations

The PR should include:

- Pipeline wiring + schema docs

---

---

## Issue 090: Add subscription-snapshot and snapshot-diff integrity checks for upgrades

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`subscription-snapshot.ts`, `snapshot-diff.ts`, `pre-upgrade-check.ts` support upgrades.

### Problem

Upgrade runbooks need stronger automated assertions (active_count drift, schema_version, fee config).

### Goal

Extend pre-upgrade-check to require snapshot/diff thresholds and fail CI-like exit codes on drift.

### Scope

Includes: script enhancements + README ops section.
Does NOT include: contract migrate itself.

### Implementation Guidelines

- Files: `pre-upgrade-check.ts`, `subscription-snapshot.ts`, `snapshot-diff.ts`, `migrate-contract.ts` coordination notes.

### Acceptance Criteria

- [ ] Fails on active_count mismatch beyond tolerance
- [ ] Checks schema_version
- [ ] Writes report artifact

### Validation

Run on fixture snapshots.

### PR Expectations

The PR should include:

- Upgrade checks + sample report

---

---

## Issue 091: Add churn-analysis deterministic tests and golden fixtures

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`churn-analysis.ts` and `test-churn-analysis.ts` exist for subscriber churn analytics.

### Problem

Analytics scripts can regress silently without golden fixtures in `scripts/data`.

### Goal

Expand deterministic tests with checked-in fixtures and stabilize metric definitions (logos, grace lapses, cancels).

### Scope

Includes: fixtures + tests.
Does NOT include: ML forecasting (see renewal-forecast separately).

### Implementation Guidelines

- Files: `churn-analysis.ts`, `test-churn-analysis.ts`, `data/` fixtures.

### Acceptance Criteria

- [ ] Tests cover core metrics
- [ ] Fixtures documented
- [ ] Non-zero exit on assertion failure

### Validation

`npx tsx test-churn-analysis.ts` or npm test script.

### PR Expectations

The PR should include:

- Fixtures + tests

---

---

## Issue 092: Harden renewal-forecast against sparse charge history

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`renewal-forecast.ts` forecasts renewals using charge history / snapshots.

### Problem

Sparse history and paused users can produce NaN/Inf or overconfident forecasts.

### Goal

Add input validation, confidence bands, and explicit insufficient-data outcomes.

### Scope

Includes: forecast script + tests.
Does NOT include: contract changes.

### Implementation Guidelines

- Files: `renewal-forecast.ts`, fixtures.

### Acceptance Criteria

- [ ] No NaN in output
- [ ] Insufficient-data flagged
- [ ] Tests for sparse/paused

### Validation

Fixture runs.

### PR Expectations

The PR should include:

- Forecast hardening + tests

---

---

## Issue 093: Implement merchant-analytics SQLite rollups from indexer events

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`merchant-analytics.ts` and indexer DB coexist; merchant reports also in `export-merchant-report.ts`.

### Problem

Analytics may hit RPC repeatedly instead of using indexed events, scaling poorly.

### Goal

Prefer indexer DB as source with RPC fallback, documenting required indexer freshness.

### Scope

Includes: analytics path + query helpers.
Does NOT include: BI tool embedding.

### Implementation Guidelines

- Files: `merchant-analytics.ts`, `indexer.ts` schema, `export-merchant-report.ts` shared queries.

### Acceptance Criteria

- [ ] DB path works offline with sample DB
- [ ] Fallback RPC optional
- [ ] Freshness warning if last_ledger stale

### Validation

Sample DB fixture test.

### PR Expectations

The PR should include:

- DB-backed analytics + fixture

---

---

## Issue 094: Add docker-compose services for indexer and metrics alongside keeper

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`docker-compose.yml` and Dockerfile focus on keeper.

### Problem

Operators lack one-command bring-up for indexer+metrics+keeper despite scripts existing.

### Goal

Extend compose with indexer and metrics services, shared volume for SQLite, healthchecks, and env documentation.

### Scope

Includes: compose/Dockerfile(s) + README.
Does NOT include: Kubernetes charts.

### Implementation Guidelines

- Files: `docker-compose.yml`, `Dockerfile`, `scripts/README.md`, `.env.example`.

### Acceptance Criteria

- [ ] compose up starts keeper+indexer+metrics
- [ ] Volumes persist events.db
- [ ] Healthchecks defined

### Validation

`docker compose config` validation; build if environment allows.

### PR Expectations

The PR should include:

- Compose expansion + docs

---

---

## Issue 095: Add validate-config strict mode for all script entrypoints

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`validate-config.ts` + zod `config.ts` validate keeper env; many scripts parse env ad hoc.

### Problem

Invalid CONTRACT_ID/RPC_URL fail late inside SDK calls.

### Goal

Shared bootstrap `loadConfig()` used by keeper, indexer, alerts, with strict mode CLI.

### Scope

Includes: config module expansion + script adoption for top 8 scripts.
Does NOT include: rewriting every rarely used script.

### Implementation Guidelines

- Files: `config.ts`, `validate-config.ts`, keeper/indexer/alert/health scripts.

### Acceptance Criteria

- [ ] Strict validation errors are human-readable
- [ ] Common scripts import shared loader
- [ ] Tests for zod failures

### Validation

Invoke validate-config with bad env.

### PR Expectations

The PR should include:

- Shared config bootstrap + tests

---

---

## Issue 096: Implement audit-trail export reconciliation against indexer

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`audit-trail.ts` and `docs/COMPLIANCE.md` describe finance-oriented trails.

### Problem

Exports can diverge from indexer DB without reconciliation step, undermining compliance use.

### Goal

Add reconciliation mode comparing audit export aggregates to indexer sums for charged/fees.

### Scope

Includes: audit-trail features + tests.
Does NOT include: legal sign-off.

### Implementation Guidelines

- Files: `audit-trail.ts`, indexer DB access, COMPLIANCE cross-links optional.

### Acceptance Criteria

- [ ] Mismatch exits non-zero
- [ ] Report shows per-day diffs
- [ ] Tests with fixtures

### Validation

Fixture reconciliation.

### PR Expectations

The PR should include:

- Reconciliation mode + tests

---

---

## Issue 097: Add bounded concurrency and retries to allowance audit scripts with JSON output

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`check-allowances.ts` and `alert-expiring-allowances.ts` walk subscriber allowances over RPC. RPC failover belongs to `MultiEndpointServer` / Issue 077 wiring—not this issue.

### Problem

Serial allowance checks are slow on large indexes, and transient RPC errors are too often treated as definitive allowance failures.

### Goal

Add configurable concurrency limits and bounded retries with backoff to both allowance scripts, plus machine-readable JSON output alongside human summaries.

### Scope

Includes: concurrency + retry + JSON output for the two allowance scripts + tests/mocks.
Does NOT include: implementing MultiEndpointServer failover (Issue 077), or automatic allowance top-up transactions.

### Implementation Guidelines

- Files: `check-allowances.ts`, `alert-expiring-allowances.ts`.
- If a shared Server helper already exists from Issue 077, reuse it; do not rebuild failover here.
- Concurrency default should be conservative; document env knobs.
- Retries only on transient transport/RPC failures, not on definitive insufficient-allowance results.
- JSON schema should be stable enough for alerts to consume.

### Acceptance Criteria

- [ ] Both scripts support configurable concurrency
- [ ] Transient RPC failures retry with backoff; definitive allowance results do not
- [ ] JSON and human outputs are available
- [ ] Unit tests cover retry and concurrency scheduling with mocks

### Validation

Mock flaky RPC in unit tests; run scripts against mocks for JSON shape assertions.

### PR Expectations

The PR should include:

- Concurrency/retry/JSON for allowance scripts + tests
- Explicit non-goal: MultiEndpoint failover owned elsewhere

---

## Issue 098: Create keeper dry-run report artifact comparing estimate vs last live cycle

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

Keeper supports DRY_RUN / estimate APIs; benchmarks store JSON under `scripts/data/benchmarks/`.

### Problem

Operators lack a standard artifact to review before enabling live charging after config changes.

### Goal

Write a cycle report JSON (candidates, estimated outcomes, skipped reasons) suitable for PR/ops review.

### Scope

Includes: keeper report writer + sample artifact.
Does NOT include: web UI.

### Implementation Guidelines

- Files: `keeper.ts`, `data/benchmarks/` sample, README.

### Acceptance Criteria

- [ ] Report written each dry-run cycle
- [ ] Contains counts by ChargeResult
- [ ] Path configurable

### Validation

DRY_RUN=true --once produces report.

### PR Expectations

The PR should include:

- Report feature + sample

---

---

## Issue 099: Align subscriber-health-dashboard output with SubscriptionHealth and aggregate exit semantics

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`subscriber-health-dashboard.ts` and frontend `SubscriptionHealthWidget` both interpret contract `SubscriptionHealth` (`active`, `charge_due`, `within_grace`, `has_sufficient_allowance`, `is_paused`, `trial_active`, `daily_limit_set`).

### Problem

Field naming drift and weak exit-code semantics make ops CLI output hard to compare with UI and hard to use in automation.

### Goal

Emit JSON that matches `SubscriptionHealth` field names one-for-one (plus address identity), document the mapping, support fixture-driven runs, and define aggregate exit codes (e.g. 0 = all healthy, 1 = any unhealthy, 2 = hard failure).

### Scope

Includes: schema alignment, exit-code semantics, fixtures/tests, README sample.
Does NOT include: hosting a web server dashboard.

### Implementation Guidelines

- Files: `subscriber-health-dashboard.ts`, fixtures under `scripts/data/` if useful, `scripts/README.md`.
- Prefer reading the same contract struct fields the UI uses via RPC.
- Provide `--json` or default JSON suitable for piping.
- Include at least one unhealthy fixture asserting exit code 1.

### Acceptance Criteria

- [ ] JSON fields match SubscriptionHealth names
- [ ] Exit codes distinguish healthy vs unhealthy vs hard failure
- [ ] Fixture test covers at least one unhealthy aggregate
- [ ] README sample output matches the schema

### Validation

Run script against fixtures/mocks; assert exit codes and JSON keys.

### PR Expectations

The PR should include:

- Schema-aligned CLI + exit semantics + fixtures
- README sample

---

## Issue 100: Implement rotate-fee-collector two-step automation with pending verification

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`rotate-fee-collector.ts` should drive propose/commit fee flows; contract uses temporary pending fee.

### Problem

Automation may commit too early, ignore bounds, or miss event verification.

### Goal

Script proposes, waits for TTL/policy, verifies `get_fee`/events, then commits with dry-run support.

### Scope

Includes: script hardening + tests.
Does NOT include: changing fee bounds contract logic.

### Implementation Guidelines

- Files: `rotate-fee-collector.ts`, `soroban-admin.ts` helpers.

### Acceptance Criteria

- [ ] Dry-run prints intended txs
- [ ] Verifies pending before commit
- [ ] Respects fee bounds read from chain
- [ ] Fails clearly if pending missing

### Validation

Mocked RPC unit tests.

### PR Expectations

The PR should include:

- Automation hardening + tests

---

---

## Issue 101: Add event watch webhook sink with signature/shared-secret header

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`watch-events.ts` monitors live events; config supports optional WEBHOOK_URL.

### Problem

Webhook delivery may lack retries, signing, and backoff—unreliable for merchant integrations.

### Goal

Add signed webhook delivery, retries, and dead-letter file for failed posts.

### Scope

Includes: watch-events webhook path + tests.
Does NOT include: full merchant portal.

### Implementation Guidelines

- Files: `watch-events.ts`, `event-dedup.ts`, `.env.example`.

### Acceptance Criteria

- [ ] HMAC/shared secret header documented
- [ ] Retries with backoff
- [ ] DLQ file for failures
- [ ] Dedup before post

### Validation

Tests with mock HTTP server.

### PR Expectations

The PR should include:

- Webhook sink + tests

---

---

## Issue 102: Normalize onboard-merchant and testnet-setup scripts with deploy manifest

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`onboard-merchant.ts`, `testnet-setup.ts`, `deployments/manifest.json` / `config.json` exist.

### Problem

Setup steps diverge from manifest fields, causing wrong contract IDs/tokens in local demos.

### Goal

Make setup scripts read deployments manifest as source of truth with override flags.

### Scope

Includes: setup scripts + manifest schema validation.
Does NOT include: mainnet deploy execution.

### Implementation Guidelines

- Files: `onboard-merchant.ts`, `testnet-setup.ts`, `deployments/*`, `deploy-pipeline.ts` alignment.

### Acceptance Criteria

- [ ] Manifest validated
- [ ] Overrides documented
- [ ] Idempotent merchant whitelist onboard

### Validation

Run validate against sample manifest.

### PR Expectations

The PR should include:

- Manifest-driven setup

---

---

## Issue 103: Add top-merchants script consistency with get_top_merchants_by_subs

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`top-merchants.ts` and contract `get_top_merchants_by_subs` should agree; analytics scripts may reimplement ranking.

### Problem

Off-chain ranking can disagree with on-chain top merchants, confusing governance.

### Goal

Prefer on-chain getter with pagination/limit caps (contract panics >20), and test tie-breaking assumptions.

### Scope

Includes: top-merchants.ts + tests.
Does NOT include: changing on-chain ranking.

### Implementation Guidelines

- Files: `top-merchants.ts`, contract limit awareness.

### Acceptance Criteria

- [ ] Uses on-chain API
- [ ] Handles BatchTooLarge limit
- [ ] Output stable for ties as contract defines

### Validation

Mock contract responses.

### PR Expectations

The PR should include:

- Script alignment + tests

---

---

## Issue 104: Instrument deploy-pipeline with preflight wasm hash and health gates

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

`deploy-pipeline.ts` and `pre-upgrade-check.ts` support releases; MAINNET-DEPLOYMENT docs exist.

### Problem

Pipeline may deploy without verifying wasm hash, health, or schema version gates.

### Goal

Add preflight checklist steps failing the pipeline on missing gates; emit machine-readable summary.

### Scope

Includes: deploy-pipeline hardening.
Does NOT include: actual mainnet keys in repo.

### Implementation Guidelines

- Files: `deploy-pipeline.ts`, `pre-upgrade-check.ts`, deployments config.

### Acceptance Criteria

- [ ] Fails if health unhealthy
- [ ] Records wasm hash
- [ ] Summary artifact written
- [ ] Dry-run mode

### Validation

Dry-run pipeline with fixtures.

### PR Expectations

The PR should include:

- Pipeline gates + sample summary

---

---

## Issue 105: Add SQLite backup/restore helper for indexer data directory

**Category:** Backend
**Complexity:** 200 points
**Labels:** backend, wave-200

### Context

Indexer stores `data/events.db`; Docker volumes persist it.

### Problem

No first-class backup/restore tooling risks data loss during host upgrades.

### Goal

Add a small script or subcommand to safely checkpoint/backup/restore events.db with integrity check.

### Scope

Includes: backup helper + README.
Does NOT include: S3 lifecycle policies (document optional).

### Implementation Guidelines

- Files: new `backup-indexer-db.ts` or extend indexer CLI; `scripts/README.md`.

### Acceptance Criteria

- [ ] Online-safe copy strategy documented
- [ ] Restore verified by row count/pragma integrity_check
- [ ] Refuse overwrite without --force

### Validation

Backup/restore roundtrip on sample db.

### PR Expectations

The PR should include:

- Backup tool + docs

---

---

## Issue 106: Rewrite KEEPER.md to match TypeScript keeper and on-chain batch limits

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/KEEPER.md` still references Python, pip, and outdated index APIs in places, while the real keeper is `scripts/keeper.ts` with batch optimizer and DLQ.

### Problem

New operators following KEEPER.md will fail setup and misconfigure PAGE_SIZE vs contract max.

### Goal

Rewrite the runbook to document env vars, dry-run, DLQ replay, failover, and accurate ChargeResult table.

### Scope

Includes: KEEPER.md (+ link from scripts/README).
Does NOT include: implementing new keeper features.

### Implementation Guidelines

- Align with `scripts/keeper.ts`, `replay-dlq.ts`, `batch-optimizer.ts`, `docs/operations/keeper_runbook.md` if overlapping—dedupe or cross-link.
- Remove Python instructions or clearly mark legacy.

### Acceptance Criteria

- [ ] No stale Python-as-primary instructions
- [ ] PAGE_SIZE guidance matches contract
- [ ] DLQ/replay documented
- [ ] Dry-run documented

### Validation

Doc review checklist against script headers; links resolve.

### PR Expectations

The PR should include:

- KEEPER.md update
- Cross-links fixed

---

---

## Issue 107: Correct SECURITY.md auth matrix against current require_admin and upgrade flows

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/SECURITY.md` lists outdated auth (e.g., migrate/upgrade/set_initial_admin rows that disagree with `admin.rs`/`migration.rs`/`upgrade.rs`).

### Problem

Auditors and contributors trust the matrix; inaccuracies create false security assumptions.

### Goal

Re-audit all public entrypoints vs code and update the matrix, including two-step flows in `architecture/two-step-auth.md`.

### Scope

Includes: SECURITY.md (+ root SECURITY.md pointer if needed).
Does NOT include: performing an external audit.

### Implementation Guidelines

- Generate checklist from `#[contractimpl]` methods in `lib.rs`.
- Note permissionless charge/TTL bump risks.

### Acceptance Criteria

- [ ] Matrix matches code for sampled admin and user entrypoints
- [ ] Discrepancies fixed
- [ ] Date/revision note added

### Validation

Spot-check 15 entrypoints manually against docs.

### PR Expectations

The PR should include:

- Corrected auth matrix

---

---

## Issue 108: Document batch_charge failure semantics and allowance abort risk for integrators

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

ARCHITECTURE/KEEPER claim per-user independence; code may still panic on transfer failure until fixed.

### Problem

Integrator docs over-promise non-abort behavior, causing production incidents.

### Goal

Add an accurate failure-mode section describing current semantics and recommended keeper prechecks (`simulate_charge`, allowance scripts).

### Scope

Includes: ARCHITECTURE.md and/or KEEPER.md + EVENT-DRIVEN-GUIDE snippets.
Does NOT include: contract fix (reference issues).

### Implementation Guidelines

- Be explicit about return-value vs panic paths.
- Link `check-allowances.ts` and estimate APIs.

### Acceptance Criteria

- [ ] Failure modes table added
- [ ] No false claims of full non-abort if unfixed
- [ ] Precheck recommendations included

### Validation

Technical review against `batch.rs`/`fee.rs`.

### PR Expectations

The PR should include:

- Doc section + links to scripts

---

---

## Issue 109: Publish a canonical referral guide covering auth, events, self-referral, and client touchpoints

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/REFERRAL.md` and `docs/REFERRALS.md` overlap. Contract referral storage lives in `referral.rs` with subscribe-time self-referral rejection; frontend has `ReferralPanel.tsx`; events include referred.

### Problem

Split docs and missing integration detail leave merchants unsure which document is authoritative and how self-referral, events, and UI/scripts interact.

### Goal

Produce one canonical referral guide that merges unique content from both files, documents auth/storage/events/self-referral, and links frontend (`ReferralPanel`) and any script touchpoints; update README/ARCHITECTURE links accordingly.

### Scope

Includes: canonical doc + redirects/stubs from the non-canonical path + link fixes across docs.
Does NOT include: changing on-chain referral economics.

### Implementation Guidelines

- Preserve unique material from both existing files.
- Sections: data model, subscribe auth, self-referral error, events, frontend usage, operational queries.
- Cross-link `ARCHITECTURE.md`, `EVENTS.md`, `ERROR-CODES.md` as needed.
- Leave a stub at the retired filename pointing to the canonical path.

### Acceptance Criteria

- [ ] Exactly one canonical referral guide with full auth/events/self-referral/client sections
- [ ] Retired filename stubs/redirects so old links do not 404 in-repo
- [ ] README and ARCHITECTURE point to the canonical doc
- [ ] No contradictory duplicate guidance remains

### Validation

rg for REFERRAL.md/REFERRALS.md links and open them; verify stub + canonical content completeness against `referral.rs` and ReferralPanel.

### PR Expectations

The PR should include:

- Canonical referral guide + stubs + link updates
- Checklist of sections mapped to code symbols

---

## Issue 110: Document health, estimate, fee-bounds, pause_until, and active-subscriber page APIs in API.md

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/API.md` is the integrator reference. Newer contract surfaces include `contract_health_check`/`HealthReport`, `simulate_charge`/`get_batch_charge_estimate`, `set_fee_bounds`/`get_fee_bounds`, `pause_until`/`get`-style pause expiry if present, and `get_active_subscriber_page`, plus related enums.

### Problem

Integrators miss these entries while a full audit of every historical method is larger than one Wave docs PR.

### Goal

Add or refresh API.md sections for this bounded delta set—health, estimate/simulate, fee bounds, pause_until (and pause expiry read if exposed), and active-subscriber page—including auth, errors, and enums (`ChargeResult`, `ChargeSimResult`, `HealthReport` as applicable).

### Scope

Includes: API.md updates for the named delta only.
Does NOT include: rewriting the entire API.md or generating SDK clients.

### Implementation Guidelines

- Diff only the listed methods/types from `lib.rs` against API.md.
- Document auth and error codes per method.
- Cross-link EVENTS/KEEPER where batch estimate matters.
- Note any intentional omissions outside the delta.

### Acceptance Criteria

- [ ] Each named delta method/type has an API.md section
- [ ] Enums used by those methods are documented
- [ ] Auth and errors are listed
- [ ] PR checklist shows the bounded method list (not entire contract)

### Validation

Compare the agreed method list to API.md headings in the PR checklist.

### PR Expectations

The PR should include:

- Bounded API.md delta + checklist
- Links to related ops docs where useful

---

## Issue 111: Expand storage_and_ttl.md for PauseExpiry, temporary daily limits, and pending proposals

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/architecture/storage_and_ttl.md` and ARCHITECTURE storage tables may lag `DataKey` variants.

### Problem

Operators mismanage TTL for temporary keys (`DailyLimit`, `PendingFee`, `PendingUpgrade`) and pause expiry.

### Goal

Document each DataKey’s storage type, TTL strategy, and keeper responsibilities.

### Scope

Includes: storage_and_ttl.md (+ ARCHITECTURE table sync).
Does NOT include: code changes.

### Implementation Guidelines

- Mirror `DataKey` in `lib.rs`.
- Cross-link bump APIs.

### Acceptance Criteria

- [ ] All DataKey variants covered or explicitly deferred with reason
- [ ] Temporary vs persistent clear
- [ ] Keeper TTL tasks listed

### Validation

Compare to DataKey enum.

### PR Expectations

The PR should include:

- TTL doc update

---

---

## Issue 112: Document keeper, indexer, metrics, and docker-compose operations in scripts README

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`scripts/README.md` under-documents the real ops stack: `keeper.ts`, `indexer.ts`, `metrics-server.ts`, `grafana-dashboard.json`, and `docker-compose.yml`/`Dockerfile`.

### Problem

Contributors cannot bring up the core charging/observability path from the README alone, and expanding to all 30+ scripts in one PR is too broad.

### Goal

Expand scripts README with a focused ops guide for keeper + indexer + metrics + compose: env matrix, examples, health expectations, and data volume notes for `events.db`.

### Scope

Includes: scripts/README.md sections for that stack (+ optional link from `docs/operations/`).
Does NOT include: documenting every analytics/one-off script in this PR.

### Implementation Guidelines

- Env matrix columns: variable, default, used-by (keeper/indexer/metrics).
- Compose service diagram or bullet topology.
- Point to DLQ/replay and failover docs lightly without absorbing them.
- Keep examples copy-pastable for testnet.

### Acceptance Criteria

- [ ] Keeper, indexer, metrics, and compose are documented with examples
- [ ] One env matrix covers the stack
- [ ] Data directory / events.db persistence called out
- [ ] Explicit note that other scripts are out of scope for this guide revision

### Validation

Follow the README steps on paper against compose/Dockerfile/env example paths.

### PR Expectations

The PR should include:

- Focused scripts README ops guide
- Env matrix for the four-area stack

---

## Issue 113: Update MAINNET-DEPLOYMENT.md with fee bounds, volume cap, and health gates

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/MAINNET-DEPLOYMENT.md` and deploy scripts exist; security policy forbids unaudited mainnet funds.

### Problem

Checklist may omit newer governance knobs (`set_fee_bounds`, volume cap, deep health).

### Goal

Extend mainnet checklist with explicit pre-deposit gates and rollback/upgrade references.

### Scope

Includes: MAINNET-DEPLOYMENT.md.
Does NOT include: performing mainnet deploy.

### Implementation Guidelines

- Link pre-upgrade-check, snapshot-diff, ALLOW_MAINNET style ops controls.
- Emphasize audit requirement from SECURITY.md.

### Acceptance Criteria

- [ ] Checklist includes fee bounds/volume/health
- [ ] Rollback section references propose/commit upgrade
- [ ] Audit gate explicit

### Validation

Review against contract admin APIs.

### PR Expectations

The PR should include:

- Checklist update

---

---

## Issue 114: Document frontend architecture composition and orphaned components

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/FRONTEND.md` / `FRONTEND-COMPONENTS.md` describe components; `App.tsx` does not compose all of them.

### Problem

Contributors assume components are live; onboarding wastes time.

### Goal

Add a composition map showing what App actually mounts vs available components/pages, and how to wire new tabs.

### Scope

Includes: FRONTEND.md and/or FRONTEND-COMPONENTS.md.
Does NOT include: implementing the wiring.

### Implementation Guidelines

- Inventory `frontend/src/components` vs App imports.
- Document providers in `main.tsx`.

### Acceptance Criteria

- [ ] Composition diagram/map added
- [ ] Orphan/ready components labeled
- [ ] Providers documented

### Validation

Map matches current App.tsx imports.

### PR Expectations

The PR should include:

- Frontend composition doc

---

---

## Issue 115: Add troubleshooting runbook for common ChargeResult and wallet errors

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

ERROR-CODES.md is extensive; ops still need a symptom→fix playbook spanning contract, keeper, and frontend.

### Problem

Support burden rises when grace lapses, allowance expiry, and RPC failures look similar to users.

### Goal

Create `docs/operations/troubleshooting.md` (or expand existing recovery playbook) with decision trees.

### Scope

Includes: new/expanded troubleshooting doc linked from README.
Does NOT include: code fixes.

### Implementation Guidelines

- Cover allowance, grace, pause, contract pause, wrong network, empty CONTRACT_ID.
- Point to scripts: check-allowances, grace-period-monitor, health-check.

### Acceptance Criteria

- [ ] At least 8 scenarios with concrete commands
- [ ] Links to scripts/docs valid
- [ ] Includes frontend error mapper hints

### Validation

Follow one scenario end-to-end on paper against repo paths.

### PR Expectations

The PR should include:

- Troubleshooting runbook

---

---

## Issue 116: Update INTEGRATION-GUIDE and MERCHANT-INTEGRATION for pay_per_use_to and fee recipients

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

Merchant integration docs exist; contract added `pay_per_use_to` and `MerchantFeeRecipient`.

### Problem

Merchants integrating custom recipients/fees lack accurate guidance.

### Goal

Document recipient routing, whitelist implications, and fee recipient configuration flows.

### Scope

Includes: INTEGRATION-GUIDE.md and MERCHANT-INTEGRATION.md sections.
Does NOT include: building merchant portal features.

### Implementation Guidelines

- Include auth requirements and error cases (`InvalidRecipient`, `MerchantNotWhitelisted`).
- Cross-link events.

### Acceptance Criteria

- [ ] pay_per_use_to documented
- [ ] Fee recipient setup documented
- [ ] Errors listed

### Validation

Compare to fee.rs and pay_per_use_inner.

### PR Expectations

The PR should include:

- Integration doc updates

---

---

## Issue 117: Refresh TESTING.md for Vitest, contract snapshots, and scripts fixtures

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/TESTING.md` and `docs/development/testing_runbook.md` cover testing; frontend has large `__tests__`, contract uses `test_snapshots/`.

### Problem

Contributors miss how to update Soroban snapshots, run frontend tests (CI may not), or script fixtures.

### Goal

Document exact commands for contract tests/snapshots, frontend vitest, and scripts typecheck/tests.

### Scope

Includes: TESTING.md (+ testing_runbook sync).
Does NOT include: enabling CI beyond documenting recommended workflow.

### Implementation Guidelines

- Include `cargo test`, vitest, prettier/eslint, scripts typecheck.
- Snapshot update procedure.

### Acceptance Criteria

- [ ] Commands accurate
- [ ] Snapshot workflow documented
- [ ] Scripts testing section added

### Validation

Run documented commands locally if feasible; otherwise dry review.

### PR Expectations

The PR should include:

- TESTING.md refresh

---

---

## Issue 118: Document two-step upgrade and fee rotation operator playbooks with timing

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`architecture/two-step-auth.md` explains security rationale; operators need timed playbooks for upgrade and fee rotation scripts.

### Problem

Pending temporary TTL (17280) can expire mid-ceremony without clear ops timing guidance.

### Goal

Add step-by-step operator playbooks including TTL budgets, verification reads (`get_pending_upgrade`, `get_fee`), and abort paths.

### Scope

Includes: operations doc section + links from MAINNET/KEEPER.
Does NOT include: code for cancel APIs unless already present.

### Implementation Guidelines

- Reference `rotate-fee-collector.ts`, `upgrade.rs`, `soroban-admin.ts`.

### Acceptance Criteria

- [ ] Timing budget stated
- [ ] Abort/cancel path documented
- [ ] Verification commands listed

### Validation

Playbook review against code TTLs.

### PR Expectations

The PR should include:

- Operator playbooks

---

---

## Issue 119: Resolve glossary conflicts for ChargeResult, health, schema, and keeper terms against ARCHITECTURE/KEEPER

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/GLOSSARY.md` defines core terms. Newer language—`ChargeResult`, `ChargeSimResult`, schema v3, `pause_until`, daily limit window, MultiEndpointServer, DLQ—appears in `ARCHITECTURE.md` and `KEEPER.md` with occasional wording drift.

### Problem

Contributors copy inconsistent definitions into PRs when the glossary lags or contradicts runbooks.

### Goal

Update GLOSSARY.md with the new terms **and** reconcile any conflicting definitions by citing ARCHITECTURE/KEEPER as sources of truth, noting and fixing contradictions found during the pass.

### Scope

Includes: glossary additions/updates + conflict reconciliation notes/fixes in glossary (and minimal cross-doc wording fixes only where required for consistency).
Does NOT include: renaming on-chain symbols or rewriting KEEPER.md entirely (Issue 106).

### Implementation Guidelines

- Add concise entries with links to canonical docs.
- While editing, spot-check ChargeResult table vs KEEPER, schema version vs ARCHITECTURE/migration, pause_until vs lifecycle.
- Record contradictions resolved in the PR description.
- Keep entries short; link out for depth.

### Acceptance Criteria

- [ ] Listed modern terms exist in GLOSSARY.md
- [ ] At least the ChargeResult/schema/pause_until definitions are checked against ARCHITECTURE/KEEPER and aligned
- [ ] PR lists contradictions found and how they were resolved
- [ ] Links from glossary entries resolve

### Validation

Spot-check term usage in ARCHITECTURE/KEEPER against glossary entries.

### PR Expectations

The PR should include:

- Glossary update + conflict reconciliation
- PR table of contradictions resolved

---

## Issue 120: Create backend onboarding path in ONBOARDING.md for scripts contributors

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/ONBOARDING.md` focuses on overall project; contract/frontend contributing docs exist (`CONTRIBUTING-CONTRACT.md`, `CONTRIBUTING-FRONTEND.md`).

### Problem

Scripts/backend contributors lack a first-issue-to-first-PR path for keeper/indexer work.

### Goal

Add a backend/scripts onboarding section with environment setup, safe dry-run keeper, and suggested first tasks.

### Scope

Includes: ONBOARDING.md (+ maybe CONTRIBUTING pointer).
Does NOT include: creating those first tasks’ code.

### Implementation Guidelines

- Require Node 20+, scripts npm install, `.env.example`.
- Emphasize never committing secrets.

### Acceptance Criteria

- [ ] Backend section present
- [ ] Dry-run instructions work on paper
- [ ] Secret safety called out

### Validation

Follow steps against scripts/README.

### PR Expectations

The PR should include:

- Onboarding expansion

---

---

## Issue 121: Document current CI workflows with concrete recommended YAML for Vitest and scripts typecheck

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`.github/workflows/rust.yml` runs clippy/build/test. `frontend.yml` runs lint/prettier/build but may not run Vitest. Scripts currently lack CI (see backend Issue 087).

### Problem

Contributors assume CI enforces frontend unit tests and scripts typecheck when it may not, causing false confidence.

### Goal

Document the actual CI surface accurately, and provide copy-pastable recommended workflow YAML snippets (or patch blocks) for adding frontend Vitest and scripts typecheck—including where they would plug into existing workflow files—without requiring this docs PR to merge the CI changes themselves.

### Scope

Includes: CONTRIBUTING or development doc section with CI truth + concrete YAML recommendations and acceptance criteria for those recommendations.
Does NOT include: merging the workflow changes in this docs-only PR (implementation may be Issue 087 / a follow-up).

### Implementation Guidelines

- Read the YAML files and describe jobs/steps truthfully.
- Provide recommended `npm test` / `npm run typecheck` steps with Node 20 and cache paths matching the repo.
- State clearly what is enforced today vs recommended.
- Link Issue 087 if scripts CI is implemented separately.

### Acceptance Criteria

- [ ] Current rust/frontend CI behavior is accurately described
- [ ] Recommended Vitest and scripts typecheck YAML snippets are included and match package scripts
- [ ] Doc distinguishes enforced vs recommended checks
- [ ] Paths and Node version align with existing workflows

### Validation

Compare the doc’s “current behavior” section to the workflow YAML line-by-line; validate recommended snippets against `frontend/package.json` / `scripts/package.json` script names.

### PR Expectations

The PR should include:

- CI truth + concrete recommended YAML snippets
- Clear enforced-vs-recommended labeling

---

## Issue 122: Publish event catalog addendum for migration, auto-resume, and fee events

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/EVENTS.md` catalogs events; code emits additional events (migration_completed, auto_resumed, upgrade proposed, etc.).

### Problem

Indexers following EVENTS.md miss payloads/topics for newer events.

### Goal

Update EVENTS.md with complete catalog matching `events.rs` publish_* helpers.

### Scope

Includes: EVENTS.md (+ EVENT-DRIVEN-GUIDE cross-links).
Does NOT include: indexer code updates.

### Implementation Guidelines

- Enumerate functions in `events.rs`.
- Include topic layout and data types.

### Acceptance Criteria

- [ ] All publish_* events documented
- [ ] Payload fields listed
- [ ] Version note added

### Validation

Diff events.rs vs EVENTS.md in PR checklist.

### PR Expectations

The PR should include:

- Events catalog sync

---

---

## Issue 123: Clarify multi-token fee and volume semantics for accountants

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/MULTI-TOKEN.md` and fee/volume features interact: volume cap is stroop-aggregated across tokens potentially unfairly; fees use per-sub token.

### Problem

Economic semantics across heterogeneous tokens are easy to misunderstand for merchants and auditors.

### Goal

Add a worked-examples section for mixed-token volume accounting and per-token fee transfers.

### Scope

Includes: MULTI-TOKEN.md and/or COMPLIANCE.md examples.
Does NOT include: changing aggregation model (document limitations instead).

### Implementation Guidelines

- Use concrete XLM vs USDC examples.
- Call out limitations of global stroop volume if cross-token.

### Acceptance Criteria

- [ ] Worked examples included
- [ ] Limitations explicit
- [ ] Links to volume APIs

### Validation

Review against `check_and_update_global_volume` and fee transfers.

### PR Expectations

The PR should include:

- Economic semantics doc

---

---

## Issue 124: Refresh CONTRIBUTING-CONTRACT module map with charge/fee/TTL invariants and test guidance

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

`docs/CONTRIBUTING-CONTRACT.md` and `docs/ARCHITECTURE.md` module tables guide new contract contributors. Critical modules include `charge_exec.rs`, `fee.rs`, `spending_limit.rs`, `storage.rs`; `limits.rs` is nearly empty.

### Problem

Outdated maps send contributors to the wrong files and omit where invariants (charge prechecks, fee splits, TTL bumps) and tests should land.

### Goal

Refresh the module responsibility map to match `contract/src/*`, and add guidance for charge/fee/TTL invariants plus “where to add tests” (including `test_snapshots` policy and bench feature notes).

### Scope

Includes: CONTRIBUTING-CONTRACT.md update + ARCHITECTURE module table sync as needed.
Does NOT include: moving code between modules.

### Implementation Guidelines

- One-liner per src module reflecting real responsibility.
- Call out charge_exec vs batch vs fee ownership.
- Document how to run `cargo test`, update snapshots, and optional `--features bench`.
- Add a short checklist for adding a new entrypoint (auth, errors, events, tests).

### Acceptance Criteria

- [ ] Module map matches contract/src file list
- [ ] Charge/fee/TTL invariant ownership is explicit
- [ ] Test/snapshot/bench commands are accurate
- [ ] New-entrypoint checklist is present

### Validation

`ls contract/src` vs module table; run documented test commands dry-check against package scripts/Cargo features.

### PR Expectations

The PR should include:

- Contributing-contract refresh with invariants + test guidance
- ARCHITECTURE module table sync if needed

---

## Issue 125: Document local development network matrix for frontend, contract tests, and scripts

**Category:** Documentation
**Complexity:** 200 points
**Labels:** documentation, wave-200

### Context

Developers juggle Soroban local/testnet RPC, `VITE_*` frontend env, and scripts `.env` independently (`frontend/.env.example`, `scripts/.env.example`, deployments config).

### Problem

Onboarding fails when passphrase/RPC/contract ID disagree across packages, producing confusing auth and simulation errors.

### Goal

Add a single local-development network matrix doc section covering required env vars per package, example testnet values, and verification commands (`health-check`, frontend NetworkBadge, `cargo test`).

### Scope

Includes: ONBOARDING.md or `docs/development/` guide + links from README.
Does NOT include: automating env generation code.

### Implementation Guidelines

- Table columns: variable, package, testnet example, mainnet caution.
- Cross-link DEPLOYMENT.md and scripts README.
- Mention Freighter network matching.

### Acceptance Criteria

- [ ] Matrix covers frontend, scripts, contract testutils expectations
- [ ] Verification commands listed
- [ ] Mainnet caution explicit
- [ ] Links from README/ONBOARDING

### Validation

Follow matrix against .env.example files for completeness.

### PR Expectations

The PR should include:

- Network matrix documentation
- README/ONBOARDING links
