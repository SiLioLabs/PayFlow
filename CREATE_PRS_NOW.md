# Create Pull Requests - Quick Guide

## 🚀 Your Branches Are Ready!

All three branches have been pushed to your GitHub repository. Here's how to create the PRs:

## Method 1: Using GitHub Web Interface (Easiest)

1. **Go to your repository:**
   ```
   https://github.com/charityzarmai/PayFlow
   ```

2. **You'll see yellow banners** at the top like:
   ```
   fix/issue1-component-naming had recent pushes 2 minutes ago
   [Compare & pull request]
   ```

3. **Click "Compare & pull request"** for each banner

4. **Fill in the details** (copy from below)

---

## 📝 PR Details to Copy-Paste

### PR #1: Component Naming

**Title:**
```
fix: rename SubscriptionRepairPanel components to resolve naming collision
```

**Description:**
```
Resolves naming ambiguity between subscriber-facing and admin-facing repair panels.

## Problem
Two components shared the name SubscriptionRepairPanel:
- `components/SubscriptionRepairPanel.tsx` — subscriber-facing archived-TTL recovery
- `components/admin/SubscriptionRepairPanel.tsx` — admin diagnostics

The subscriber-facing recovery flow was unreachable in production.

## Solution
- ✅ Renamed subscriber component → `SubscriberRecoveryPanel`
- ✅ Renamed admin component → `AdminRepairPanel`
- ✅ Integrated `SubscriberRecoveryPanel` into `Dashboard.tsx`
- ✅ Updated all test files and imports

## Changes
- 5 renamed components/test files
- 2 modified files (Dashboard.tsx, AdminDashboard.tsx)
- 7 total files changed

## Production Path
`Dashboard.tsx` now checks error with `isArchivedError()` and renders `SubscriberRecoveryPanel` when subscription is archived.

## Testing
- ✅ All TypeScript files pass diagnostics (0 errors)
- ✅ Test files updated with correct imports
- ✅ Component integration verified

## Validation
```bash
cd frontend && npm run typecheck
npx vitest run SubscriberRecoveryPanel
npx vitest run AdminRepairPanel
```

**Reviewers:** @charityzarmai
```

---

### PR #2: CancelResult Expansion

**Title:**
```
fix: expand CancelResult enum to distinguish paused and frozen-merchant cancellations
```

**Description:**
```
Adds PausedCancelled and MerchantFrozen variants to batch_cancel return values.

## Problem
`batch_cancel` returned only 3 outcomes (Cancelled, NoSubscription, AlreadyCancelled).

An admin operating a batch cancel could not distinguish a routine cancel from one that hit a paused or frozen subscription - exactly the cases worth reviewing.

## Solution
- ✅ Added `PausedCancelled` (discriminant 3)
- ✅ Added `MerchantFrozen` (discriminant 4)
- ✅ Updated `batch_cancel` logic to detect unusual states
- ✅ `MerchantFrozen` takes precedence over `PausedCancelled`
- ✅ Added comprehensive doc comment with append-only rule

## Discriminants
| Discriminant | Variant | Status |
|--------------|---------|--------|
| 0 | Cancelled | Unchanged ✅ |
| 1 | NoSubscription | Unchanged ✅ |
| 2 | AlreadyCancelled | Unchanged ✅ |
| 3 | PausedCancelled | NEW 🆕 |
| 4 | MerchantFrozen | NEW 🆕 |

## Changes
- `contract/src/batch.rs` — enum expanded, batch_cancel logic updated
- `docs/CANCEL-RESULTS.md` — comprehensive wire encoding documentation (NEW)
- `scripts/EVENT-MAPPING.md` — documented new variants
- `contract_tests_addon.rs` — 3 new tests

## Backward Compatibility
✅ **Maintained** - existing discriminants 0-2 unchanged.

Off-chain parsers that only know 0-2 continue to work. New parsers should handle 3-4.

## Testing
New tests in `contract_tests_addon.rs` (to be integrated):
- `test_batch_cancel_distinguishes_paused_cancellation`
- `test_batch_cancel_distinguishes_frozen_merchant`
- `test_batch_cancel_frozen_merchant_takes_precedence_over_paused`

## Validation
```bash
cd contract && cargo test batch_cancel
```

**Reviewers:** @charityzarmai
```

