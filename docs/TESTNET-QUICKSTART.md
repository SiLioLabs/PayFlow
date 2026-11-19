# Testnet Quickstart (10 Minutes): Deploy → Subscribe → Charge → Withdraw

From zero to a charged subscription on Stellar Testnet using the real repo scripts and the Soroban/Stellar CLI.

**Time budget:** ~10 minutes (2 setup, 2 build+deploy, 2 fund+subscribe, 2 wait+charge, 2 withdraw+verify).

**You will use:**

- `scripts/deploy-pipeline.ts` (build + deploy + `initialize`)
- `scripts/testnet-setup.ts` (fund accounts via Friendbot)
- `scripts/health-check.ts` (post-deploy gate)
- Soroban CLI (`soroban contract invoke`) for subscribe / charge / withdraw

**Related:** [DEPLOYMENT.md](DEPLOYMENT.md) (full deploy reference), [ONBOARDING.md](ONBOARDING.md) (first-run guide), [INTEGRATION-GUIDE.md](INTEGRATION-GUIDE.md) (dApp integration), [FAQ](FAQ.md) (subscriber/merchant Q&A).

---

## 0. Prerequisites (2 min)

| Tool | Version | Install |
| --- | --- | --- |
| Rust | 1.70+ | `curl https://sh.rustup.rs -sSf \| sh` |
| WASM target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar/Soroban CLI | current | `cargo install --locked soroban-cli` |
| Node.js | 18+ (20 recommended) | [nodejs.org](https://nodejs.org/) |

Verify:

```bash
rustc --version && cargo --version && soroban --version && node --version
```

Expected output (your versions may be newer):

```text
rustc 1.95.0 (5980768e 2026-04-14)
cargo 1.95.0 (f2d3ce0bd 2026-03-21)
stellar 26.0.0 (60f7458e7ecffddf2f2d91dc6d0d2db4fab03ecc)
v20.20.2
```

> The CLI identifies as `stellar` but `soroban` works as an alias. Either is fine below.

Clone and install script deps:

```bash
git clone https://github.com/SiLioLabs/PayFlow.git
cd PayFlow
cd scripts && npm install && cd ..
```

---

## 1. Build + deploy to Testnet (2 min)

### 1.1 Configure

Edit `deployments/config.json` (checked-in values are already testnet):

```json
{
  "network": "testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "tokenAddress": "<SAC_TOKEN_ADDRESS>",
  "adminAddress": "<YOUR_ADMIN_G_ADDRESS>",
  "feeBps": 0,
  "feeCollector": "<YOUR_ADMIN_G_ADDRESS>",
  "initialMerchants": [],
  "wasmPath": "contract/target/wasm32-unknown-unknown/release/flow_pay.wasm"
}
```

- `tokenAddress`: the Stellar Asset Contract (SAC) subscribers pay with. For native XLM on Testnet the default in `scripts/testnet-setup.ts` is `CB64D3G7VP25CBZ76AEGY2FJD2N2Z35TXTLA2HO7DS4SYYBZWAZZTACC`.
- `adminAddress`: your test admin Stellar account (`G…`). Fund it first via [Friendbot](https://friendbot.stellar.org) or `scripts/testnet-setup.ts` below.

### 1.2 Dry-run first (no keys, no RPC writes)

From the repo root:

```bash
npx tsx scripts/deploy-pipeline.ts --dry-run
```

Expected output:

```text
[deploy-pipeline] config OK (network=testnet)
[deploy-pipeline] steps: build → deploy → initialize → health-gate → fee → merchants
[deploy-pipeline] dry-run: no transactions submitted
```

### 1.3 Live deploy

```bash
export DEPLOYER_SECRET_KEY="S…"
export ADMIN_SECRET_KEY="S…"
npx tsx scripts/deploy-pipeline.ts
```

The pipeline runs, in order:

1. **Build** — `cargo build --release --target wasm32-unknown-unknown` in `contract/`
2. **Deploy** — `stellar contract deploy --wasm <wasmPath> ...`, parses a `C…` contract ID
3. **Initialize** — `initialize(token, admin)` unless already configured
4. **Health gate** — re-reads `contract_health_check`, aborts if token/admin missing
5. **Fee / merchants** — `propose_fee` → `commit_fee` and `whitelist_batch_add` if configured

Save the printed contract ID:

```text
[deploy-pipeline] deployed CONTRACT_ID=CABC…XYZ
[deploy-pipeline] initialize OK
[deploy-pipeline] health: is_healthy=true
```

### 1.4 Health gate

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- contract_health_check
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_schema_version
```

Expected:

```text
is_healthy: true
contract_paused: false
token_configured: true
admin_configured: true
3
```

Or via script:

```bash
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/health-check.ts --deep
```

Expected exit `0` (healthy). If exit `1`, stop — see [DEPLOYMENT.md](DEPLOYMENT.md#post-deployment-health-gates).

---

## 2. Fund test accounts (1 min)

Generate + fund an admin, a merchant, and demo subscribers via Friendbot:

```bash
npx tsx scripts/testnet-setup.ts --contractId <CONTRACT_ID> --tokenAddress <SAC_ADDRESS>
```

Expected output:

```text
Step 1: Funding test accounts via Friendbot...
  [OK] Admin Account (G…) funded.
  [OK] Primary Test Merchant (G…) funded.
Step 2: Configuring contract and subscriptions...
  Contract ID: C…
  Token SAC: C…
Step 3: Creating 5 test subscriptions...
Testnet setup complete!
Manifest written to: data/testnet-accounts.json
```

The manifest at `scripts/data/testnet-accounts.json` holds throwaway `G…`/`S…` keys. **Testnet only — never commit it or reuse keys on Mainnet.**

> Prefer manual funding? `curl "https://friendbot.stellar.org?addr=<G_ADDRESS>"` per account works too.

---

## 3. Subscribe (2 min)

Use a **short interval** (`60`s, the contract minimum floor) so you can charge within this tutorial without waiting a day.

### 3.1 Approve allowance (subscriber signs)

The contract pulls funds via SAC `transfer_from`, so the subscriber must approve it first. Approve ~6 cycles:

```bash
soroban contract invoke \
  --id <TOKEN_SAC_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- approve \
  --from <USER_ADDRESS> \
  --spender <CONTRACT_ID> \
  --amount 60000000 \
  --expiry 6307200
```

Expected: transaction `success` / `CREATED`.

Check:

```bash
soroban contract invoke \
  --id <TOKEN_SAC_ID> \
  --network testnet \
  -- allowance \
  --owner <USER_ADDRESS> \
  --spender <CONTRACT_ID>
```

Expected: `60000000` (or remaining allowance ≥ one `amount`).

### 3.2 Subscribe (subscriber signs)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEY> \
  --network testnet \
  -- subscribe \
  --user <USER_ADDRESS> \
  --merchant <MERCHANT_ADDRESS> \
  --amount 10000000 \
  --interval 60 \
  --token <TOKEN_SAC_ID> \
  --trial_period null \
  --referrer null
```

- `amount` is in **stroops** (`10_0000000` = 10 XLM).
- `interval` is in **seconds** (`60` = 1 minute, demo only).

Verify:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_subscription --user <USER_ADDRESS>
soroban contract invoke --id <CONTRACT_ID> --network testnet -- is_charge_due --user <USER_ADDRESS>
```

Expected right after subscribe:

```text
active: true, paused: false
false        # not due yet — interval has not elapsed
```

If `subscribe` fails, see [FAQ — Why did my subscribe fail?](FAQ.md#subscriber-why-did-my-subscribe-fail) (covers codes 2, 3, 7, 8, 10, 12, 18, 19, 22, 46).

---

## 4. Charge (2 min)

Wait ~70 seconds (one `interval` + margin), then anyone (keeper) can charge — no user signature needed:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- is_charge_due --user <USER_ADDRESS>
# → true

soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER_KEY> \
  --network testnet \
  -- charge \
  --user <USER_ADDRESS>
```

Expected: transaction `success`. Verify:

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_merchant_revenue --merchant <MERCHANT_ADDRESS>
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_charge_history --user <USER_ADDRESS>
```

Expected: revenue increased by `net` (equals `amount` when `feeBps=0`), history has one new timestamp.

To charge many users at once:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER_KEY> \
  --network testnet \
  -- batch_charge \
  --users '["<USER1>", "<USER2>"]'
```

Per-user outcomes are `ChargeResult` (`Charged`, `Skipped`, `NoSubscription`, `Inactive`, `Paused`, `GracePeriodElapsed`, `AllowanceInsufficient`) — the batch continues past per-user skips. See [charge-results](charge-results.md) and [FAQ — Why did my charge fail?](FAQ.md#subscriber-why-did-my-charge-fail).

If `charge` panics with `IntervalNotElapsed` (code 6), you called too early — wait and retry. If `GracePeriodElapsed` (code 9), the window closed — the user must re-subscribe.

---

## 5. Withdraw + frontend (2 min)

### 5.1 Check tracked revenue

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_merchant_revenue --merchant <MERCHANT_ADDRESS>
```

Expected: e.g. `10000000` (10 XLM in stroops).

> Settlement note: recurring transfers settle directly subscriber → merchant wallet via SAC `transfer_from` at charge time, and `MerchantRevenue` is the on-chain cumulative tracker. `withdraw_merchant_revenue` settles any custodied/accrued balance to the merchant and emits `merchant_withdrawal`. See [MERCHANT-INTEGRATION.md](MERCHANT-INTEGRATION.md#2-receiving-revenue).

### 5.2 Withdraw (merchant signs)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <MERCHANT_KEY> \
  --network testnet \
  -- withdraw_merchant_revenue \
  --merchant <MERCHANT_ADDRESS>
```

Expected: transaction `success`. Empty balance panics with code 21 (`ZeroBalanceAvailable`) — see [FAQ](FAQ.md#merchant-why-did-my-withdrawal-fail).

### 5.3 (Optional) Point the frontend at your instance

```bash
cp frontend/.env.example frontend/.env.local
# set in frontend/.env.local:
# VITE_CONTRACT_ID=<CONTRACT_ID>
# VITE_RPC_URL=https://soroban-testnet.stellar.org
# VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
cd frontend && npm install && npm run dev
```

---

## Troubleshooting (copy-paste fixes)

| Symptom | Fix |
| --- | --- |
| `AlreadyInitialized` (1) on deploy | You targeted a live instance — use a fresh contract ID or skip `initialize` |
| `NotInitialized` (7) | `initialize(token, admin)` did not succeed — rerun pipeline, check `get_admin`/`get_token` |
| `InsufficientAllowance` (8) | Re-run the `approve` step with a larger `amount` (budget `N` cycles) |
| `IntervalNotElapsed` (6) | Wait until `next_charge_at(user)`; check `is_charge_due` first |
| `GracePeriodElapsed` (9) / `ResumeGraceLapsed` (43) | Window closed — `cancel` + re-`subscribe` |
| `MerchantNotWhitelisted` (10) / `MerchantFrozen` (22) | Admin: `add_merchant` / `unfreeze_merchant` |
| `ContractPaused` (18) | Admin-only `unpause_contract`; keepers must stop cycling |
| Wrong network / empty `VITE_CONTRACT_ID` | Match `VITE_RPC_URL` + passphrase + `CONTRACT_ID`; see `docs/development/network-matrix.md` |
| RPC failures | Retry with backoff or switch `VITE_RPC_URL`; see `operations/troubleshooting.md` |

Full code table: [ERROR-CODES.md](ERROR-CODES.md). Operator playbook: [operations/troubleshooting.md](operations/troubleshooting.md).

---

## Next steps

- Subscriber + merchant Q&A: [FAQ.md](FAQ.md)
- Subscription states and charge flow: [SUBSCRIBER-LIFECYCLE.md](SUBSCRIBER-LIFECYCLE.md), [ARCHITECTURE.md](ARCHITECTURE.md#recurring-charge)
- Keeper automation: [KEEPER.md](KEEPER.md), `scripts/keeper.ts --help`
- Merchant dashboard: [MERCHANT-INTEGRATION.md](MERCHANT-INTEGRATION.md)
- Mainnet checklist (audit gate): [MAINNET-DEPLOYMENT.md](MAINNET-DEPLOYMENT.md)
