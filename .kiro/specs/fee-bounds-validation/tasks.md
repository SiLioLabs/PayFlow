# Implementation Plan: Fee Bounds Validation

## Phase 1: Exploration - Demonstrate the Bug

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Fee Proposal Bounds Validation
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists (out-of-bounds proposals are accepted when they should be rejected)
  - **Scoped PBT Approach**: For deterministic bugs, scope the property to concrete failing case(s) to ensure reproducibility
  - Test that when bounds are set (e.g., MinFeeBps=50, MaxFeeBps=200), proposals outside these bounds (bps < 50 or bps > 200) are rejected with OutOfBoundsFee error (not accepted as currently happens)
  - Test implementation details from Bug Condition in design: `(bps < MinFeeBps OR bps > MaxFeeBps) AND bps <= 10_000 AND bounds set`
  - The test assertions should match the Expected Behavior Properties from design: "rejected with OutOfBoundsFee and NO pending fee stored"
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause (e.g., "propose_fee(50, 200, 25) currently accepted, should be rejected")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2, 2.7, 2.8_

## Phase 2: Preservation - Establish Baseline Behavior

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Valid Fee Proposal Acceptance and In-Bounds Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: When bounds are unset or when bps is within bounds (MinFeeBps <= bps <= MaxFeeBps), current code accepts and stores pending fee
  - Observe: bps > 10_000 currently rejected with InvalidFeeBps; bps in-range currently accepted
  - Write property-based tests capturing these observed behavior patterns:
    - In-bounds proposals succeed: for all (min, max, bps) where min <= bps <= max, proposal succeeds and pending fee is stored
    - Unset bounds default correctly: when bounds are unset, (0 <= bps <= 10_000) proposals succeed
    - Absolute maximum validation preserved: bps > 10_000 rejected with InvalidFeeBps
    - Admin authorization preserved: non-admin calls rejected before any storage changes
    - Boundary cases work: exact min and exact max values accepted
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

## Phase 3: Implementation

