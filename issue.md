.,
.k=op
h8umikol;/'# PayFlow Open-Source Contribution Wave 9 Issues

This file lists the **120** GitHub issues created for the PayFlow/FlowPay Wave 9 contribution round. Each issue is grounded in the current repository architecture (Soroban contract under `contract/`, React app under `frontend/`, operational TypeScript under `scripts/`, and docs under `docs/`).

**Distribution:** 45 Contract · 25 Frontend · 30 Backend · 20 Documentation  
**Complexity:** 200 points each

All issues carry the labels `wave-200`, the category label, and `Stellar Wave`.

## Contract (45 issues)

- **#1005** Enforce the contract schema-version guard on all subscription write entrypoints  
  Includes: Wiring `require_current_version` into `subscribe_inner`, `subscribe_with_metadata_inner`, and …  
  https://github.com/SiLioLabs/PayFlow/issues/1005

- **#1006** Make set_global_volume_cap lower the effective hourly enforcement cap  
  Includes: Enforcing the override in the shared volume-check path; tests for lowered and raised cap values.  
  https://github.com/SiLioLabs/PayFlow/issues/1006

- **#1007** Make cancel idempotent to stop double-cancel counter corruption  
  Includes: Early-return guard in `cancel_inner` when `!sub.active`, counter-stability tests, and an …  
  https://github.com/SiLioLabs/PayFlow/issues/1007

- **#1008** Extend frozen-merchant state TTL so archived bans cannot silently unfreeze  
  Includes: TTL extension on freeze path; a test that time-travels past the archive point and asserts the …  
  https://github.com/SiLioLabs/PayFlow/issues/1008

- **#1009** Keep PauseExpiry alive and resolve pause_until active-flag semantics  
  Includes: TTL bump in `pause_until`; documenting (or aligning) the `active` flag for paused subscriptions …  
  https://github.com/SiLioLabs/PayFlow/issues/1009

- **#1010** TTL-extend SubscriberIndexSize alongside its index-slot keys  
  Includes: TTL bump on the size key in the write path; a regression test around key expiry order.  
  https://github.com/SiLioLabs/PayFlow/issues/1010

- **#1011** TTL-extend referral attribution keys on write  
  Includes: TTL extension on referral write/read paths and `remove_referral` behavior; tests for archival + …  
  https://github.com/SiLioLabs/PayFlow/issues/1011

- **#1012** TTL-extend MerchantFeeRecipient on set and on charge  
  Includes: TTL extension in `src/fee.rs` on both write and charge-time read; tests for …  
  https://github.com/SiLioLabs/PayFlow/issues/1012

- **#1013** Bound subscription intervals to prevent last_charged timestamp overflow  
  Includes: A `MAX_SUBSCRIPTION_INTERVAL` cap enforced in subscribe/charge paths; checked math in …  
  https://github.com/SiLioLabs/PayFlow/issues/1013

- **#1014** Remove the redundant duplicate MerchantWhitelist write in add_merchant  
  Includes: Single-line removal plus a whitelist membership regression test.  
  https://github.com/SiLioLabs/PayFlow/issues/1014

- **#1015** Make get_batch_charge_estimate respect the configured max_batch_size  
  Includes: Swapping the hardcoded `200` for the configured cap; tests for lowered-default, raised, and …  
  https://github.com/SiLioLabs/PayFlow/issues/1015

- **#1016** Switch the subscribe paused-check to the canonical ContractPaused error  
  Includes: Error swap at `src/lib.rs` (subscribe path) + test; align the frontend error table note.  
  https://github.com/SiLioLabs/PayFlow/issues/1016

- **#1017** Reject zero batch size in set_max_batch_size  
  Includes: Guard + zero-size test + boundary test at 1 and at ceiling.  
  https://github.com/SiLioLabs/PayFlow/issues/1017

- **#1018** Compact stale merchant revenue day-index entries on prune  
  Includes: Index compaction on prune/reset; a cap on retained day entries; tests for repeated prune cycles.  
  https://github.com/SiLioLabs/PayFlow/issues/1018

- **#1019** Rebind metadata, history, limit, and referral state on transfer_subscription  
  Includes: A transfer helper that moves the auxiliary keys, plus tests for each auxiliary type.  
  https://github.com/SiLioLabs/PayFlow/issues/1019

