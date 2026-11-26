# test_snapshots

**These files are generated. Do not hand-edit them.**

Every `Env` created in a test writes a snapshot of the ledger entries and events
it produced to `test_snapshots/<module>/<test-name>.<N>.json` when it is dropped
(soroban-sdk does this in `Env::drop`; `N` counts the environments the test
creates). Nothing in this crate calls the snapshot API explicitly, so the tree
is a recorded trace of what each test actually wrote and emitted.

## Why they are committed

The snapshot is the only artefact that captures the *side effects* of a test —
every storage key touched, every event emitted, in order. Typed assertions
check the value a test cares about; the snapshot shows everything else that
changed, so a contract change that quietly starts writing a new key, drops an
event, or changes an event payload shows up as a diff here even when the
assertions still pass.

## Rules

1. **Commit the regenerated snapshots with the change that caused them.** A PR
   that changes contract behaviour without regenerating leaves the recorded set
   describing the old behaviour.
2. **Renaming or removing a test deletes its snapshot.** The SDK never cleans
   up, so an orphaned file would otherwise linger forever, appear in unrelated
   diffs, and read as expected legacy output. Delete it in the same commit as
   the rename.
3. **Regenerate with a full run, not a filtered one.** `cargo test` (no filter)
   is required — snapshots are only written for tests that actually execute.
4. **Do not hand-edit to make a diff disappear.** If a snapshot change is
   surprising, that is the signal the file exists to give. Investigate the
   behaviour change, then regenerate.

## Regenerating

```sh
cd contract
cargo test                      # writes the snapshots
cd ..
git status --porcelain -- contract/test_snapshots   # review before committing
```

## CI gate

`contract/scripts/snapshot-check.mjs` runs on every contract change:

| check | meaning | fix |
| --- | --- | --- |
| orphaned | snapshot file with no `#[test] fn` of that name | `git rm` the file (rename/delete hygiene) |
| corrupt | file is not valid JSON (truncated write) | full `cargo test` to rewrite it |
| gaps | `Env` numbering is not `1..N` (the test now creates fewer envs) | full `cargo test`, commit the new files, delete the leftovers |
| stale (`--after-test`) | the `cargo test` run rewrote, added or deleted files | review the diff and commit it with the change |

A test that builds an `Env` but leaves no file behind is reported as a note, not
a failure: the SDK skips writing a snapshot when the env recorded no ledger
entries, events or auth. `test_allowance_covers_gross_table` and
`test_charge_result_partial_eq_identity` are pure-arithmetic tests and never
produce one. The `--after-test` pass is the authoritative "you added a test and
forgot to commit its snapshot" check, because the SDK has by then decided
whether a file was due.

The static half (orphaned / corrupt / gaps) needs no build, so it still gives a
useful signal when the crate does not compile.
