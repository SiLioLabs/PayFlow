# Local Development Network Matrix

This matrix documents every environment variable that controls network/RPC/contract alignment across the three packages: frontend, scripts, and contract tests. Use it to ensure all packages target the same network and contract.

---

## Environment Variable Matrix

| Variable | Package | Testnet example | Mainnet caution |
|----------|---------|----------------|----------------|
| `VITE_CONTRACT_ID` | frontend | `C...` (56 chars) | Must match mainnet-deployed contract |
| `VITE_RPC_URL` | frontend | `https://soroban-testnet.stellar.org` | Use `https://soroban-mainnet.stellar.org` or your own node |
| `VITE_NETWORK_PASSPHRASE` | frontend | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| `VITE_TOKEN_CONTRACT_ID` | frontend | (token address) | Must match mainnet token contract |
| `VITE_DEFAULT_TOKEN` | frontend | XLM SAC address (default) | — |
| `VITE_ANALYTICS_URL` | frontend | (unset) | — |
| `CONTRACT_ID` | scripts | `C...` (56 chars) | Must match mainnet-deployed contract |
| `KEEPER_SECRET` | scripts | `S...` (56 chars) | **Never commit real keys** |
| `RPC_URL` | scripts | `https://soroban-testnet.stellar.org` | Use `https://soroban-mainnet.stellar.org` |
| `NETWORK_PASSPHRASE` | scripts | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| `CHARGE_INTERVAL_MS` | scripts | `3600000` (1 hour) | — |
| `PAGE_SIZE` | scripts | `100` | — |
| `MAX_RETRIES` | scripts | `3` | — |
| `LOG_LEVEL` | scripts | `debug` (local) / `info` (production) | Use `info` or `warn` |

**Contract tests** require no environment variables. They run entirely in-memory using `Env::default()` with mock authentication and an in-memory token.

---

## Alignment Rules

All three packages must agree on:

1. **RPC URL** — `VITE_RPC_URL` (frontend) and `RPC_URL` (scripts) must point at the same Soroban RPC node.
2. **Network passphrase** — `VITE_NETWORK_PASSPHRASE` (frontend) and `NETWORK_PASSPHRASE` (scripts) must be identical. A mismatch causes transaction submission failures.
3. **Contract ID** — `VITE_CONTRACT_ID` (frontend) and `CONTRACT_ID` (scripts) must reference the same deployed contract. Using different contract IDs means the frontend and keeper operate on different subscription sets.
4. **Token contract** — If the contract was initialized with a specific token (not the default XLM SAC), `VITE_TOKEN_CONTRACT_ID` must match.

---

## Freighter Network Matching

The frontend's `useNetworkCheck` hook (in `frontend/src/hooks/useNetworkCheck.ts`) compares the Freighter wallet's `networkPassphrase` against the app's `NETWORK_PASSPHRASE`. If they differ, the UI displays a warning.

**To avoid warnings:** Ensure Freighter is set to the same network as `VITE_NETWORK_PASSPHRASE`:
- **Testnet:** Freighter → Stellar Testnet
- **Mainnet:** Freighter → Stellar Public Network

The `NetworkBadge` component (`frontend/src/components/NetworkBadge.tsx`) derives the displayed network name from `NETWORK_PASSPHRASE`:
- Passphrase contains `"Public Global"` → badge shows "Mainnet"
- Otherwise → badge shows "Testnet"

---

## Verification Commands

### Health check (scripts)

```bash
cd scripts
npm install
npx tsx health-check.ts
```

Verifies RPC connectivity and contract initialization status.

### Frontend network badge

Start the frontend dev server and confirm the `NetworkBadge` in the top-right corner shows the expected network:

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local with your VITE_CONTRACT_ID and VITE_NETWORK_PASSPHRASE
npm install
npm run dev
```

### Contract tests (no network required)

```bash
cd contract
cargo test
```

Contract tests are fully offline and deterministic — no RPC, passphrase, or contract ID needed.

---

## Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Frontend targets testnet, scripts target mainnet (or vice versa) | Transaction simulation succeeds but submission fails with `NOT_FOUND` or `PASSPHRASE_MISMATCH` | Set `VITE_NETWORK_PASSPHRASE` and `NETWORK_PASSPHRASE` to the same value |
| Contract ID differs between frontend and scripts | Frontend shows no subscriptions; keeper charges nothing | Set `VITE_CONTRACT_ID` and `CONTRACT_ID` to the same value |
| Freighter wallet set to wrong network | `useNetworkCheck` shows a network mismatch warning | Switch Freighter to match `VITE_NETWORK_PASSPHRASE` |
| RPC URL is unreachable or wrong network | `useRpcHealth` reports unhealthy; scripts fail to connect | Verify the RPC URL returns a valid Soroban response: `curl <RPC_URL>` |

---

## See Also

- [DEPLOYMENT.md](../DEPLOYMENT.md) — testnet and mainnet deployment guides
- [scripts/README.md](../../scripts/README.md) — scripts package documentation
- [ONBOARDING.md](../ONBOARDING.md) — contributor onboarding walkthrough
