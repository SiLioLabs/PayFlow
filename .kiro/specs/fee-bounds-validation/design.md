# Fee Bounds Validation Bugfix Design

## Overview

The PayFlow protocol currently allows admins to bypass fee governance controls by proposing fee values outside established bounds. The `propose_fee` function accepts any bps value between 0 and 10,000 without validating against MinFeeBps and MaxFeeBps constraints. This design implements bounds validation in `propose_fee` to reject out-of-bounds proposals with a typed error before storing the pending fee. The fix is minimal and targeted, preserving all existing fee calculation, commit, and charge logic.

## Glossary

- **Bug_Condition (C)**: A fee proposal is made where `bps` is outside the established bounds (bps < MinFeeBps OR bps > MaxFeeBps)
- **Property (P)**: When the bug condition holds, the proposal is rejected with a typed `OutOfBoundsFee` error and no pending fee is stored
- **Preservation**: Existing behavior for in-bounds proposals, unset bounds, absolute maximum validation (bps > 10_000), fee calculation, and commitment logic remains unchanged
- **propose_fee**: Function in `contract/src/fee.rs` that stores a pending fee proposal in temporary storage for later commitment
- **MinFeeBps**: The lower bound for allowed fee proposals, stored in instance storage (defaults to 0 if unset)
- **MaxFeeBps**: The upper bound for allowed fee proposals, stored in instance storage (defaults to 10_000 if unset)
- **Pending fee**: A proposed fee collector address and bps value stored in temporary storage, not yet active until committed

## Bug Details

### Bug Condition

The bug manifests when an admin calls `propose_fee` with a bps value that falls outside the established MinFeeBps and MaxFeeBps bounds. The `propose_fee` function accepts and stores the out-of-bounds proposal without validation, allowing governance controls to be bypassed. The function only checks if `bps > 10_000` (absolute maximum), but does not validate against the configured bounds.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input.bps (u32), MinFeeBps (u32), MaxFeeBps (u32)
  OUTPUT: boolean
  
  RETURN (input.bps < MinFeeBps OR input.bps > MaxFeeBps)
         AND input.bps <= 10_000
         AND (MinFeeBps OR MaxFeeBps has been set via set_fee_bounds)