- **#1020** Resolve the vestigial withdraw_merchant_revenue entrypoint  
  Includes: Contract/event changes + tests + a short docs note that merchants settle directly.  
  https://github.com/SiLioLabs/PayFlow/issues/1020

- **#1021** Separate the unrelated vesting contract out of the flowpay crate  
  Includes: Extraction + at least smoke tests for the vesting contract's core flow.  
  https://github.com/SiLioLabs/PayFlow/issues/1021

- **#1022** Implement or remove the empty limits module  
  Includes: Module removal (preferred) or implementation; a comment pointing at the real limit code.  
  https://github.com/SiLioLabs/PayFlow/issues/1022

- **#1023** Fix and wire the orphaned test_migration suite into the contract test run  
  Includes: Module wiring, doc fix, and any contract fixes the tests surface.  
  https://github.com/SiLioLabs/PayFlow/issues/1023

- **#1024** Remove dead storage helpers and stale batch.rs trigger comment  
  Includes: Cleanup + compile check plus a storage regression test.  
  https://github.com/SiLioLabs/PayFlow/issues/1024

- **#1025** Publish the new WASM hash in the upgrade event  
  Includes: Event data change + event-shape tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1025

- **#1026** Emit max_batch_size_set event for configuration changes  
  Includes: Event + test asserting emission and payload. Align the configured value with the estimate/live …  
  https://github.com/SiLioLabs/PayFlow/issues/1026

- **#1027** Emit whitelist_enabled event on toggle  
  Includes: Event + tests (on, off, no-op suppression).  
  https://github.com/SiLioLabs/PayFlow/issues/1027

- **#1028** Emit max_whitelist_batch_size_set event  
  Includes: Event + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1028

- **#1029** Emit fee_bounds_set event for governance guardrail changes  
  Includes: Event + tests; keep the propose/commit flow events intact.  
  https://github.com/SiLioLabs/PayFlow/issues/1029

- **#1030** Emit global_volume_cap_set event and surface enforcement  
  Includes: Event + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1030

- **#1031** Emit merchant_revenue_reset event on reset and prune paths  
  Includes: Event + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1031

- **#1032** Emit metadata_set and metadata_cleared events  
  Includes: Events + tests including the 64-byte label boundary.  
  https://github.com/SiLioLabs/PayFlow/issues/1032

- **#1033** Emit admin_transfer_proposed event on transfer_admin  
  Includes: Event + test; keep `accept_admin` event as-is.  
  https://github.com/SiLioLabs/PayFlow/issues/1033

- **#1034** Distinguish pause_until from pause in emitted events  
  Includes: Event shape change + tests asserting distinct topics/payloads.  
  https://github.com/SiLioLabs/PayFlow/issues/1034

- **#1035** Bound get_top_merchants_by_subs scans to the requested limit  
  Includes: Bounded implementation + tests for large indices and tie-breaks; a benchmark asserting the read …  
  https://github.com/SiLioLabs/PayFlow/issues/1035

- **#1036** Replace full-index scans in contract_health_check with counters  
  Includes: Health-check rework using counters + tests comparing health against manual sums for small …  
  https://github.com/SiLioLabs/PayFlow/issues/1036

- **#1037** Stop silent u64-to-u32 truncation in get_merchant_sub_count  
  Includes: Signature/event type change + tests at the boundary.  
  https://github.com/SiLioLabs/PayFlow/issues/1037

- **#1038** Report the effective volume cap override in get_contract_config  
  Includes: Read swap + test that configuration reflects a set override.  
  https://github.com/SiLioLabs/PayFlow/issues/1038

- **#1039** Centralize batch and page cap constants with shared helpers  
  Includes: Refactor + parity tests across entrypoints.  
  https://github.com/SiLioLabs/PayFlow/issues/1039

- **#1040** Expose the whitelist batch cap in get_contract_config  
  Includes: Field addition + test.  
  https://github.com/SiLioLabs/PayFlow/issues/1040

- **#1041** Pin estimate-vs-live charge behavior with parity fixtures  
  Includes: Parity fixtures + a short doc comment update.  
  https://github.com/SiLioLabs/PayFlow/issues/1041

- **#1042** Replace accept_admin panic with a typed NoPendingAdmin error  
  Includes: Error variant + call-site change + `#[should_panic]` test replacement with a result assertion.  
  https://github.com/SiLioLabs/PayFlow/issues/1042

