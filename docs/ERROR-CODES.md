# Error Codes Reference

This document provides a complete reference for all error codes returned by the FlowPay smart contract. Each error includes a description, common causes, and steps to resolve.

---

## Error Code Table

| Code | Name | Description | Common Causes | Resolution |
| --- | --- | --- | --- | --- |
| 1 | AlreadyInitialized | Returned when attempting to initialize a contract that has already been initialized | Calling `initialize()` more than once | Only call `initialize()` once after deploying the contract |
| 2 | AmountMustBePositive | Returned when a payment or subscription amount is not positive | Setting `amount` to 0 or a negative value in `subscribe()`, `pay_per_use()`, or other payment functions | Ensure all payment amounts are positive values (greater than 0) |
| 3 | IntervalMustBePositive | Returned when a subscription interval is not positive | Setting `interval` to 0 in `subscribe()` | Use a positive interval (minimum 60 seconds, or higher if `set_min_interval()` has been used) |
| 4 | NoSubscriptionFound | Returned when no subscription exists for a given user and token | Calling `charge()`, `pay_per_use()`, `pause()`, `resume()`, or `cancel()` for a user with no active subscription | First subscribe the user before attempting these operations |
| 5 | SubscriptionInactive | Returned when attempting to charge an inactive subscription | Calling `charge()` or `pay_per_use()` on a cancelled subscription | Either re-subscribe the user or verify you are targeting an active subscription |
| 6 | IntervalNotElapsed | Returned when attempting to charge before the interval has elapsed | Calling `charge()` too soon after the last charge | Wait for the full interval to pass before charging again |
| 7 | NotInitialized | Returned when attempting to use contract functionality before initialization | Calling any function before `initialize()` | Call `initialize()` first to set up the contract |
| 8 | InsufficientAllowance | Returned when the user has insufficient token allowance for payment | User hasn't granted enough allowance via the token contract's `approve()` function | Have the user call `approve()` again with a sufficient allowance amount |
| 9 | GracePeriodElapsed | Returned when the grace period for a subscription has elapsed | Calling `charge()` after the grace period window has closed | The subscription has expired. Have the user re-subscribe |
| 10 | MerchantNotWhitelisted | Returned when a merchant is not whitelisted | Subscribing to a non-whitelisted merchant when whitelist is enabled | Either whitelist the merchant via `add_merchant()` or disable the whitelist via `set_whitelist_enabled(false)` |
| 11 | SelfReferral | Returned when a user attempts to refer themselves | Setting referrer to the same address as user in `subscribe()` | Use a different address for the referrer, or omit the referrer |
| 12 | InvalidTokenAddress | Returned when the token address is not a contract | Passing an invalid token address (not a SAC contract) in `initialize()` or `subscribe()` | Use a valid Stellar Asset Contract (SAC) address |
| 13 | InvalidFeeBps | Returned when fee basis points exceed 10000 | Setting `bps` greater than 10000 in `set_fee()` | Ensure fee basis points are between 0 and 10000 inclusive |
| 14 | MetadataLabelTooLong | Returned when the metadata label exceeds the 64-byte length limit | Setting a label longer than 64 bytes in `set_metadata()` | Use a shorter label (max 64 bytes) |
| 15 | AmountExceedsMaximum | Returned when a payment amount is greater than the configured maximum | Using an amount greater than the contract's configured maximum | Use a smaller amount, or adjust the maximum if you're an admin |
| 16 | SubscriptionNotActive | Returned when attempting to operate on a subscription that is not active | Calling `pause()`, `resume()`, or other functions on an inactive subscription | Ensure the subscription is active before operating on it |
| 17 | SubscriptionPaused | Returned when attempting to operate on a subscription that is paused | Calling `charge()` or `pay_per_use()` on a paused subscription | Call `resume()` to unpause the subscription first |
| 18 | ContractPaused | Returned when the contract has been paused by admin | Attempting any operation while the contract is paused | Wait for admin to unpause the contract, or contact admin to unpause it |
| 19 | IntervalTooShort | Returned when a subscription interval is below the minimum permitted floor | Setting an interval below the minimum set via `set_min_interval()` | Use an interval at or above the minimum permitted value |
| 20 | ZeroBalanceAvailable | Returned when a merchant attempts to withdraw with no accrued revenue | Calling `withdraw_merchant_revenue()` when the merchant has no balance | Wait until the merchant has accrued some revenue before withdrawing |
| 22 | MerchantFrozen | Returned when attempting to subscribe to a frozen merchant | Subscribing to a merchant that has been frozen by admin | Use a different merchant, or wait for admin to unfreeze the merchant |
| 23 | NoPendingProposal | Returned when a two-step commit is attempted without a pending proposal | Attempting to accept an admin transfer without a pending proposal | First propose the transfer, then accept it |
