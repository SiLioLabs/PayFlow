# Academy Vesting Contract

`academy-vesting` grants a beneficiary a fixed reward amount that vests over
ledger time. The configured reward token must be funded into the contract
before beneficiaries claim; a shortfall fails atomically with
`InsufficientBalance`.

## Schedule rules

- `amount` must be positive, `cliff <= duration`, and `start_time + duration`
  must fit in `u64`.
- Before `start_time + cliff`, the vested amount is zero. At the cliff boundary,
  linear vesting begins at zero and grows through the remaining duration.
- At or after `start_time + duration`, the full amount is vested. A zero
  duration schedule is fully vested at its start time.
- Amount calculations use checked integer arithmetic; invalid or overflowing
  schedule arithmetic returns `InvalidSchedule`.

## Claims

Only the beneficiary may claim. A claim transfers the amount vested at that
time, which can be less than the full grant. Claims are one-time: any later
claim returns `AlreadyClaimed`, even if more of the schedule has since vested.
A claim before any amount vests returns `NotVested`.

## Revocation

Only the configured admin may revoke a grant that has not been fully claimed. Revocation requires a
delay of at least one hour and cannot happen before `start_time + revoke_delay`
or after full vesting. Once revoked, claims fail and `get_vested_amount` reports
the vested amount as of the revocation time.