- **#1043** Replace admin-not-set expect with a typed error on pre-initialize reads  
  Includes: Typed error + storage change + test updates (test.rs ~1573, 6520, 6602).  
  https://github.com/SiLioLabs/PayFlow/issues/1043

- **#1044** Convert the min-interval assertion to a typed error  
  Includes: Typed error + test update.  
  https://github.com/SiLioLabs/PayFlow/issues/1044

- **#1045** Convert the grace-period assertion to a typed error  
  Includes: Typed error + helper extraction + tests for the boundary.  
  https://github.com/SiLioLabs/PayFlow/issues/1045

- **#1046** Convert the ProceedToAllowance expect in charge_exec to a typed outcome  
  Includes: ChargeResult/error change + tests covering the invariant path.  
  https://github.com/SiLioLabs/PayFlow/issues/1046

- **#1047** Add scenario tests pinning the top correctness fixes as regression guards  
  Includes: A `scenario.rs` (or additions to `test.rs`) with named scenarios; wiring into the default …  
  https://github.com/SiLioLabs/PayFlow/issues/1047

- **#1048** Resolve orphaned test-snapshot artifacts that can silently mask contract changes  
  Includes: Cleanup pass over test files + a CI check that snapshots are fresh.  
  https://github.com/SiLioLabs/PayFlow/issues/1048

- **#1049** CI-gate bench instruction budgets for core entrypoints  
  Includes: CI job + bench-runner config keeping budgets tight but stable.  
  https://github.com/SiLioLabs/PayFlow/issues/1049

---

## Frontend (25 issues)

- **#1050** Reconcile the CONTRACT_ERRORS map with the contract error catalog  
  Includes: Map cleanup in `errors.ts` + a conformance table/comment linking to the contract file.  
  https://github.com/SiLioLabs/PayFlow/issues/1050

- **#1051** Add friendlyError conformance tests against the contract error catalog  
  Includes: A vitest suite generating from the contract's error dec to entries.  
  https://github.com/SiLioLabs/PayFlow/issues/1051

- **#1052** Centralize precision-safe stroop-to-XLM conversions  
  Includes: Refactor + property tests over the safe stroop range.  
  https://github.com/SiLioLabs/PayFlow/issues/1052

- **#1053** Remove orphaned frontend modules and add dead-code detection  
  Includes: Deletion + tooling (orbit/unimported or a custom script) wired into CI.  
  https://github.com/SiLioLabs/PayFlow/issues/1053

- **#1054** Fix the broken CSS header block in index.css  
  Includes: One-line fix + a CSS lint/parse gate.  
  https://github.com/SiLioLabs/PayFlow/issues/1054

- **#1055** Make useContractPaused distinguish unknown from actively-paused  
  Includes: Hook + consumers of `useContractPaused` + a small UI treatment for `unknown`.  
  https://github.com/SiLioLabs/PayFlow/issues/1055

- **#1056** Surface async-validation state in useFormValidation  
  Includes: Hook state + form submit gating + tests with mocked async getAccount.  
  https://github.com/SiLioLabs/PayFlow/issues/1056

- **#1057** Consolidate useNetworkStatus and useNetworkCheck into one connectivity contract  
  Includes: Refactor + migration of consumers + a test on the merged hook.  
  https://github.com/SiLioLabs/PayFlow/issues/1057

- **#1058** Pin amount constants and fix the extra digit in MAX_STROOPS  
  Includes: Constant fix + boundary tests in StroopInput and validation.  
  https://github.com/SiLioLabs/PayFlow/issues/1058

- **#1059** Unify the three duplicate amount-validation implementations  
  Includes: Refactor + conformance tests asserting identical accept/reject across the three flows.  
  https://github.com/SiLioLabs/PayFlow/issues/1059

- **#1060** Harden SubscriptionExport CSV export against formula injection  
  Includes: `csvEscape` hardening + unit tests with attacker-style inputs.  
  https://github.com/SiLioLabs/PayFlow/issues/1060

- **#1061** Add pause-on-hover and manual dismissal to the toast system (WCAG 2.2.2)  
  Includes: Toast store/service changes + accessible dismiss button + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1061

- **#1062** Stabilize useContractEvents lifecycle across pagination changes  
  Includes: Hook refactor + pagination-focused tests using a fake eventsource.  
  https://github.com/SiLioLabs/PayFlow/issues/1062

