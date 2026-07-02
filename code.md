You are a senior Rust developer contributing to an open-source project built on the Stellar ecosystem. 


1. Analyze Assigned Issues
Carefully read the below assigned issues.
Help solve each issues and map them to relevant parts of the codebase.

ISSUE #481 [CONTRACT-25] Add Event Index Metadata to All Published Events 
### Background
All events in `events.rs` are published with a two-element topic tuple `(Symbol, Address)` or `(Symbol,)`. Soroban events are indexed by topic on the RPC layer, but the current events carry no sequence or correlation metadata. When `batch_charge` processes 50 users and emits 50 charged events in one transaction, there is no way for an event consumer to reconstruct the original batch ordering or correlate a charge event back to a specific `batch_charge` invocation. Keeper bots and analytics pipelines that process events asynchronously must rely on ledger sequence numbers alone, which breaks when multiple `batch_charge` calls land in the same ledger.

### Task
Add a `ledger_sequence: u32` field to `ChargeEventData` (already a `#[contracttype]` struct). Populate it with `env.ledger().sequence()` in `publish_charged`. Add a consistent `sequence: u32` field to new event data structs for `publish_subscribed`, `publish_cancelled`, and `publish_pay_per_use` — wrap each in a new `#[contracttype]` struct (`SubscribedEventData`, `CancelledEventData`, `PayPerUseEventData`) rather than using bare tuples. This makes all major events strongly typed and carries ledger context.

### Key Files
* `contract/src/events.rs` — define `SubscribedEventData`, `CancelledEventData`, `PayPerUseEventData` structs; add `ledger_sequence: u32` to all; update all `publish_*` functions to use these structs
* `contract/src/lib.rs` — no changes needed if event functions are called correctly
* `contract/src/test.rs` — update any tests that assert on raw event tuples to match new struct shapes; add a test reading back charged event data and asserting `ledger_sequence` equals `env.ledger().sequence()`

### Edge Cases
* `ChargeEventData` already exists as a struct — add `ledger_sequence` as a new field; existing snapshot tests will need regeneration
* Snapshot files in `contract/test_snapshots/` will change — delete and regenerate with `cargo test` (this is expected and must be noted in the PR)
* Do not add `ledger_sequence` to admin-only events (`publish_upgraded`, `publish_admin_transferred`) — those have different consumers

### Acceptance Criteria
- [ ] `ChargeEventData`, `SubscribedEventData`, `CancelledEventData`, `PayPerUseEventData` all carry `ledger_sequence: u32`
- [ ] All four `publish_*` functions populate `ledger_sequence` from `env.ledger().sequence()`
- [ ] Test: assert charged event's `ledger_sequence` field equals the ledger sequence at charge time
- [ ] All snapshot files regenerated and committed
- [ ] `cargo test` passes with no regressions


ISSUE #468  ## [CONTRACT-12] Implement validate_token_is_contract Using WASM-Safe XDR Inspection 


### Background
`subscribe` in `lib.rs` contains an inline token validation using `token.clone().to_xdr(&env).get(7) == Some(0)` to detect non-contract addresses. This is an undocumented, fragile heuristic based on XDR byte layout — it has no test coverage explaining the magic byte index, it will silently break if Soroban's XDR serialization changes, and it lives inline in `subscribe` rather than in `validation.rs`. The existing `ContractError::InvalidTokenAddress` error is correct but the detection logic is brittle. The proper check is to attempt a `token::Client::new(env, &token).decimals()` call and catch the resulting host trap — or validate that the Address resolves to a contract via the `env.deployer()` API.

