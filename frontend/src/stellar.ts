/**
 * stellar.ts — Re-export barrel for backward compatibility during deprecation period.
 *
 * @deprecated This module is deprecated and will be removed in a future release.
 * Please import directly from the modular services:
 * - `services/rpc` for RPC configuration, Server instances, and explorer URLs
 * - `services/builders` for transaction construction functions
 * - `services/reads` for contract read, query, and simulation functions
 */

export * from "./services/rpc";
export * from "./services/builders";
export * from "./services/reads";
