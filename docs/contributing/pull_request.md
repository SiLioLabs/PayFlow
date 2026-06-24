# 📥 Pull Request Process & Issue Management

This guide covers our guidelines for submitting Pull Requests (PRs), receiving reviews, and managing issues.

---

## 🗂️ Pull Request Template

When opening a Pull Request, use the template below. Provide context, details of what changed, validation testing steps, and link to corresponding issues.

```markdown
## Description
Provide a clear, high-level summary of the changes made and the rationale behind them.

## Related Issue
Fixes # (issue link)

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Verification & Testing
### Automated Tests
Describe tests run (e.g., `cargo test`, `npm run test`).
- [ ] Test A passed
- [ ] Test B passed

### Manual Verification
List steps to verify changes manually (e.g., frontend clicks, CLI commands).

## Checklist
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have updated documentation accordingly
- [ ] No secrets or `.env` files are committed
```

---

## 🔬 Required Checks & Reviews

Before any Pull Request is eligible to merge into `develop` or `main`:
1. **GitHub Actions / CI**:
   - All tests must pass (`cargo test`, frontend tests).
   - Linter checks must compile without errors (`cargo clippy`, `eslint`).
   - Build checks must succeed without TypeScript compiler errors (`npm run build`).
2. **Peer Review**:
   - At least **1 approving review** from a core maintainer is required.
   - If the PR touches critical contract code, **2 approving reviews** from security/contract engineers are required.

---

## 💬 Responding to Review Feedback

- **Be Collaborative**: Reviews are a teaching and learning process. Treat feedback constructively.
- **Line Comments**: Resolve comments only after addressing them. Reply directly to threads if you disagree, explaining your design decisions.
- **Commit Increments**: Push new commits to your branch. The PR will update automatically. Do not close and open a new PR for feedback changes.

---

## 🧭 Review Guidelines (Request Changes vs. Approve)

Maintainers must apply these rules when reviewing:

| Action | When to use |
| --- | --- |
| **Approve** | The code is sound, style is correct, tests pass, and it solves the target problem. Minor comments can be left as suggestions. |
| **Comment** | General questions, clarification requests, or ideas that don't block the PR from moving forward. |
| **Request Changes** | Critical flaws present (e.g., security vulnerability, missing tests, broken builds, wrong business logic, breaking style guidelines). |

---

## 🔀 Merging Strategy

- **Squash and Merge**: Our primary merge method. Compress commits to prevent intermediate WIP steps from cluttering the master git log.
- **Rebase and Merge**: Used only for major releases or dependency updates where preserving precise commit isolation is critical.

---

## 🏷️ Issue Labeling System

We use labels to categorize, prioritize, and filter issues.

| Label | Description | Color |
| --- | --- | --- |
| `bug` | Unexpected behavior or application crash. | `#d73a4a` |
| `feature` | Request for new capability or enhancement. | `#a2eeef` |
| `documentation` | Improvements or additions to docs. | `#0075ca` |
| `good first issue` | Easy, well-defined task ideal for new contributors. | `#7057ff` |
| `help wanted` | Complex issues requiring community feedback or expertise. | `#008672` |
| `invalid` | Issue is a duplicate, out of scope, or non-reproducible. | `#e6e6e6` |

---

## 🚦 Triaging New Issues

Core maintainers triage issues within **48 hours** of submission.
1. **Verify completeness**: Ensure the issue contains reproduction steps, environment data, and log snippets.
2. **Assign labels**: Apply appropriate tags (e.g., `bug`, `frontend`, `contract`).
3. **Set priority**:
   - `P0 (Critical)`: Production down, severe data loss, or core contract exploit. Addressed immediately.
   - `P1 (High)`: Key feature broken. Addressed in the current sprint.
   - `P2 (Medium)`: Non-blocking bug or minor feature improvement.
   - `P3 (Low)`: Backlog item, minor polishing, or cosmetic change.

---

## 👤 Issue Assignment Procedures

- **Self-Assignment**: If you want to work on an issue, comment on the thread (e.g., *"I'd like to work on this"*). A maintainer will assign it to you.
- **Abandonment**: If no update is posted in **7 days**, the issue is unassigned to keep development active.
