# Global Volume Check Ordering - Bugfix Design

## Overview

The PayFlow contract's hourly volume capacity check (`GLOBAL_MAX_VOLUME_PER_HOUR = 50 trillion stroops`) currently runs **AFTER** token transfers in both `charge()` and `pay_per_use()` paths. When the cap is exceeded, transfers have already been initiated before rejection occurs, violating fail-closed semantics and creating inconsistent state.

This design reorders volume checks to execute **BEFORE** any token transfers, ensuring:
- Atomic fail-closed behavior: volume checks succeed before any state mutation
- Consistency between simulate and execute paths
- Clear separation: capacity reserve before transfers, window updates only on success

## Glossary

- **Bug_Condition (C)**: Inputs where token transfers occur before global volume capacity is verified
- **Property (P)**: Correct behavior when cap is enforced: checks occur atomically before transfers
- **Preservation**: Existing behavior for transactions within capacity and window rollover logic
- **check_and_update_global_volume**: Helper function in `contract/src/lib.rs` that verifies and updates `GlobalVolumeWindow` state
- **charge()**: Function in `contract/src/lib.rs` that triggers recurring subscription charges
- **pay_per_use()**: Function in `contract/src/lib.rs` that executes immediate one-off payments
- **batch_charge()**: Function accessed via `contract/src/batch.rs` that charges multiple users
- **GlobalVolumeWindow**: Storage struct tracking `current_window_start` and `accumulated_volume`
- **GLOBAL_MAX_VOLUME_PER_HOUR**: Constant = 50 trillion stroops, the hourly cap
- **HOUR_IN_SECONDS**: Constant = 3600, defines window rollover interval
- **execute_charge()**: Function in `contract/src/charge_exec.rs` that handles post-transfer bookkeeping

## Bug Details

### Bug Condition

The bug manifests when a user attempts a charge or pay-per-use transaction that would exceed the `GLOBAL_MAX_VOLUME_PER_HOUR` cap. The system is either not correctly checking the cap before transfer initiation, or is allowing token movement to begin before enforcing the constraint.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type {transaction_type: "charge" | "pay_per_use", amount: i128}
  OUTPUT: boolean
  
  RETURN current_window_accumulated_volume + input.amount > GLOBAL_MAX_VOLUME_PER_HOUR
         AND window_hour_boundary_not_crossed
         AND input.amount > 0
