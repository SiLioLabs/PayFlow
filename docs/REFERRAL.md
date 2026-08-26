# Referral System Guide

This document has been retired in favor of the canonical guide:

**[`REFERRALS.md`](./REFERRALS.md)** — Referral System Architecture and Integration

Use that document for:

- Data model (`DataKey::Referral`, `Subscription.referrer`)
- Subscribe authentication (`user.require_auth()`)
- Self-referral (`ContractError::SelfReferral`, code `11`)
- The `referred` event
- Frontend (`ReferralPanel.tsx`, `SubscribeForm.tsx`)
- Operational queries (no dedicated referral scripts)

Do not treat this stub as a second source of truth.