- **#1063** Distinguish wallet, loading, and error states on connect-gated shells  
  Includes: Shared `useWalletStatus`-style hook + updates to gate components + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1063

- **#1064** Reset virtualized scroll and throttle filters on MerchantSubscriberTable  
  Includes: Hook + table changes + tests asserting scroll reset + a debounce util.  
  https://github.com/SiLioLabs/PayFlow/issues/1064

- **#1065** Fix StroopInput aria-describedby pointing at a nonexistent element  
  Includes: Small markup fix + an axe/test-id assertion.  
  https://github.com/SiLioLabs/PayFlow/issues/1065

- **#1066** Add visibility- and focus-triggered refresh to data hooks  
  Includes: A shared `useVisibilityRefresh` helper wired into the data hooks + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1066

- **#1067** Scope rpcCache keys to RPC endpoint and network so stale cache cannot cross networks  
  Includes: Cache-key change + a network-switch test using a fake RPC layer.  
  https://github.com/SiLioLabs/PayFlow/issues/1067

- **#1068** Add a storage cap and quota guard to AddressBook  
  Includes: Cap constant + error surface + overlay tests for cap and quota.  
  https://github.com/SiLioLabs/PayFlow/issues/1068

- **#1069** Align admin batch panel size limits with shared constants and contract config  
  Includes: Constants plumbing + panel changes + tests asserting cap wiring.  
  https://github.com/SiLioLabs/PayFlow/issues/1069

- **#1070** Reset stale hook state when the connected user changes  
  Includes: Hook state resets + tests simulating user switch.  
  https://github.com/SiLioLabs/PayFlow/issues/1070

- **#1071** Show a last-updated indicator for cached dashboard reads  
  Includes: Cache-metadata plumbing + indicator component + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1071

- **#1072** Guard dirty subscription forms against accidental navigation and window close  
  Includes: Hook + wiring into the two forms + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1072

- **#1073** Add amount-edge vitest coverage for 7-decimal and bound values  
  Includes: Tests only (fixes only if a boundary fails).  
  https://github.com/SiLioLabs/PayFlow/issues/1073

- **#1074** Surface export-enrichment failures via toast and retry instead of console-only logs  
  Includes: Toast wiring + retry + tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1074

---

## Backend (30 issues)

- **#1075** Restore renewal-forecast.ts to a parseable, executable script  
  Includes: Syntax repair, import cleanup, a small fixture-based test.  
  https://github.com/SiLioLabs/PayFlow/issues/1075

- **#1076** Restore deploy-pipeline.ts by removing the mid-file shebang and duplicate entrypoint  
  Includes: File surgery + a `--check` smoke test.  
  https://github.com/SiLioLabs/PayFlow/issues/1076

- **#1077** Restore pre-upgrade-check.ts across duplicate main and ESM/CommonJS misuse  
  Includes: File repair + a run-against-simulator smoke.  
  https://github.com/SiLioLabs/PayFlow/issues/1077

- **#1078** Fix top-merchants.ts duplicate entrypoint and import errors  
  Includes: File repair + fixture test.  
  https://github.com/SiLioLabs/PayFlow/issues/1078

- **#1079** Fix keeper.ts duplicate declarations and unresolved log()  
  Includes: File repair + a start-and-kill smoke test with forced breaker flags.  
  https://github.com/SiLioLabs/PayFlow/issues/1079

- **#1080** Repair indexer.ts temporal-dead-zone and scope errors  
  Includes: File repair + a bounded-run smoke test.  
  https://github.com/SiLioLabs/PayFlow/issues/1080

- **#1081** Fix health-check.ts parse error and restore probe semantics  
  Includes: File repair + output-shape test.  
  https://github.com/SiLioLabs/PayFlow/issues/1081

- **#1082** Fix config.ts duplicate z.coerce keys and env drift  
  Includes: Config repair + a `config.test.ts` proving `.env.example` values parse.  
  https://github.com/SiLioLabs/PayFlow/issues/1082

- **#1083** Restore rotate-fee-collector.ts to a working simulation-only script  
  Includes: Repair + simulation test.  
  https://github.com/SiLioLabs/PayFlow/issues/1083

- **#1084** Restore migrate-contract.ts simulation logic and ScVal correctness  
  Includes: Repair + `--simulate` test against a simulator.  
  https://github.com/SiLioLabs/PayFlow/issues/1084

