#![cfg(test)]
#![allow(
    clippy::bool_assert_comparison,
    unused_variables,
    dead_code,
    clippy::inconsistent_digit_grouping
)]
// Test snapshots in `test_snapshots/test/` are GENERATED at test time: every
// `Env` dropped by a test below writes its ledger entries and events to
// `test_snapshots/test/<test-name>.<N>.json` (see `test_snapshots/README.md`).
// Regenerate with a full `cargo test` and commit the result together with the
// change that produced it; never hand-edit a snapshot, and delete the file when
// a test here is renamed or removed. `contract/scripts/snapshot-check.mjs` fails
// CI on orphaned, corrupt, gapped or stale snapshot files.

// Include feature files in this module to preserve libtest names and SDK snapshot paths.
include!("test/common.rs");
include!("test/admin.rs");
include!("test/batch.rs");
include!("test/charge.rs");
include!("test/config.rs");
include!("test/daily_limit.rs");
include!("test/fees.rs");
include!("test/health.rs");
include!("test/history.rs");
include!("test/indexes.rs");
include!("test/lifecycle.rs");
include!("test/subscribe.rs");
include!("test/upgrade.rs");
include!("test/whitelist.rs");
include!("test/multi_subscription.rs");
include!("test/reentrancy.rs");
