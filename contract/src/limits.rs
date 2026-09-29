//! Limit handling documentation.
//!
//! There is intentionally no standalone `limits` module in the smart contract.
//! Limit enforcement is implemented across dedicated modules:
//!
//! - **Subscription amount & interval validation**: [`crate::validation`] (`validation.rs`)
//!   - Enforces `MAX_SUBSCRIPTION_AMOUNT`, `MAX_SUBSCRIPTION_INTERVAL`, positive amounts,
//!     minimum interval floor, and token allowances.
//! - **Batch size limits**: [`crate::batch`] (`batch.rs`) and `lib.rs`
//!   - Enforces `MAX_BATCH_SIZE` (default 50), `MAX_BATCH_SIZE_CEILING` (200), `MAX_BATCH_PAUSE_SUBSCRIPTIONS` (25),
//!     and `MAX_WHITELIST_BATCH_SIZE` (default 50).
//! - **Daily spending limits**: [`crate::spending_limit`] (`spending_limit.rs`)
//!   - Enforces per-user daily spending caps on `pay_per_use` microtransactions.
//! - **Configurable minimum billing interval**: [`crate::min_interval`] (`min_interval.rs`)
//!   - Enforces contract-wide minimum billing interval requirements.
//!
//! For protocol and UI limit documentation, refer to `docs/limits.md` and `docs/DAILY-LIMITS.md`.
