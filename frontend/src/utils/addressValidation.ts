import { StrKey } from "@stellar/stellar-sdk";

/**
 * Parses a multiline string of Stellar addresses.
 *
 * - Trims each line
 * - Removes blank lines
 * - Deduplicates (preserving first occurrence)
 *
 * Returns two arrays: valid and invalid addresses.
 */
export function parseAddressList(raw: string): {
  valid: string[];
  invalid: string[];
  duplicates: string[];
} {
  const lines = raw
    .split(/[\n,]+/)
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

    if (StrKey.isValidEd25519PublicKey(line)) {
      valid.push(line);
    } else {
      invalid.push(line);
    }
  }

  return { valid, invalid, duplicates };
}

/** Returns true when every non-blank line in the raw input is a valid Stellar address. */
export function isAddressListValid(raw: string): boolean {
  const { invalid } = parseAddressList(raw);
  return invalid.length === 0;
}

/**
 * Splits an array of addresses into chunks of at most `chunkSize`.
 * Used to stay within per-transaction batch limits.
 */
export function chunkAddresses(addresses: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += chunkSize) {
    chunks.push(addresses.slice(i, i + chunkSize));
  }
  return chunks;
}