- [ ] 3. Fix for Fee Bounds Validation

  - [ ] 3.1 Add OutOfBoundsFee error variant to ContractError enum
    - Edit `contract/src/errors.rs`
    - Add new `OutOfBoundsFee` variant to `ContractError` enum with next available error code (approximately 24 or next gap)
    - Use error message: "Returned when a fee proposal is outside the configured bounds"
    - Maintain alphabetical or logical ordering of error variants
    - _Bug_Condition: isBugCondition(input) = (bps < MinFeeBps OR bps > MaxFeeBps) AND bps <= 10_000_
    - _Expected_Behavior: Reject out-of-bounds proposals with typed OutOfBoundsFee error_
    - _Preservation: Existing error codes unchanged, InvalidFeeBps still used for bps > 10_000_
    - _Requirements: 2.1, 2.2, 2.7, 2.8_

  - [ ] 3.2 Add MinFeeBps and MaxFeeBps storage keys to DataKey enum
    - Edit `contract/src/lib.rs`
    - Locate the `DataKey` enum (contracttype)
    - Add `MinFeeBps` variant for instance storage of minimum fee bound (u32)
    - Add `MaxFeeBps` variant for instance storage of maximum fee bound (u32)
    - Add entries in comment section with the fee-related keys
    - _Bug_Condition: Bounds storage keys needed to validate against stored constraints_
    - _Expected_Behavior: Keys exist and persist fee bounds in instance storage_
    - _Preservation: Existing DataKey variants unchanged_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.3 Implement get_min_fee_bps() and get_max_fee_bps() helper functions
    - Edit `contract/src/fee.rs`
    - Add `get_min_fee_bps(env: &Env) -> u32` function
      - Retrieve from instance storage at DataKey::MinFeeBps
      - Default to 0 if unset (allowing any non-negative bps)
    - Add `get_max_fee_bps(env: &Env) -> u32` function
      - Retrieve from instance storage at DataKey::MaxFeeBps
      - Default to 10_000 if unset (preserving absolute maximum)
    - Place these functions near existing fee helpers (get_fee_bps, get_fee_collector)
    - _Bug_Condition: Functions needed to retrieve bounds from storage_
    - _Expected_Behavior: Bounds retrieved with correct defaults_
    - _Preservation: No impact on other functions_
    - _Requirements: 2.1, 2.2_

  - [ ] 3.4 Implement bounds validation in propose_fee function
    - Edit `contract/src/fee.rs` in the `propose_fee` function
    - Order of validation (critical for correct error reporting):
      1. Check admin authorization (require_admin - existing)
      2. Retrieve min_bps and max_bps using new helper functions
      3. Validate: `bps >= min_bps AND bps <= max_bps`
      4. If validation fails, panic with ContractError::OutOfBoundsFee (BEFORE storing pending fee)
      5. Check if bps > 10_000 and panic with InvalidFeeBps (existing check)
      6. Store pending fee, emit event, extend TTL (existing logic)
    - Bounds check happens AFTER admin auth but BEFORE storing pending fee
    - No pending fee is stored when bounds validation fails
    - _Bug_Condition: isBugCondition(input) = (bps < MinFeeBps OR bps > MaxFeeBps) AND bps <= 10_000_
    - _Expected_Behavior: expectedBehavior(result) = OutOfBoundsFee error && NO pending fee stored_
    - _Preservation: In-bounds proposals stored, absolute max validation preserved, admin auth preserved_
    - _Requirements: 2.1, 2.2, 2.7, 2.8, 3.1, 3.3, 3.5_

  - [ ] 3.5 Add set_fee_bounds() governance function
    - Edit `contract/src/fee.rs`
    - Add `set_fee_bounds(env: &Env, min_bps: u32, max_bps: u32)` function
      - Require admin authorization (admin::require_admin)
      - Validate that min_bps <= max_bps (panic if invalid)
      - Validate that max_bps <= 10_000 (panic if exceeds absolute maximum)
      - Store min_bps at DataKey::MinFeeBps in instance storage
      - Store max_bps at DataKey::MaxFeeBps in instance storage
      - Extend TTL for both storage keys
      - Call `crate::events::publish_fee_bounds_set(env, min_bps, max_bps)` to emit event
    - _Bug_Condition: Admin must be able to establish bounds_
    - _Expected_Behavior: Bounds stored securely in instance storage_
    - _Preservation: No impact on other functions_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.6 Add get_fee_bounds() query function
    - Edit `contract/src/fee.rs`
    - Add `get_fee_bounds(env: &Env) -> (u32, u32)` function
      - Retrieve min_bps and max_bps using helper functions (which provide defaults)
      - Return tuple (min_bps, max_bps)
    - _Bug_Condition: Admin needs to verify bounds are set correctly_
    - _Expected_Behavior: Bounds returned with defaults if unset_
    - _Preservation: Query-only, no impact on other functions_
    - _Requirements: 2.3_

  - [ ] 3.7 Add contract interface methods in lib.rs
    - Edit `contract/src/lib.rs` in the `FlowPayClient` impl block
    - Add public method `set_fee_bounds(env: Env, min_bps: u32, max_bps: u32)`
      - Call admin::require_admin(&env)
      - Call fee::set_fee_bounds(&env, min_bps, max_bps)
      - Emit event
    - Add public method `get_fee_bounds(env: Env) -> (u32, u32)`
      - Call fee::get_fee_bounds(&env)
      - Return current bounds (with defaults if unset)
    - Place these near existing fee-related methods (propose_fee, commit_fee, get_fee)
    - _Bug_Condition: Contract interface needed to set and query bounds_
    - _Expected_Behavior: Methods available and properly routed to fee module_
    - _Preservation: Existing fee methods unchanged_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.8 Add fee_bounds_set event to events module
    - Edit `contract/src/events.rs`
    - Add `publish_fee_bounds_set(env: &Env, min_bps: u32, max_bps: u32)` function
      - Emit event with topic: "fee_bounds_set"
      - Include min_bps and max_bps in event data
      - Follow existing fee event pattern
    - _Bug_Condition: Event published when bounds are updated_
    - _Expected_Behavior: Bounds changes tracked in blockchain history_
    - _Preservation: Existing events unchanged_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.9 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Fee Proposal Bounds Validation
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run the bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - Verify that out-of-bounds proposals are now rejected with OutOfBoundsFee error
    - Verify that no pending fee is stored for out-of-bounds proposals
    - _Requirements: Expected Behavior Properties: 2.1, 2.2, 2.7, 2.8_

  - [ ] 3.10 Verify preservation tests still pass
    - **Property 2: Preservation** - Valid Fee Proposal Acceptance and In-Bounds Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Verify in-bounds proposals still succeed and store pending fee
    - Verify unset bounds defaults work correctly (0 to 10_000)
    - Verify absolute maximum validation (bps > 10_000) still rejects with InvalidFeeBps
    - Verify admin authorization still enforced
    - Verify boundary cases (exact min and max) still accepted
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

## Phase 4: Checkpoint & Validation

- [ ] 4. Checkpoint - Ensure all tests pass and code compiles
  - Run `cargo build --release --target wasm32-unknown-unknown` in contract directory
    - Verify no compilation errors
    - Verify no warnings that affect correctness
  - Run `cargo test` to execute full test suite
    - Verify all existing tests pass (no regressions)
    - Verify bug condition test passes (confirms bug is fixed)
    - Verify preservation tests pass (confirms no regressions)
  - Verify error codes documented (check docs/ERROR-CODES.md if it exists)
    - If ERROR-CODES.md exists, add entry for OutOfBoundsFee with code number and description
  - Ensure all storage keys are properly used (MinFeeBps, MaxFeeBps)
  - Confirm no panics for non-error conditions
  - Mark complete when all tests pass and code compiles without errors
  - _Requirements: 2.1, 2.2, 2.3, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5_