END FUNCTION
```

### Examples

**Example 1: Over-cap charge (defective behavior)**
- Current window accumulated volume: 49.5T stroops
- User attempts charge: 1T stroops
- Expected: Reject before transfer, return GlobalVolumeExceeded
- Actual (defective): transfer_from() called, then panic after payment attempt

**Example 2: Over-cap pay-per-use with fee (defective behavior)**
- Current window accumulated volume: 49.99T stroops
- User attempts pay-per-use: 0.2T stroops (with 100 bps fee = 0.002T)
- Expected: Reject before any transfers, return GlobalVolumeExceeded
- Actual (defective): fee transfer to collector initiated, then merchant transfer initiated, then panic

**Example 3: Exact capacity boundary (edge case)**
- Current window accumulated volume: 49.99T stroops
- User attempts charge: 1.01T stroops (total = 50T exactly)
- Expected: Permit charge, update volume to 50T
- Actual (edge case at boundary): Should accept, not reject

**Example 4: Over boundary by one stroops (edge case)**
- Current window accumulated volume: 49.99T stroops
- User attempts charge: 1.01000001T stroops (total = 50T + 1 stroops)
- Expected: Reject before transfer
- Actual (edge case): Should reject

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

1. Successful charges within capacity shall continue to transfer the full subscription amount to the merchant
2. Successful pay-per-use with protocol fees shall continue to transfer fees to collector and remaining amount to merchant
3. Window rollover at `current_time >= window_start + HOUR_IN_SECONDS` shall continue to reset `accumulated_volume` to 0
4. Multiple charges within the same hour shall continue to accumulate volumes correctly
5. Charges within capacity shall continue to update subscription state, record charge history, and emit events
6. Pay-per-use within capacity shall continue to record daily limits, merchant revenue, and emit events
7. Contract pause shall continue to reject all charges before cap check or transfer

**Scope:**

All transactions where `new_volume <= GLOBAL_MAX_VOLUME_PER_HOUR` should be completely unaffected by this fix. All window rollover calculations, event emission, revenue tracking, and subscription state updates for successful charges shall remain unchanged.

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **Incorrect Check Placement**: `check_and_update_global_volume()` is currently called in `charge()` at line 367 AFTER `token.transfer_from()` at line 361-365, and in `pay_per_use()` at line 460 AFTER both fee and merchant transfers. The check should execute before any transfer initiation.

2. **Batch Charge Atomicity**: The `batch_charge()` function in `contract/src/batch.rs` calls `charge_exec::execute_charge()` which performs transfers via `fee::transfer_subscription_charge()`. Volume checks are not applied in the batch path at all, creating vulnerability to cap bypass.

3. **Fee Transfer Isolation**: In `pay_per_use()`, the fee transfer happens separately from the merchant transfer. If the fee transfer succeeds but volume check fails, partial state mutation occurs. The volume check must precede both transfers.

4. **Window Rollover Interleaving**: The `check_and_update_global_volume()` function checks the window boundary and resets if needed. If this reset interleaves with transfers, window state may become inconsistent. The entire check-and-update must be atomic before any transfer.

## Correctness Properties

Property 1: Bug Condition - Global Volume Cap Enforcement Before Transfer

_For any_ transaction where the bug condition holds (accumulated volume + amount would exceed GLOBAL_MAX_VOLUME_PER_HOUR), the fixed charge() and pay_per_use() functions SHALL check the capacity constraint and reject the transaction before any token transfer is initiated, transferring zero tokens and panicking with GlobalVolumeExceeded error.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-Over-Cap Transactions

_For any_ transaction where the bug condition does NOT hold (accumulated volume + amount <= GLOBAL_MAX_VOLUME_PER_HOUR and window boundary not crossed), the fixed code SHALL produce exactly the same result as the original code for transactions within capacity, including token transfers, state updates, event emission, and all side effects.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `contract/src/lib.rs`

**Function**: `charge()` (lines 327-379)

**Specific Changes**:

1. **Move volume check before transfer in charge()**:
   - After grace period validation (line 354), call `check_and_update_global_volume(&env, sub.amount)` 
   - Move this to line ~355 (immediately after grace period check, before token client instantiation)
   - This ensures cap verification before `token.transfer_from()` is called
   - If cap is exceeded, function panics with GlobalVolumeExceeded before line 360

2. **Reorder charge() execution sequence**:
   - Current: require_active → execute_charge → check_and_update_global_volume
   - Desired: require_active → grace_check → check_and_update_global_volume → token.transfer_from → execute_charge
   - Ensure execute_charge is only called when cap check has succeeded

3. **Move volume check before fee transfer in pay_per_use()**:
   - After spending_limit enforcement (line 439), call `check_and_update_global_volume(&env, amount)`
   - Move this to line ~440 (immediately after spending_limit check, before token client instantiation)
   - This ensures cap verification before fee or merchant transfers
   - Window must be checked and updated atomically before any fee::transfer_* calls

4. **Ensure batch_charge() applies volume checks**:
   - Currently `batch_charge()` → `charge_exec::precheck_charge()` → `charge_exec::execute_charge()`
   - Volume checks are completely bypassed in batch path
   - Modify `charge_exec::execute_charge()` to accept pre-verified capacity or add pre-check in batch loop
   - Option A: Add volume check before `execute_charge()` call in `batch.rs` (line 42)
   - Option B: Move volume check into `execute_charge()` as first operation
   - Recommended: Option A (pre-check in batch loop) to maintain single check location and fail-closed semantics

### Implementation Details

**In `charge()` function:**
```
Line 327: pub fn charge(env: Env, user: Address) {
  ...
  Line 354: if grace_period > 0 && now > next + grace_period { ... }
  
  NEW: Line 355: check_and_update_global_volume(&env, sub.amount);
  
  Line 357 (was 355): let token = token::Client::new(...);
  Line 358-362: token.transfer_from(...);
  Line 365 (was 367): REMOVE check_and_update_global_volume(&env, sub.amount);
  ...
}
```

**In `pay_per_use()` function:**
```
Line 409: pub fn pay_per_use(env: Env, user: Address, amount: i128) {
  ...
  Line 439: spending_limit::enforce_limit(&env, &user, amount);
  
  NEW: Line 440: check_and_update_global_volume(&env, amount);
  
  Line 442 (was 440): let token = token::Client::new(...);
  Line 444-458: fee and merchant transfers
  Line 460 (was 460): REMOVE check_and_update_global_volume(&env, amount);
  ...
}
```

**In `batch.rs` function:**
```
Line 29: pub fn batch_charge(env: &Env, users: Vec<Address>) -> Vec<ChargeResult> {
  ...
  Line 42: for user in users.iter() {
    NEW: Add volume check before execute_charge:
      if let Ok(()) = precheck_charge(...) {
        check_and_update_global_volume(env, sub.amount); // ADD THIS
        charge_exec::execute_charge(env, &user, &key, &mut sub, now);
      }
  ...
}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a three-phase approach:
1. **Exploratory**: Verify the bug exists on unfixed code by demonstrating over-cap attempts transfer tokens
2. **Fix Checking**: Verify fixed code rejects over-cap attempts before transfer
3. **Preservation Checking**: Verify fixed code preserves all existing behavior for within-cap transactions

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate transactions at or exceeding the hourly volume cap and assert that over-cap transactions fail after observing transfer attempts on unfixed code.

**Test Cases**:

1. **Single Over-Cap Charge Test**: Set accumulated volume to 49.5T, attempt 1T charge
   - Unfixed code: transfer_from is called (observable via mock), then panics
   - Expected counterexample: Transfer initiated before cap rejection

2. **Over-Cap Pay-Per-Use with Fee Test**: Set accumulated volume to 49.99T, attempt 0.2T with 100 bps fee
   - Unfixed code: fee transfer_from called, then merchant transfer_from called, then panics
   - Expected counterexample: Fee transfer initiated before cap rejection

3. **Exact Boundary Test**: Set accumulated volume to 49T, attempt 1T charge (total = 50T exactly)
   - Unfixed code: Should accept (currently panics if check runs after transfer)
   - Expected counterexample: Either accepts (correct) or rejects after transfer (buggy)

4. **Batch Over-Cap Test**: Set accumulated volume to 49.5T, batch charge multiple users where one exceeds cap
   - Unfixed code: Batch bypasses volume check entirely, all transfers occur
   - Expected counterexample: No volume check, all users charged regardless of cap

**Expected Counterexamples**:
- Token transfers occur via transfer_from before GlobalVolumeExceeded panic
- Batch charges bypass volume checks entirely
- Possible causes: Volume check placement after transfers, missing checks in batch path

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior (rejects before transfer).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := charge_fixed(input) OR pay_per_use_fixed(input)
  ASSERT result == GlobalVolumeExceeded
  ASSERT no token.transfer_from was called
  ASSERT window.accumulated_volume unchanged
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  original_result := charge_original(input) OR pay_per_use_original(input)
  fixed_result := charge_fixed(input) OR pay_per_use_fixed(input)
  ASSERT original_result == fixed_result
  ASSERT token transfers identical
  ASSERT window.accumulated_volume identical
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across valid transaction space
- It catches edge cases near boundaries that manual tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs
- It can randomize window states and transaction amounts to verify consistency

**Test Plan**: 
1. Generate random initial window states (various accumulated volumes and window timestamps)
2. Generate random valid transactions (amounts within cap)
3. Run both original and fixed implementations
4. Assert identical outcomes for transfers, state, and events
5. Run on multiple window rollover scenarios

**Test Cases**:

1. **Within-Cap Charge Preservation**: 
   - Verify charges below cap continue to transfer exact subscription amounts
   - Verify last_charged, history, and revenue tracking unchanged

2. **Within-Cap Pay-Per-Use Preservation**: 
   - Verify pay-per-use below cap continues to transfer fees and merchant amounts correctly
   - Verify spending limits recorded unchanged

3. **Window Rollover Preservation**: 
   - Cross window boundary and verify new hour resets accumulated_volume
   - Multiple transactions spanning boundary all handled correctly

4. **Batch Charge Preservation**: 
   - Multiple users charged within cap all succeed
   - Individual failures within batch still recorded correctly
   - Volume accumulates correctly across batch

5. **Fee Transfer Preservation**: 
   - Protocol fees calculated and transferred correctly for within-cap pay-per-use
   - Net amounts to merchant correct

6. **Exact Boundary Acceptance**: 
   - Transaction bringing accumulated volume to exactly GLOBAL_MAX_VOLUME_PER_HOUR accepts
   - Transaction bringing it to exactly + 1 stroops rejects

### Unit Tests

- Test volume check with initial window (new hour, volume = 0)
- Test volume check near window boundary (crossing HOUR_IN_SECONDS)
- Test volume window reset on hour boundary crossing
- Test overflow prevention when accumulated_volume + amount overflows
- Test charge succeeds and persists volume update
- Test pay-per-use succeeds and persists volume update
- Test batch processes users and accumulates volumes correctly
- Test each over-cap scenario rejects without state mutation

### Property-Based Tests

- **Property 1**: For random within-cap transactions, fixed and original implementations produce identical results
- **Property 2**: For over-cap transactions, fixed implementation rejects before any transfer
- **Property 3**: Window rollover correctly resets volume across random timestamps
- **Property 4**: Volume accumulates correctly across sequences of transactions
- **Property 5**: Batch operations respect accumulated volume across multiple users
- **Property 6**: Exact capacity boundary (accumulated + amount == cap) accepts; (accumulated + amount > cap) rejects

### Integration Tests

- Full transaction flow: subscribe → charge (within cap) → verify revenue recorded
- Full transaction flow: pay-per-use (within cap) → verify daily limits and merchant revenue
- Multiple sequential charges accumulating volume within hour
- Multiple charges crossing hour boundary with volume reset
- Batch charge with mixed results (some skip, some charged, all within cap)
- Batch charge with over-cap user in batch (verify rejection before transfer)