### Task
Move token validation into a `validate_token_address(env: &Env, token: &Address)` function in `validation.rs`. Replace the XDR byte hack with a call to `token::Client::new(env, token).decimals()` wrapped in a `try_` call (using soroban-sdk's `try_` invocation pattern for cross-contract calls). If the call returns an error, panic with `ContractError::InvalidTokenAddress`. Remove the inline XDR check from `subscribe` and replace it with `validation::validate_token_address`. Add the token module import to `validation.rs`.

### Key Files
* `contract/src/validation.rs` — add `validate_token_address(env, token)`
* `contract/src/lib.rs` — replace inline XDR check in `subscribe` with the new helper
* `contract/src/test.rs` — the existing `test_subscribe_non_contract_address` test must continue to pass; add a test for a valid contract token address succeeding

### Edge Cases
* In the test environment, soroban-sdk testutils register mock contracts — ensure the mock token used in `setup()` passes the new validation without changes to test infrastructure
* If `token::Client::try_decimals()` is not available in the current SDK version, use an alternative introspection method and document it clearly in a code comment
* The validation must occur after amount and interval checks to preserve existing error ordering in `subscribe`

### Acceptance Criteria
- [ ] `validate_token_address(env, token)` exists in `validation.rs` with a doc comment explaining the approach
- [ ] `subscribe` no longer contains any XDR byte-index magic; calls `validate_token_address` instead
- [ ] `test_subscribe_non_contract_address` passes without modification to test setup
- [ ] New test: subscribing with a valid SAC token address succeeds
- [ ] `cargo test` passes with no regression

ISSUE #472  ## [CONTRACT-16] Implement Configurable MAX_BATCH_SIZE Guard in batch_charge 

### Background
`batch_charge` in `batch.rs` accepts an unbounded `Vec<Address>` — a caller can pass thousands of addresses in a single transaction. Soroban enforces a per-transaction instruction budget, but the contract itself provides no explicit guard. A malicious or misconfigured keeper could submit a batch large enough to exhaust the instruction budget mid-execution, producing a partial batch result where some users are charged and others are not, with no way for the caller to distinguish charged-and-failed from not-yet-attempted. More critically, without a size cap the function's gas cost is unbounded and cannot be reliably estimated for keeper automation.

### Task
Add a `MAX_BATCH_SIZE: u32 = 50` constant in `batch.rs`. At the start of `batch_charge`, check if `users.len() > MAX_BATCH_SIZE` and panic with a new `ContractError::BatchTooLarge = 20`. Add `get_max_batch_size(env: Env) -> u32` as a public read-only function returning the constant. Expose an admin-configurable override via `DataKey::MaxBatchSize` instance storage — `set_max_batch_size(env, size)` (admin-only, max value 200) so the limit can be adjusted as Soroban's instruction budget evolves. If `DataKey::MaxBatchSize` is unset, fall back to the hardcoded `MAX_BATCH_SIZE` constant.

### Key Files
* `contract/src/batch.rs` — add `MAX_BATCH_SIZE` constant; add size guard using storage-or-default limit
* `contract/src/errors.rs` — add `BatchTooLarge = 20`
* `contract/src/lib.rs` — add `DataKey::MaxBatchSize`; add `get_max_batch_size` and `set_max_batch_size` public functions; `set_max_batch_size` requires admin auth
* `contract/src/test.rs` — test: batch of 51 addresses panics with `BatchTooLarge`; test: `set_max_batch_size(10)` then batch of 11 panics; test: non-admin `set_max_batch_size` panics

### Edge Cases
* `set_max_batch_size` must reject values > 200 with `ContractError::InvalidFeeBps` — or add a new `ContractError::InvalidBatchSize = 21` for clarity
* An empty batch (`users.len() == 0`) must return an empty `Vec` without panicking
* The existing `test_batch_charge_stress` test uses a large batch — update it to use a size $\le$ `MAX_BATCH_SIZE` or call `set_max_batch_size` first

### Acceptance Criteria
- [ ] `ContractError::BatchTooLarge = 20` in `errors.rs`
- [ ] `batch_charge` with `users.len() > max` panics with `BatchTooLarge`
- [ ] `set_max_batch_size` requires admin auth and rejects values > 200
- [ ] `get_max_batch_size` returns the configured value or the default constant
- [ ] Test: batch of 51 with default limit panics; batch of 50 succeeds
- [ ] `cargo test` passes, `test_batch_charge_stress` updated accordingly

ISSUE #474 ## [CONTRACT-18] Implement cancel_and_refund_prorated for Partial-Period Refunds 

* **Points:** 200
* **Labels:** contract, subscriptions, token, ux

### Background
`cancel` in `lib.rs` immediately deactivates the subscription without any refund mechanism. Users who cancel mid-period have paid for a full billing interval but cannot recoup the unused portion. While full refund logic is complex and out of scope, a prorated refund — where the contract transfers back $\text{amount} \times (\text{remaining\_seconds} / \text{interval})$ to the user — is both mathematically tractable and a significant UX differentiator. The contract already holds no funds directly (charges use `transfer_from` on the user's allowance), so a refund is a merchant-to-user transfer, requiring the merchant's authorization.

### Task
Add `cancel_and_refund_prorated(env: Env, user: Address, merchant: Address)` requiring both `user.require_auth()` and `merchant.require_auth()`. Compute $\text{elapsed} = \text{now} - \text{last\_charged}$, $\text{remaining} = \text{interval} - \text{elapsed}$ (clamped to 0 if $\text{elapsed} \ge \text{interval}$), $\text{refund} = \text{amount} \times \text{remaining} / \text{interval}$. If $\text{refund} > 0$, transfer refund from merchant to user using `token::Client::new(&env, &sub.token).transfer(&merchant, &user, &refund)`. Then cancel the subscription (set `active: false`, decrement counts). Emit a `subscription_cancelled_with_refund` event including the refund amount.

### Key Files
* `contract/src/lib.rs` — add `cancel_and_refund_prorated`; factor `cancel` bookkeeping into `cancel_inner(env, user)` to avoid duplication
* `contract/src/events.rs` — add `publish_cancelled_with_refund(env, user, refund_amount)`
* `contract/src/test.rs` — test: cancel 25% into a 100-second interval on a 1,000,000 stroop subscription yields a 750,000 refund; test: cancel at or after interval end yields 0 refund and no transfer; test: missing subscription panics

### Edge Cases
* Both user and merchant must auth — a user cannot force a refund without merchant consent
* If $\text{elapsed} \ge \text{interval}$, $\text{remaining} = 0$ and $\text{refund} = 0$ — skip the transfer entirely
* Integer division truncation is acceptable (document in code comments); do not use floating point
* The function must still cancel the subscription even when `refund == 0`

### Acceptance Criteria
- [ ] Both `user.require_auth()` and `merchant.require_auth()` are called
- [ ] Prorated refund formula: $\text{refund} = \text{amount} \times \max(0, \text{interval} - \text{elapsed}) / \text{interval}$
- [ ] Token transfer only occurs when $\text{refund} > 0$
- [ ] `publish_cancelled_with_refund` event emitted with correct refund amount
- [ ] Test: 25% elapsed $\rightarrow$ 75% refund transferred
- [ ] Test: 100% elapsed $\rightarrow$ no transfer, subscription cancelled
- [ ] `cargo test` passes with no regressions
