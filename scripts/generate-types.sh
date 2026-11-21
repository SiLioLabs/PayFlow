#!/usr/bin/env bash
#
# generate-types.sh — Generate TypeScript bindings from the deployed FlowPay contract.
#
# Usage:
#   bash scripts/generate-types.sh
#
# Required environment variables:
#   CONTRACT_ID   — The deployed Soroban contract ID (e.g., CABC...XYZ)
#   NETWORK       — Target network: "testnet" or "mainnet" (default: testnet)
#   RPC_URL       — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
#
# Alternatively, if a WASM artifact exists at contract/target/wasm32-unknown-unknown/release/payflow.wasm
# the script will use --wasm instead of --contract-id.
#
# Output:
#   frontend/src/generated/contract.ts
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Configuration ─────────────────────────────────────────────────────────────

NETWORK="${NETWORK:-testnet}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
OUTPUT_DIR="$PROJECT_ROOT/frontend/src/generated"
OUTPUT_FILE="$OUTPUT_DIR/contract.ts"

# ── Validate prerequisites ────────────────────────────────────────────────────

if ! command -v soroban &>/dev/null; then
  echo "ERROR: soroban CLI not found. Install with: cargo install --locked soroban-cli" >&2
  exit 1
fi

# ── Determine contract source (WASM artifact or deployed contract ID) ─────────

WASM_PATH="$PROJECT_ROOT/contract/target/wasm32-unknown-unknown/release/payflow.wasm"

if [[ -n "${CONTRACT_ID:-}" ]]; then
  echo "Using deployed contract: $CONTRACT_ID on $NETWORK"
  SOURCE_ARGS="--contract-id $CONTRACT_ID --network $NETWORK --rpc-url $RPC_URL"
elif [[ -f "$WASM_PATH" ]]; then
  echo "Using local WASM artifact: $WASM_PATH"
  SOURCE_ARGS="--wasm $WASM_PATH"
else
  echo "ERROR: Neither CONTRACT_ID env var nor WASM artifact found." >&2
  echo "  Set CONTRACT_ID to your deployed contract address, or build the contract first:" >&2
  echo "    cd contract && cargo build --release --target wasm32-unknown-unknown" >&2
  exit 1
fi

# ── Generate bindings ─────────────────────────────────────────────────────────

mkdir -p "$OUTPUT_DIR"

echo "Generating TypeScript bindings..."
# shellcheck disable=SC2086
soroban contract bindings typescript \
  $SOURCE_ARGS \
  --output-dir "$OUTPUT_DIR"

# The soroban CLI outputs multiple files; ensure the main entry point exists.
if [[ ! -f "$OUTPUT_FILE" ]]; then
  # If the CLI generated an index.ts instead, rename it.
  if [[ -f "$OUTPUT_DIR/index.ts" ]]; then
    mv "$OUTPUT_DIR/index.ts" "$OUTPUT_FILE"
  else
    echo "WARNING: Expected output file not found at $OUTPUT_FILE" >&2
    echo "  Check $OUTPUT_DIR for generated files." >&2
    exit 1
  fi
fi

echo "TypeScript bindings generated at: $OUTPUT_FILE"
