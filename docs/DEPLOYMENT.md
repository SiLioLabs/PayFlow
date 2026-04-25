# Deployment Guide

This guide covers everything from building the contract to running it on Testnet and eventually Mainnet, including setting up a keeper service to trigger recurring charges.

---

## Prerequisites

| Tool | Install |
| --- | --- |
| Rust 1.70+ | `curl https://sh.rustup.rs -sSf \| sh` |
| wasm32 target | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | `cargo install --locked soroban-cli` |
| Node.js 18+ | [nodejs.org](https://nodejs.org/) |
| Freighter Wallet | [freighter.app](https://www.freighter.app/) |

Verify your setup:

```bash
rustc --version        # rustc 1.70+
soroban --version      # soroban 21.x
node --version         # v18+