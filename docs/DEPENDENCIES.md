# Dependency Management Policy

This document outlines how PayFlow manages dependencies across its multiple package managers and monorepo structure.

## Overview

PayFlow maintains dependencies in five locations:

1. **contract/Cargo.toml** — Rust smart contract dependencies
2. **frontend/package.json** — React frontend and build tools
3. **package.json** — Root-level monorepo tooling (Husky, lint-staged)
4. **vesting/Cargo.toml** — (Planned) Vesting contract dependencies
5. **scripts/package.json** — (Planned) Utility scripts and build helpers

## Automated Dependency Updates

PayFlow uses **Dependabot** to automatically check for updates and create pull requests on a weekly schedule.

### Update Schedule

- **Day**: Mondays
- **Frequency**: Weekly
- **Times**: Staggered to avoid overwhelming the CI system:
  - 03:00 UTC: Contract (Cargo)
  - 04:00 UTC: Frontend (npm)
  - 05:00 UTC: Root (npm)

### Grouping Strategy

Dependabot groups updates by category to minimize PR volume and prioritize critical updates:

#### Stellar SDK & Smart Contract Framework
- **Packages**: `soroban-sdk`, `@stellar/stellar-sdk`
- **Priority**: High — grouped separately to expedite review
- **Update Types**: Minor and patch versions only (major versions reviewed manually)

#### React Ecosystem (Frontend)
- **Packages**: `react`, `react-dom`
- **Priority**: Medium — grouped to keep frontend stack cohesive
- **Update Types**: Minor and patch versions

#### Development Dependencies
- **Packages**: Testing, linting, and build tools
- **Priority**: Lower — separated to reduce noise for core functionality
- **Update Types**: Minor and patch versions

### Update Types

By default, Dependabot creates PRs for:

- **Patch updates** (e.g., 1.2.3 → 1.2.4) — Auto-merged if tests pass
- **Minor updates** (e.g., 1.2.0 → 1.3.0) — Requires manual review

**Major version updates** (e.g., 1.0.0 → 2.0.0) are NOT automatic and must be manually evaluated and updated.

## PR Review and Testing

Every Dependabot PR must:

1. ✅ Pass all CI checks (linting, type-checking, tests)
2. ✅ Update relevant documentation if needed
3. ✅ For breaking changes, update code to match new API
4. 👥 Receive approval from at least one maintainer

### For Stellar SDK Updates

When `soroban-sdk` or `@stellar/stellar-sdk` are updated:

- Review the [Stellar changelog](https://github.com/stellar/rs-soroban-sdk/releases) for breaking changes
- Run contract tests: `npm run backend:test`
- Run frontend type-check: `npm run typecheck`
- Update any impacted code in the contract or frontend
- Document any API changes in `CHANGELOG.md`

## Manual Updates

To manually update dependencies:

### Updating Cargo dependencies (contract)

```bash
cd contract
cargo update
cargo test
```

### Updating npm dependencies

```bash
# Frontend
cd frontend
npm update
npm run test

# Root
npm update
```

## Version Pinning

All dependencies use:

- **Cargo**: Caret requirements (e.g., `soroban-sdk = "21.0.0"`) — allows compatible versions
- **npm**: Caret ranges (e.g., `"^12.0.0"`) — allows compatible versions

This strikes a balance between stability and receiving important updates.

## Security Updates

Security vulnerabilities are treated as high-priority. If a security advisory is issued:

1. Dependabot will create a PR immediately (outside the normal schedule)
2. The PR should be reviewed and merged ASAP
3. Consider bumping the patch version and releasing a new package

## Adding New Dependencies

When adding new dependencies:

1. Use exact or pinned versions in initial commits
2. Let Dependabot manage updates from that point forward
3. Document the rationale for adding the dependency
4. Ensure it aligns with project tech stack (Stellar, React, Rust)

## Future Considerations

- **vesting/Cargo.toml** — When the vesting contract is created, Dependabot will automatically manage its dependencies
- **scripts/package.json** — When utility scripts are added, this location will be monitored
- **Python dependencies** — If Python tooling is introduced (e.g., for deployment helpers), pip/Poetry will be added to Dependabot

## References

- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot)
- [Stellar SDK Releases](https://github.com/stellar/rs-soroban-sdk/releases)
- [Stellar JavaScript SDK](https://github.com/stellar/js-stellar-sdk/releases)