---

### PR #3: Resume Documentation

**Title:**
```
docs: document resume recovery matrix and clock state interactions
```

**Description:**
```
Expands resume function documentation with comprehensive recovery guidance.

## Problem
The three overlapping clocks (interval, grace period, pause expiry) produce a matrix of outcomes that was only discoverable by reading three modules.

The `resume` function's behavior past an elapsed pause expiry was not obvious from its doc comment.

## Solution
Expanded the `resume` function doc comment in `contract/src/lib.rs` with:
- ✅ Complete recovery matrix table covering all clock state combinations
- ✅ Clear rules for when `resume`, `cancel`, or `re-subscribe` is appropriate
- ✅ Explicit error codes and meanings (including `ResumeGraceLapsed` code 43)
- ✅ Cross-references to `docs/SUBSCRIBER-LIFECYCLE.md` and `grace.rs:19-22`

## Recovery Matrix

| State | Action | Outcome |
|-------|--------|---------|
| Paused, grace not lapsed, pause not expired | `resume` | ✅ Success |
| Paused, grace lapsed | `resume` | ❌ Error: ResumeGraceLapsed (43) |
| Paused, grace lapsed | `cancel` | ✅ Success (always allowed) |
| Paused, grace lapsed | `re-subscribe` | ✅ Success (restores chargeability) |
| Paused, pause expiry elapsed, grace not lapsed | Auto-resume | ✅ Subscription auto-resumes |
| Paused, pause expiry elapsed, grace not lapsed | `resume` | ✅ Success (manual) |
| Legacy paused (`active=false`, pre-#1009) | `resume` | ✅ Success (backward compatible) |

## Key Rules
- `cancel` is **always** allowed regardless of grace or pause state
- `re-subscribe` restores chargeability even after grace has lapsed
- `resume` is rejected if grace has lapsed to avoid false recovery signals
- Auto-resume (via `try_auto_resume` on charge path) handles expired `pause_until`

## Changes
- `contract/src/lib.rs` — resume function doc comment expanded (documentation only)

## Backward Compatibility
✅ **No behavior changes** - documentation only. All existing code paths unchanged.

## Testing
New test scenarios documented in `contract_tests_addon.rs`:
- `test_resume_with_pause_expiry_elapsed_grace_not_lapsed`
- `test_resume_with_pause_not_expired_grace_not_lapsed`
- `test_resume_legacy_paused_active_false`

## Validation
```bash
cd contract && cargo test resume && cargo test grace
```

**Reviewers:** @charityzarmai
```

---

## Method 2: Using GitHub CLI

If you have GitHub CLI installed:

```bash
cd /path/to/PayFlow

# Create PR 1
gh pr create \
  --base master \
  --head fix/issue1-component-naming \
  --title "fix: rename SubscriptionRepairPanel components to resolve naming collision" \
  --body-file ISSUE1_COMMIT.txt

# Create PR 2
gh pr create \
  --base master \
  --head fix/issue2-3-cancel-result-expansion \
  --title "fix: expand CancelResult enum to distinguish paused and frozen-merchant cancellations" \
  --body-file ISSUE2_3_COMMIT.txt

# Create PR 3
gh pr create \
  --base master \
  --head fix/issue4-resume-documentation \
  --title "docs: document resume recovery matrix and clock state interactions" \
  --body-file ISSUE4_COMMIT.txt
```

---

## ✅ Checklist

After creating each PR:

- [ ] PR title matches the format above
- [ ] Description is complete with Problem, Solution, Changes sections
- [ ] Base branch is `master` (or your main branch)
- [ ] Reviewers assigned
- [ ] Labels added (if applicable): `bug`, `enhancement`, `documentation`

---

## 🎯 Next Steps

1. **Create all 3 PRs** using Method 1 or Method 2
2. **Review and merge** in this order (recommended):
   - PR #1 (Component Naming) — independent
   - PR #3 (Documentation) — independent, docs only
   - PR #2 (CancelResult) — has test files to integrate
3. **After merge:** Integrate tests from `contract_tests_addon.rs` into `contract/src/test.rs`
4. **Run validation** to ensure everything works

---

## 🆘 Need Help?

Check `SEPARATE_PRS_SUMMARY.md` for detailed information about each PR.

**Happy reviewing! 🚀**
