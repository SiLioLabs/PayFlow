/**
 * addressValidation.ts
 *
 * Shared Stellar address validation helpers consumed by:
 *   - AddressBook (single-address entry validation + import)
 *   - AddressListInput (bulk textarea validation)
 *   - BatchPausePanel / BatchWhitelistPanel (parse + chunk)
 *   - SubscribeForm (referrer field validation)
 *
 * ── Persistence key convention ────────────────────────────────────────────────
 * The address book is persisted in localStorage under the key:
 *
 *   STORAGE_KEY = "flowpay_address_book"
 *
 * This is the single source of truth for that key name. Both AddressBook.tsx
 * and any future components that read the saved entries must import this
 * constant rather than hard-coding the string, so a rename stays consistent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { StrKey } from "@stellar/stellar-sdk";

// ── Persistence key ───────────────────────────────────────────────────────────

/**
 * localStorage key under which the user's saved address book entries are
 * stored as a JSON array of `{ name: string; address: string }` objects.
 *
 * Import this constant instead of hard-coding the string wherever address-book
 * data is read or written so that a key rename stays consistent across the app.
 */
export const STORAGE_KEY = "flowpay_address_book";

// ── Regex ─────────────────────────────────────────────────────────────────────

/** Matches Stellar Federated Addresses, e.g. `user*domain.com`. */
const FEDERATED_ADDRESS_REGEX = /^[^*]+[*][^*]+\.[^*]+$/;

// ── Validators ────────────────────────────────────────────────────────────────

/**
 * Returns `true` for a valid Stellar Ed25519 public key (`G…`, 56 chars) **or**
 * a valid Stellar Federated Address (`user*domain.com`).
 *
 * Used by AddressBook for single-entry validation and by SubscribeForm for the
 * referrer field. For bulk address lists use {@link parseAddressList} instead.
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || FEDERATED_ADDRESS_REGEX.test(address);
}

/**
 * Returns `true` for a valid Ed25519 public key only (`G…`, 56 chars).
 * Federated addresses are **not** accepted because on-chain contract calls
 * require a resolved key; the contract cannot resolve federation aliases.
 *
 * Use this for fields that feed directly into transaction construction (e.g.
 * the AddressBook "Add" form, admin batch panels).
 */
export function isValidEd25519Address(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

/**
 * Validates a single address entry for the address book (name + address pair).
 *
 * Rules:
 *  - `name` must be a non-empty string after trimming.
 *  - `address` must be a non-empty string after trimming and must pass
 *    {@link isValidEd25519Address} (federated aliases are not storable in the
 *    on-chain book).
 *
 * Returns `{ valid: true }` on success or `{ valid: false, error: string }` on
 * failure so callers can surface the appropriate error message.
 */
export function validateAddressBookEntry(
  name: string,
  address: string
): { valid: true } | { valid: false; error: string } {
  if (!name.trim()) {
    return { valid: false, error: "Name is required." };
  }
  if (!address.trim()) {
    return { valid: false, error: "Address is required." };
  }
  if (!isValidEd25519Address(address.trim())) {
    return { valid: false, error: "Invalid Stellar address." };
  }
  return { valid: true };
}

// ── Bulk list helpers ─────────────────────────────────────────────────────────

/**
 * Parses a multiline or delimiter-separated string of Stellar addresses.
 *
 * - Splits on newlines, commas, or whitespace runs.
 * - Trims each token and discards empties.
 * - Deduplicates: the first occurrence is kept in `valid`/`invalid`; subsequent
 *   occurrences are collected in `duplicates` (deduplicated themselves).
 * - Validates each unique token with {@link isValidStellarAddress}.
 *
 * Used by AddressListInput, BatchPausePanel, and BatchWhitelistPanel.
 */
export function parseAddressList(raw: string): {
  valid: string[];
  invalid: string[];
  duplicates: string[];
} {
  const lines = raw
    .split(/[\n,\s]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const line of lines) {
    if (seen.has(line)) {
      if (!duplicates.includes(line)) duplicates.push(line);
      continue;
    }
    seen.add(line);

    if (isValidStellarAddress(line)) {
      valid.push(line);
    } else {
      invalid.push(line);
    }
  }

  return { valid, invalid, duplicates };
}

/**
 * Returns `true` only when the raw input contains at least one valid address
 * and zero invalid addresses. Duplicates are tolerated (they are collapsed).
 */
export function isAddressListValid(raw: string): boolean {
  const { valid, invalid } = parseAddressList(raw);
  return valid.length > 0 && invalid.length === 0;
}

/**
 * Splits an array of addresses into chunks of at most `chunkSize`.
 * Used to stay within per-transaction batch limits (25 for batch-pause,
 * 50 for whitelist operations).
 */
export function chunkAddresses(addresses: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += chunkSize) {
    chunks.push(addresses.slice(i, i + chunkSize));
  }
  return chunks;
}
