# Bugfix Requirements: Fee Bounds Validation

## Introduction

The PayFlow protocol currently lacks governance guardrails for fee proposals. While `set_fee_bounds` is intended to establish MinFeeBps and MaxFeeBps constraints, the `propose_fee` function does not validate proposals against these bounds, allowing admins to bypass governance controls and propose arbitrary fee values. This bugfix ensures that `propose_fee` rejects out-of-bounds proposals with a typed error before storing the pending fee, while preserving all other contract behavior.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an admin proposes a fee with bps < MinFeeBps (when bounds are set) THEN the system accepts the proposal without validation and stores it as a pending fee

1.2 WHEN an admin proposes a fee with bps > MaxFeeBps (when bounds are set) THEN the system accepts the proposal without validation and stores it as a pending fee

1.3 WHEN MinFeeBps is equal to MaxFeeBps THEN the system accepts any proposal matching that value, but also accepts proposals outside this exact value without rejection

1.4 WHEN MinFeeBps and MaxFeeBps bounds have been set to specific values (e.g., 50 and 200) THEN a proposal of bps = 25 (below minimum) is stored as pending without error

1.5 WHEN MinFeeBps and MaxFeeBps bounds have been set to specific values (e.g., 50 and 200) THEN a proposal of bps = 250 (above maximum) is stored as pending without error

### Expected Behavior (Correct)

2.1 WHEN an admin proposes a fee with bps < MinFeeBps (when bounds are set) THEN the system SHALL reject the proposal with a typed ContractError (OutOfBoundsFee or similar) and NOT store the pending fee

2.2 WHEN an admin proposes a fee with bps > MaxFeeBps (when bounds are set) THEN the system SHALL reject the proposal with a typed ContractError (OutOfBoundsFee or similar) and NOT store the pending fee

2.3 WHEN MinFeeBps is equal to MaxFeeBps THEN the system SHALL accept only proposals matching that exact value and reject all others with a typed error

2.4 WHEN MinFeeBps and MaxFeeBps bounds have been set to specific values (e.g., 50 and 200) THEN a proposal of bps = 50 (at minimum boundary) SHALL succeed and be stored as pending

2.5 WHEN MinFeeBps and MaxFeeBps bounds have been set to specific values (e.g., 50 and 200) THEN a proposal of bps = 200 (at maximum boundary) SHALL succeed and be stored as pending

2.6 WHEN MinFeeBps and MaxFeeBps bounds have been set to specific values (e.g., 50 and 200) THEN a proposal of bps = 125 (between min and max) SHALL succeed and be stored as pending

2.7 WHEN an admin proposes a fee with bps < MinFeeBps THEN the system SHALL return a typed ContractError (not a panic)

2.8 WHEN an admin proposes a fee with bps > MaxFeeBps THEN the system SHALL return a typed ContractError (not a panic)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN bps > 10_000 is proposed (absolute maximum) THEN the system SHALL CONTINUE TO reject with InvalidFeeBps error regardless of bounds settings

3.2 WHEN bounds are unset (defaults: MinFeeBps=0, MaxFeeBps=10_000) THEN the system SHALL CONTINUE TO accept any proposal with 0 <= bps <= 10_000

3.3 WHEN a valid pending fee exists and commit_fee is called THEN the system SHALL CONTINUE TO successfully commit the fee without changes

3.4 WHEN get_fee is called THEN the system SHALL CONTINUE TO return the committed fee (collector, bps) or None if unset

3.5 WHEN a non-admin calls propose_fee THEN the system SHALL CONTINUE TO reject with admin authorization error

3.6 WHEN propose_fee is called with a self-collector (user == collector) THEN the system SHALL CONTINUE TO reject (if this validation exists in current code)

3.7 WHEN charging a subscription with a committed fee THEN the system SHALL CONTINUE TO calculate and deduct fees correctly

3.8 WHEN paying per use with a committed fee THEN the system SHALL CONTINUE TO calculate and deduct fees correctly
