# Security Audits

The `security-audit.yml` workflow runs dependency audits automatically on every pull request, every push to `master`, and weekly (every Monday at 06:00 UTC). It covers both the Rust dependency trees (via `cargo audit`) and the npm dependency graphs (via `npm audit`). High-severity findings fail the workflow and block merging.

---

## Cargo audit

[`cargo-audit`](https://github.com/rustsec/rustsec/tree/main/cargo-audit) scans Rust dependency trees against the [RustSec Advisory Database](https://rustsec.org/advisories/). This repository has two independent Cargo workspaces, each with its own `Cargo.lock`:

- `contract/Cargo.lock` — the on-chain Soroban contract
- `vesting/Cargo.lock` — the vesting contract

Both are audited on every CI run.

### Allowlist (audit.toml)

Exceptions are managed through `audit.toml` at the repository root. The file uses TOML format with an `[advisories]` section containing an `ignore` array. Each entry requires three fields:

```toml
[advisories]
ignore = [
  # Example entry — replace with a real advisory ID and reason before committing:
  { id = "RUSTSEC-2024-0001", reason = "Only affects the network serialization path; this crate is used in a build-only context and the vulnerable code is never called at runtime in this project.", expires = "2025-04-01" },
]
```

| Field | Description |
| --- | --- |
| `id` | The RUSTSEC advisory identifier (e.g. `RUSTSEC-2024-0001`). |
| `reason` | Why the advisory does not apply or is acceptable in this project. Be specific: name the code path, usage context, or mitigating control. |
| `expires` | ISO 8601 date (`YYYY-MM-DD`). Must be no more than 90 days from the date the exception is added. |

### Running locally

```bash
# Install cargo-audit (one-time)
cargo install cargo-audit

# Audit contract workspace
cargo audit --file contract/Cargo.lock --config audit.toml

# Audit vesting workspace
cargo audit --file vesting/Cargo.lock --config audit.toml
```

Both commands exit 0 when no advisories are found (or all found advisories are in the allowlist and unexpired). A non-zero exit means a new advisory requires attention.

---

## npm audit

`npm audit` checks npm dependency graphs for known CVEs. The workflow uses `--omit=dev` so only production dependencies are evaluated, and `--audit-level=high` so only `high` and `critical` severity findings fail the step.

Three package roots are audited:

| Directory | What it covers |
| --- | --- |
| `.` (repo root) | Root workspace dependencies |
| `frontend/` | React frontend production deps |
| `scripts/` | Keeper/indexer/ops scripts production deps |

### Running locally

```bash
# From the repo root
npm audit --audit-level=high --omit=dev

# Frontend
cd frontend && npm audit --audit-level=high --omit=dev

# Scripts
cd scripts && npm audit --audit-level=high --omit=dev
```

There is no npm allowlist. If a high-severity advisory appears, resolve it by upgrading the affected package or switching to an alternative. Do not use `npm audit fix --force` without understanding what it changes.

---

## Adding an exception

Before adding an exception to `audit.toml`, confirm the advisory is a real concern for this project:

1. **Look up the advisory.** Visit `https://rustsec.org/advisories/<RUSTSEC-ID>` and read the description, affected versions, and patched versions.
2. **Check whether the dependency is reachable.** If the vulnerable crate is only pulled in by a build-time dependency, or the vulnerable code path is in a feature the project does not use, document that explicitly in the `reason` field.
3. **Check for a patched version.** If a patched version is available and upgrading is feasible, upgrade rather than adding an exception.
4. **Add the entry to `audit.toml`.**
   ```toml
   { id = "RUSTSEC-YYYY-NNNN", reason = "<specific justification>", expires = "<date at most 90 days from today>" },
   ```
5. **Re-run cargo audit locally** to confirm the exception suppresses the advisory and no other advisories remain:
   ```bash
   cargo audit --file contract/Cargo.lock --config audit.toml
   cargo audit --file vesting/Cargo.lock --config audit.toml
   ```
6. **Commit `audit.toml`** with a message that names the advisory and summarises the justification (e.g. `chore: allowlist RUSTSEC-2024-0001 — build-only dep, not reachable at runtime`).

---

## Keeping exceptions current

The `security-audit.yml` workflow runs every Monday. When an exception's `expires` date passes, `cargo audit` treats it as if it were not in the allowlist and fails the workflow. This is intentional — it forces a periodic re-evaluation of whether the exception is still valid.

When a weekly run fails on an expired entry:

1. Re-read the advisory to check whether a patched version is now available.
2. If a fix exists, upgrade and remove the exception.
3. If the exception is still justified (no patch available, crate still unreachable), extend the `expires` date by up to 90 days and update the `reason` if the situation has changed.
4. If the dependency has been removed from the project since the exception was added, delete the entry.
