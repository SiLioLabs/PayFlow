# Implementation Plan: Global Volume Check Ordering

## Phase 1: Exploration - Bug Condition Testing (BEFORE FIX)

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Over-Cap Volume Rejection Atomicity
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate over-cap transactions transfer tokens BEFORE cap rejection
  - **Scoped PBT Approach**: Scope the property to the concrete failing case of amounts exceeding GLOBAL_MAX_VOLUME_PER_HOUR to ensure reproducibility
  - Test implementation details from Bug Condition in design:
    - Set accumulated window volume to known values approaching the 50T cap
    - Attempt charge/pay_per_use amounts that breach the cap
    - Assert that GlobalVolumeExceeded is returned WITHOUT any token transfers being executed
    - Verify accumulated_volume remains unchanged when cap is breached
  - The test assertions should match the Expected Behavior Properties from design (Requirements 2.1, 2.2, 2.3)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with observable token transfers occurring before cap rejection panic (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause:
    - Over-cap charge: transfers occur then panic with GlobalVolumeExceeded
    - Over-cap pay-per-use with fee: fee transfer occurs, merchant transfer occurs, then panic
    - Batch charges: volume checks bypassed entirely, all transfers succeed regardless of cap
  - Mark task complete when test is written, run, and failure is documented with counterexamples
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Within-Cap Transactions Preserve Existing Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (transactions within capacity):
    - Within-cap charges: transfer full subscription amount to merchant, update last_charged, record history, emit event
    - Within-cap pay-per-use with fees: transfer fees to collector, transfer net to merchant, record daily limits
    - Window rollover: crossing HOUR_IN_SECONDS boundary resets accumulated_volume to 0
    - Batch charges: multiple within-cap users all get charged, volumes accumulate correctly
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements (Requirements 3.1-3.7):
    - For any within-cap transaction: transfers succeed with correct amounts
    - For any within-cap charge: subscription state updates (last_charged), charge history recorded
    - For any within-cap pay-per-use: merchant revenue and daily spend recorded
    - For any sequence crossing window boundary: accumulated volume resets correctly
    - For contract pause: all charges/pay-per-use rejected before cap check
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

## Phase 2: Implementation - Fix Global Volume Check Ordering

- [ ] 3. Fix for global volume check ordering

  - [ ] 3.1 Move volume check before token transfer in charge()
    - In `contract/src/lib.rs`, locate `charge()` function (around line 327)
    - Find grace period validation at line 354: `if grace_period > 0 && now > next + grace_period`
    - Immediately after grace period check completes (line 354), add: `check_and_update_global_volume(&env, sub.amount);`
    - This call must occur BEFORE line 361 where `token.transfer_from()` is called
    - Then remove the duplicate `check_and_update_global_volume(&env, sub.amount);` call that currently appears at line 367 (after the transfer)
    - Result: cap enforcement atomically occurs before transfer initiation, failing closed
    - _Bug_Condition: accumulated_volume + sub.amount > GLOBAL_MAX_VOLUME_PER_HOUR_
    - _Expected_Behavior: check_and_update_global_volume executes before transfer, GlobalVolumeExceeded panic occurs before token movement_
    - _Preservation: within-cap charges continue with identical transfer amounts, state updates, and event emission_
    - _Requirements: 2.1, 2.3, 3.1, 3.5_

  - [ ] 3.2 Move volume check before fee/merchant transfers in pay_per_use()
    - In `contract/src/lib.rs`, locate `pay_per_use()` function (around line 409)
    - Find spending limit enforcement at line 439: `spending_limit::enforce_limit(&env, &user, amount);`
    - Immediately after spending limit check completes (line 439), add: `check_and_update_global_volume(&env, amount);`
    - This call must occur BEFORE line 444 where first token.transfer_from() is called (fee transfer)
    - This ensures cap is verified before ANY token movement (fee OR merchant transfer)
    - Then remove the duplicate `check_and_update_global_volume(&env, amount);` call that currently appears at line 460 (after transfers)
    - Result: cap enforcement atomically precedes both fee and merchant transfers, failing closed
    - _Bug_Condition: accumulated_volume + amount > GLOBAL_MAX_VOLUME_PER_HOUR_
    - _Expected_Behavior: check_and_update_global_volume executes before transfers, GlobalVolumeExceeded panic occurs before fee or merchant transfer_
    - _Preservation: within-cap pay-per-use continues with identical fee and merchant transfers, daily limits, and event emission_
    - _Requirements: 2.2, 2.3, 3.2, 3.6_

  - [ ] 3.3 Add volume check in batch_charge() path before execute_charge calls
    - In `contract/src/batch.rs`, locate `batch_charge()` function (around line 26)
    - Find the charge loop at line 42: `for user in users.iter()`
    - Inside the loop where `precheck_charge()` succeeds (after line 40 Ok(()) branch)
    - Before calling `charge_exec::execute_charge()` at line 41, add: `check_and_update_global_volume(env, sub.amount);`
    - This ensures batch path also validates capacity before execution, preventing cap bypass
    - If check fails with GlobalVolumeExceeded panic, the batch terminates (fail-closed for that user and remaining batch)
    - Result: batch operations respect global volume cap across multiple users
    - _Bug_Condition: batch path bypasses volume checks entirely, allowing multiple users to charge regardless of cap_
    - _Expected_Behavior: volume check occurs in batch loop before execute_charge, over-cap users fail with GlobalVolumeExceeded_
    - _Preservation: within-cap batch users continue to charge successfully with volumes accumulating across batch_
    - _Requirements: 2.1, 2.2, 3.4_

  - [ ] 3.4 Verify atomicity of window check-and-update with transfer operations
    - Review `check_and_update_global_volume()` implementation to ensure:
      - Window boundary check occurs atomically with accumulated_volume read
      - If window boundary crossed, accumulated_volume is reset to 0 AND new window_start is set in same operation
      - No interleaving between window boundary detection and volume accumulation is possible
      - Once volume check passes, the updated window state is persisted before any transfer occurs
    - Confirm `check_and_update_global_volume()` is called in all three paths (charge, pay_per_use, batch_charge) BEFORE transfers
    - Verify no code path allows token transfer if `check_and_update_global_volume()` panics
    - _Preservation: window rollover behavior continues to correctly reset volumes at hour boundaries_
    - _Requirements: 3.3_

  - [ ] 3.5 Ensure GlobalVolumeExceeded error returns to callers and panics consistently
    - Verify that when `check_and_update_global_volume()` detects over-cap (accumulated + amount > GLOBAL_MAX_VOLUME_PER_HOUR), it panics with `GlobalVolumeExceeded`
    - Confirm this panic occurs BEFORE any transfers in charge(), pay_per_use(), and batch_charge() paths
    - This ensures callers receive the GlobalVolumeExceeded error atomically before any state mutation
    - _Expected_Behavior: GlobalVolumeExceeded panic prevents transaction from proceeding to transfer stage_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.6 Verify no state mutations occur after over-cap rejection
    - In charge() path: ensure `execute_charge()` is NOT called if volume check fails (fails before that call)
    - In pay_per_use() path: ensure merchant revenue, spending limits, and events are NOT recorded if volume check fails
    - In batch_charge() path: ensure subscription state is NOT updated if volume check fails for a user
    - Confirm that GlobalVolumeExceeded panic short-circuits the entire transaction before post-transfer bookkeeping
    - _Expected_Behavior: over-cap rejection atomically prevents all state changes_
    - _Requirements: 2.3_

## Phase 3: Validation - Verify Fix and Preservation

- [ ] 4. Verify bug condition exploration test now passes

  - [ ] 4.1 Re-run bug condition exploration test from Phase 1
    - **Property 1: Expected Behavior** - Over-Cap Volume Rejection Atomicity (Fixed)
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior - it should now pass
    - When this test passes, it confirms the expected behavior is satisfied (cap checks precede transfers)
    - Run bug condition exploration test from step 1 on FIXED code
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed - over-cap transactions now reject before transfer)
    - Assert: GlobalVolumeExceeded panic occurs without any token.transfer_from being called
    - Assert: accumulated_volume remains unchanged when cap is breached
    - Document fix validation: test pass confirms over-cap handling now atomic and fail-closed
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 4.2 Verify no partial transfers on over-cap rejection
    - For over-cap charge: assert zero tokens transferred to merchant
    - For over-cap pay-per-use with fee: assert zero tokens to both collector AND merchant
    - For batch with over-cap user: assert no transfers for that user or remaining batch users after over-cap
    - Use balance assertions: `token.balance(merchant_before) == token.balance(merchant_after)`
    - Confirms that GlobalVolumeExceeded rejection is fail-closed with zero state mutation
    - _Requirements: 2.1, 2.2_

