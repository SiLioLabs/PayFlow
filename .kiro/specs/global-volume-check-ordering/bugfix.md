# Bugfix Requirements: Global Volume Check Ordering

## Introduction

The PayFlow contract performs hourly volume capacity checks via `check_and_update_global_volume()` to enforce the `GLOBAL_MAX_VOLUME_PER_HOUR` (50 trillion stroops) limit. Currently, this check runs **AFTER** token transfers in both `charge()` and `pay_per_use()` paths. When the cap is breached, a panic occurs after transfers have already been initiated, violating fail-closed expectations. The fix reorders checks to run **BEFORE** any token transfers, ensuring atomic fail-closed behavior and alignment between simulate/execute paths.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN attempting a charge that would exceed the hourly volume cap THEN the system transfers tokens to the merchant before checking the cap, then panics after transfer attempt, resulting in inconsistent state and violated fail-closed expectations

1.2 WHEN attempting a pay-per-use transaction that would exceed the hourly volume cap THEN the system transfers tokens (and protocol fees to the fee collector if applicable) before checking the cap, then panics, leaving partial transfers in-flight

1.3 WHEN the volume cap is breached in `charge()` path THEN the `execute_charge()` function is called even though the transaction fails, causing additional state mutations after cap panic

1.4 WHEN operating at or near the exact hourly capacity THEN transfer attempts may partially commit before cap check rejects them, creating race conditions between cap enforcement and token movement

### Expected Behavior (Correct)

2.1 WHEN attempting a charge that would exceed the hourly volume cap THEN the system SHALL check capacity and reject before any token transfer is initiated, transferring zero tokens and panicking with `GlobalVolumeExceeded`

2.2 WHEN attempting a pay-per-use transaction that would exceed the hourly volume cap THEN the system SHALL check capacity and reject before any token transfer (merchant or fee transfer) is initiated, transferring zero tokens and panicking with `GlobalVolumeExceeded`

2.3 WHEN a charge would exceed the cap THEN the system SHALL NOT call `execute_charge()` and SHALL NOT mutate subscription state, allowing the transaction to fail atomically before any state changes

2.4 WHEN the accumulated volume plus the requested amount exactly equals the cap THEN the system SHALL permit the charge and update volume, accepting it at the boundary

2.5 WHEN the accumulated volume plus the requested amount exceeds the cap by one stroops THEN the system SHALL reject the charge before any transfer and panic with `GlobalVolumeExceeded`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a charge is within capacity THEN the system SHALL CONTINUE TO transfer the full subscription amount to the merchant and record it in revenue tracking

3.2 WHEN a pay-per-use with protocol fees is within capacity THEN the system SHALL CONTINUE TO transfer fees to the fee collector and the remaining amount to the merchant as before

3.3 WHEN the hourly window boundary is crossed (current_time >= window_start + HOUR_IN_SECONDS) THEN the system SHALL CONTINUE TO reset accumulated_volume to zero and start a new window

3.4 WHEN multiple charges are attempted within the same hour THEN the system SHALL CONTINUE TO accumulate volumes correctly, rejecting only when the cumulative total exceeds the cap

3.5 WHEN a subscription is charged successfully THEN the system SHALL CONTINUE TO update `last_charged`, record charge history, emit events, and maintain all existing side effects

3.6 WHEN a pay-per-use is successful THEN the system SHALL CONTINUE TO record spending limits, merchant revenue, daily limits, and emit events as before

3.7 WHEN the contract is paused THEN the system SHALL CONTINUE TO reject all charge and pay-per-use attempts before any cap check or transfer