END FUNCTION
```

### Examples

1. **Below-minimum proposal**: MinFeeBps=50, MaxFeeBps=200, admin proposes bps=25
   - Current behavior: Proposal accepted, stored as pending fee
   - Expected behavior: Proposal rejected with OutOfBoundsFee error

2. **Above-maximum proposal**: MinFeeBps=50, MaxFeeBps=200, admin proposes bps=250
   - Current behavior: Proposal accepted, stored as pending fee
   - Expected behavior: Proposal rejected with OutOfBoundsFee error

3. **Exact boundary (minimum)**: MinFeeBps=50, MaxFeeBps=200, admin proposes bps=50
   - Current behavior: Proposal accepted
   - Expected behavior: Proposal accepted (boundary is inclusive)

4. **Exact boundary (maximum)**: MinFeeBps=50, MaxFeeBps=200, admin proposes bps=200
   - Current behavior: Proposal accepted
   - Expected behavior: Proposal accepted (boundary is inclusive)

5. **Within bounds**: MinFeeBps=50, MaxFeeBps=200, admin proposes bps=125
   - Current behavior: Proposal accepted
   - Expected behavior: Proposal accepted

6. **Unset bounds (default)**: No bounds set, admin proposes bps=500
   - Current behavior: Proposal accepted
   - Expected behavior: Proposal accepted (defaults: MinFeeBps=0, MaxFeeBps=10_000)

7. **Exceeds absolute maximum**: MinFeeBps=0, MaxFeeBps=10_000, admin proposes bps=10_001
   - Current behavior: Rejected with InvalidFeeBps
   - Expected behavior: Rejected with InvalidFeeBps (existing validation preserved)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Proposals with bps > 10_000 continue to be rejected with InvalidFeeBps error
- When bounds are unset, defaults (MinFeeBps=0, MaxFeeBps=10_000) apply
- Valid pending fees continue to be committed successfully via commit_fee
- Fee calculation during charge and pay_per_use continues to work correctly
- Non-admin callers continue to be rejected with admin authorization error
- get_fee continues to return the committed fee (collector, bps) or None if unset

**Scope:**
All inputs that do NOT involve out-of-bounds proposals (relative to MinFeeBps and MaxFeeBps) should be completely unaffected by this fix. This includes:
- In-bounds proposals that pass validation
- Commitment of valid pending fees
- Fee calculations during payments
- Admin authorization checks
- Absolute maximum validation (bps > 10_000)

## Hypothesized Root Cause

Based on the bug description and requirements, the most likely issues are:

1. **Missing Bounds Validation**: The `propose_fee` function only validates against the absolute maximum (10_000) but does not fetch or validate against MinFeeBps and MaxFeeBps storage keys

2. **No Access to Bounds Storage**: Helper functions to retrieve MinFeeBps and MaxFeeBps from instance storage may not exist, requiring new functions to be added

3. **Missing Error Variant**: The `ContractError` enum may not have an `OutOfBoundsFee` variant to represent bounds violations

4. **Validation Placement**: The bounds check needs to be placed after admin authorization but before storing the pending fee to ensure no partial state changes

## Correctness Properties

Property 1: Bug Condition - Fee Proposal Bounds Validation

_For any_ fee proposal where the bps is outside the established bounds (bps < MinFeeBps OR bps > MaxFeeBps), and bps <= 10_000, the fixed propose_fee function SHALL reject the proposal with a typed OutOfBoundsFee error and NOT store the pending fee.

**Validates: Requirements 2.1, 2.2, 2.3, 2.7, 2.8**

Property 2: Preservation - Valid Proposal Acceptance and Unset Bounds Handling

_For any_ fee proposal where the bps is within bounds (MinFeeBps <= bps <= MaxFeeBps), OR when bounds are unset (defaults apply: 0 <= bps <= 10_000), the fixed propose_fee function SHALL succeed, store the pending fee, and preserve all existing behavior including absolute maximum validation and admin authorization.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File 1: `contract/src/errors.rs`**

**Change Category 1 - Add OutOfBoundsFee Error Variant**:
- Add new `OutOfBoundsFee` variant to the `ContractError` enum
- Error code should be assigned from the next available slot
- Error message: "Fee proposal is outside the configured bounds"

**File 2: `contract/src/lib.rs`**

**Change Category 2 - Add Storage Keys for Bounds**:
- Add `MinFeeBps` to the `DataKey` enum (instance storage)
- Add `MaxFeeBps` to the `DataKey` enum (instance storage)

**File 3: `contract/src/fee.rs`**

**Change Category 3 - Add Helper Functions for Bounds**:
- Add `get_min_fee_bps(env: &Env) -> u32` function that retrieves MinFeeBps from instance storage, defaults to 0 if unset
- Add `get_max_fee_bps(env: &Env) -> u32` function that retrieves MaxFeeBps from instance storage, defaults to 10_000 if unset

**Change Category 4 - Implement Bounds Validation in propose_fee**:
- After admin authorization check, retrieve MinFeeBps and MaxFeeBps
- Validate: `bps >= MinFeeBps AND bps <= MaxFeeBps`
- If validation fails, panic with `ContractError::OutOfBoundsFee` (before storing pending fee)
- Preserve existing `bps > 10_000` check (order: bounds check after admin auth, before other operations)

**Change Category 5 - Optional: Add Setter Functions**:
- Add `set_fee_bounds(env: &Env, min_bps: u32, max_bps: u32)` function to allow admin to configure bounds
- Requires admin authorization
- Add corresponding events: `publish_fee_bounds_set(env, min_bps, max_bps)`
- Store in instance storage at `DataKey::MinFeeBps` and `DataKey::MaxFeeBps`

**File 4: `contract/src/lib.rs` (FlowPayClient interface)**

**Change Category 6 - Add Contract Methods**:
- Add `set_fee_bounds(min_bps: u32, max_bps: u32)` as a public contract method
- Add `get_fee_bounds() -> (u32, u32)` as a public contract method to retrieve current bounds

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that set fee bounds, then attempt to propose fees both inside and outside those bounds. Run these tests on the UNFIXED code to observe that out-of-bounds proposals are currently accepted. Observe failures to demonstrate the bug exists.

**Test Cases**:
1. **Below-Minimum Test**: Set bounds (50, 200), propose bps=25, observe that it's accepted on unfixed code (will fail on unfixed code - this is the bug)
2. **Above-Maximum Test**: Set bounds (50, 200), propose bps=250, observe that it's accepted on unfixed code (will fail on unfixed code - this is the bug)
3. **Exact Min Boundary Test**: Set bounds (50, 200), propose bps=50, observe acceptance (should pass on unfixed code)
4. **Exact Max Boundary Test**: Set bounds (50, 200), propose bps=200, observe acceptance (should pass on unfixed code)
5. **In-Range Test**: Set bounds (50, 200), propose bps=125, observe acceptance (should pass on unfixed code)

**Expected Counterexamples**:
- Out-of-bounds proposals (bps < min or bps > max) are accepted when they should be rejected
- No error is returned for out-of-bounds proposals
- The buggy behavior allows governance controls to be bypassed

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL (min_bps, max_bps, proposed_bps) WHERE isBugCondition(proposed_bps) DO
  result := propose_fee_fixed(min_bps, max_bps, proposed_bps)
  ASSERT result == OutOfBoundsFee error
  ASSERT NO pending fee was stored
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL (min_bps, max_bps, proposed_bps) WHERE NOT isBugCondition(proposed_bps) DO
  ASSERT propose_fee_original(min_bps, max_bps, proposed_bps) 
         == propose_fee_fixed(min_bps, max_bps, proposed_bps)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of bounds and proposal values automatically
- It catches edge cases (exact boundaries, unset bounds, default values) that manual tests might miss
- It provides strong guarantees that in-bounds behavior is unchanged for all valid inputs

**Test Plan**: Observe behavior on UNFIXED code for in-bounds proposals, then write property-based tests to verify this continues after the fix.

**Test Cases**:
1. **In-Bounds Acceptance**: Verify that proposals within bounds (MinFeeBps <= bps <= MaxFeeBps) continue to succeed and store pending fee
2. **Unset Bounds Defaulting**: Verify that when bounds are unset, defaults (0, 10_000) apply and in-range proposals succeed
3. **Absolute Maximum Validation**: Verify that bps > 10_000 continues to be rejected with InvalidFeeBps regardless of bounds
4. **Admin Authorization Preservation**: Verify that non-admin calls continue to be rejected
5. **Commitment Preservation**: Verify that valid pending fees can still be committed via commit_fee
6. **Fee Calculation Preservation**: Verify that committed fees are still applied correctly to charges and pay_per_use

### Unit Tests

- Test bounds retrieval (get_min_fee_bps, get_max_fee_bps) with unset values returning defaults
- Test out-of-bounds proposal rejection for each bound violation case
- Test in-bounds proposal acceptance for boundary and mid-range values
- Test that absolute maximum validation (bps > 10_000) still works
- Test that InvalidFeeBps error is returned for bps > 10_000, not OutOfBoundsFee
- Test set_fee_bounds function (if implemented) to verify bounds are stored correctly

### Property-Based Tests

- Generate random bounds (min_bps, max_bps) where min_bps <= max_bps <= 10_000
- Generate random proposal values across the full range [0, 10_001]
- Verify that proposals are accepted iff they fall within the bounds
- Verify that out-of-bounds rejections produce OutOfBoundsFee error
- Verify that in-bounds proposals produce the same behavior as original code
- Test with unset bounds to ensure defaults apply correctly

### Integration Tests

- Test the full fee governance flow: set bounds → propose valid fee → commit → verify fee is active
- Test the full fee governance flow with rejection: set bounds → propose invalid fee → verify rejection → verify no state change
- Test that after rejecting an out-of-bounds proposal, the next valid proposal can be accepted
- Test boundary cases: min=max (exact value only), min=0 (any value up to max), max=10_000 (any value from min)
- Test that existing pending fees work correctly after bounds are set