- [ ] 5. Verify preservation tests still pass

  - [ ] 5.1 Re-run preservation property tests from Phase 1
    - **Property 2: Preservation** - Within-Cap Transactions Preserve Existing Behavior (Fixed)
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2 on FIXED code
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions - within-cap behavior unchanged)
    - Verify for all within-cap transactions:
      - Token transfer amounts identical to unfixed code
      - Merchant revenue recorded identically
      - Fee transfers (if applicable) occur identically
      - Subscription state updates (last_charged, history) identical
      - Events emitted identically
      - Window rollover behavior unchanged
      - Batch operations accumulate volumes correctly
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ] 5.2 Verify exact capacity boundary handling
    - Test transaction bringing accumulated volume to exactly GLOBAL_MAX_VOLUME_PER_HOUR accepts
    - Test transaction bringing accumulated volume to exactly + 1 stroops rejects before transfer
    - Assert: 49.99T volume + 1.01T charge (total = 50T exactly) → accepts and transfers
    - Assert: 49.99T volume + 1.010001T charge (total = 50T + 1 stroops) → rejects before transfer
    - Confirms boundary arithmetic correct and fail-closed at boundary
    - _Requirements: 2.4, 2.5_

- [ ] 6. Checkpoint - Ensure all tests pass and build succeeds

  - [ ] 6.1 Run full contract test suite
    - Execute: `cargo test` in contract directory
    - Verify: All existing tests pass (no regressions introduced by reordering)
    - Verify: Bug condition exploration test passes (bug is fixed)
    - Verify: Preservation tests pass (no behavioral changes to within-cap transactions)
    - If any test fails, diagnose and confirm fix is correct before proceeding
    - _Requirements: All requirements validated_

  - [ ] 6.2 Verify contract builds without errors
    - Execute: `cargo build --release --target wasm32-unknown-unknown` in contract directory
    - Confirm: No compilation errors or warnings related to volume check reordering
    - Confirm: WASM binary is generated successfully
    - _Requirements: Implementation complete and validated_

  - [ ] 6.3 Verify simulate_charge alignment with execute behavior (optional)
    - If `simulate_charge()` function exists and performs pre-transfer validation:
      - Verify `simulate_charge()` applies volume checks identically to `charge()`
      - Confirm simulate and execute paths now aligned: both check volume before reporting success
      - This ensures callers can rely on simulate results to predict execute outcomes
    - _Requirements: 2.1 (consistency between paths)_