- **#1085** Fix onboard-merchant.ts duplicate entrypoints and whitelist call arity  
  Includes: Repair + a test boundary against the compiled contract interface.  
  https://github.com/SiLioLabs/PayFlow/issues/1085

- **#1086** Fix grace-period-monitor.ts logSummary recursion  
  Includes: Repair + loop test.  
  https://github.com/SiLioLabs/PayFlow/issues/1086

- **#1087** Fix testnet-setup.ts duplicate top-level constants  
  Includes: Repair + a no-network smoke (dry-run) test.  
  https://github.com/SiLioLabs/PayFlow/issues/1087

- **#1088** Fix duplicated main() invocations across snapshot, fee, and subscriber scripts  
  Includes: Cross-file cleanup + a grep guard in CI.  
  https://github.com/SiLioLabs/PayFlow/issues/1088

- **#1089** Align SQLite column names across indexer writes and report reads  
  Includes: Schema + reader alignment + a shape test against the live schema.  
  https://github.com/SiLioLabs/PayFlow/issues/1089

- **#1090** Emit and adapt charge_failed so alert-failed-charges fires  
  Includes: Indexer event extraction + alert query alignment + an end-to-end fixture test.  
  https://github.com/SiLioLabs/PayFlow/issues/1090

- **#1091** Reconcile SECRET_KEY vs KEEPER_SECRET between configs, keeper, and .env.example  
  Includes: Config + keeper + a test that each script's resolved secret equals the example's.  
  https://github.com/SiLioLabs/PayFlow/issues/1091

- **#1092** Fix the NETWORK_PASSTHRASE typo in .env.example and config validation  
  Includes: Example + config + test.  
  https://github.com/SiLioLabs/PayFlow/issues/1092

- **#1093** Standardize script loading as ESM and drop CommonJS-isms  
  Includes: Repo-wide conversion + CI typecheck as the gate.  
  https://github.com/SiLioLabs/PayFlow/issues/1093

- **#1094** Add a CI job that typechecks, lints, and smoke-tests the scripts directory  
  Includes: Workflow + package.json scripts + a baseline green run.  
  https://github.com/SiLioLabs/PayFlow/issues/1094

- **#1095** Fix keeper undefined log() and processPageDryRun double-counting  
  Includes: Keeper fixes + a dry-run-stats unit test.  
  https://github.com/SiLioLabs/PayFlow/issues/1095

- **#1096** Fix indexer dedup-key stability and pollOnce convergence  
  Includes: Indexer change + a restart-idempotency test.  
  https://github.com/SiLioLabs/PayFlow/issues/1096

- **#1097** Fix renewal-forecast missing imports and dependency wiring  
  Includes: Import wiring + forecast-unit tests.  
  https://github.com/SiLioLabs/PayFlow/issues/1097

- **#1098** Add duplicate-symbol lint and a tsc gate that keeps scripts parseable  
  Includes: Tooling + package scripts.  
  https://github.com/SiLioLabs/PayFlow/issues/1098

- **#1099** Harden topup-allowance.ts against ScVal BigInt encoding and status validation  
  Includes: Repair + boundary tests for raw/huge amounts.  
  https://github.com/SiLioLabs/PayFlow/issues/1099

- **#1100** Fix keeper-benchmark.ts hardcoded budget, random subs, and missing tx validation  
  Includes: Repair + a small fixture corpus committed under `scripts/testdata/`.  
  https://github.com/SiLioLabs/PayFlow/issues/1100

- **#1101** Fix replay-dlq parseChargeResults scvSymbol encoding  
  Includes: Repair + a fixture with symbol-encoded results.  
  https://github.com/SiLioLabs/PayFlow/issues/1101

- **#1102** Fix watch-events.ts logger, unbounded seen-set, and pagination  
  Includes: Repair + a TTL/watermark test.  
  https://github.com/SiLioLabs/PayFlow/issues/1102

- **#1103** Reconcile duplicate replay-events/alert scripts across root and scripts directories  
  Includes: Deletion + reference sweep + a run test of the canonical copy.  
  https://github.com/SiLioLabs/PayFlow/issues/1103

- **#1104** Add a SQLite schema round-trip test from indexer writes to merchant queries  
  Includes: Test + shared fixture events.  
  https://github.com/SiLioLabs/PayFlow/issues/1104

