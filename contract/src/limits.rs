use crate::batch::MAX_BATCH_SIZE;

pub const DEFAULT_MAX_BATCH_SIZE: u32 = MAX_BATCH_SIZE;

/// Safe documented max batch size that fits within typical resource envelopes.
/// Actual charge-path CPU/memory is linear in users.len() with a small per-user
/// overhead (storage read, allowance check, transfer, storage write, event).
pub const DOCUMENTED_SAFE_MAX_BATCH: u32 = MAX_BATCH_SIZE;

/// Stellar Soroban testnet approximate CPU instruction ceiling per op.
/// This is a conservative reference value — real limits vary by network.
pub const SOROBAN_CPU_INSN_SOFT_LIMIT: u64 = 100_000_000;

/// Memory bytes soft-limit for a single Soroban operation.
pub const SOROBAN_MEM_BYTES_SOFT_LIMIT: u64 = 50 * 1024 * 1024;