---

## Documentation (20 issues)

- **#1105** Document the indexer SQLite schema including the raw_data column  
  Includes: New doc + links from scripts/README and docs/STRUCTURE.md.  
  https://github.com/SiLioLabs/PayFlow/issues/1105

- **#1106** Document the required Node version for node:sqlite and fix version claims  
  Includes: Doc updates + `engines` + a version-check script note.  
  https://github.com/SiLioLabs/PayFlow/issues/1106

- **#1107** Document the scripts module layout: entrypoints versus shared libraries versus harnesses  
  Includes: README rework + a doc table generated or maintained by hand.  
  https://github.com/SiLioLabs/PayFlow/issues/1107

- **#1108** Create an environment-variable reference for scripts and fix the .env.example typo  
  Includes: New doc + example fix + a doc-source parity test.  
  https://github.com/SiLioLabs/PayFlow/issues/1108

- **#1109** Document the eight scripts with no docs reference  
  Includes: README additions only.  
  https://github.com/SiLioLabs/PayFlow/issues/1109

- **#1110** Update KEEPER.md to the actual runtime, flags, and config used by keeper.ts  
  Includes: Doc rewrite + a validation that each documented flag exists in `keeper.ts`.  
  https://github.com/SiLioLabs/PayFlow/issues/1110

- **#1111** Document the batch and pagination caps as one operator reference table  
  Includes: Doc table + a comment pointing docs at the constant file.  
  https://github.com/SiLioLabs/PayFlow/issues/1111

- **#1112** Document the ChargeResult scvSymbol encoding for DLQ and CSV consumers  
  Includes: New doc + links.  
  https://github.com/SiLioLabs/PayFlow/issues/1112

- **#1113** Refresh ERROR-CODES.md against the typed error catalog  
  Includes: Doc update + a generator script (or a CI check) keeping it fresh.  
  https://github.com/SiLioLabs/PayFlow/issues/1113

- **#1114** Document persistent-key TTL ownership and archival semantics  
  Includes: Doc table + links from each storage module doc-comment.  
  https://github.com/SiLioLabs/PayFlow/issues/1114

- **#1115** Document the pause lifecycle including pause_until, PauseExpiry, and auto-resume  
  Includes: New doc + link from `docs/API.md` and indexers' README.  
  https://github.com/SiLioLabs/PayFlow/issues/1115

- **#1116** Document the differences between batch_charge estimate and live execution  
  Includes: Doc section + the code comment pointing at it.  
  https://github.com/SiLioLabs/PayFlow/issues/1116

- **#1117** Document the global volume cap: default, override, enforcement, and getters  
  Includes: Doc section + cross-link from config doc.  
  https://github.com/SiLioLabs/PayFlow/issues/1117

- **#1118** Document the two withdrawal paths and the economics of the vestigial revenue entrypoint  
  Includes: Doc edits (merchant docs, DEPLOYMENT, API notes).  
  https://github.com/SiLioLabs/PayFlow/issues/1118

- **#1119** Document test_migration.rs and the snapshot-fixture workflow  
  Includes: New doc + cross-links from test file headers.  
  https://github.com/SiLioLabs/PayFlow/issues/1119

- **#1120** Document the referral versus pay-per-use third-party attribution flows  
  Includes: New doc + links from API/referral sections.  
  https://github.com/SiLioLabs/PayFlow/issues/1120

- **#1121** Document admin batch-operation limits and their alignment with the UI  
  Includes: Doc table + UI link.  
  https://github.com/SiLioLabs/PayFlow/issues/1121

- **#1122** Document the SchemaMigrationRequired write-denial invariant  
  Includes: Doc section in DEPLOYMENT/upgrade docs + ERROR-CODES note.  
  https://github.com/SiLioLabs/PayFlow/issues/1122

- **#1123** Add a frontend component reference that flags orphans and validation rules  
  Includes: New doc + cross-links from the dead-code tooling issue.  
  https://github.com/SiLioLabs/PayFlow/issues/1123

- **#1124** Fix DEPLOYMENT.md references to nonexistent scripts and repair STRUCTURE.md trees  
  Includes: Doc rewrites + a freshness check (tree diff vs `git ls-files`).  
  https://github.com/SiLioLabs/PayFlow/issues/1124

---
