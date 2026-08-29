import { StrKey } from "@stellar/stellar-sdk";

// Regex to validate Stellar Federated Addresses (e.g., user*domain.com)
const FEDERATED_ADDRESS_REGEX = /^[^*]+[*][^*]+\.[^*]+$/;

export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || FEDERATED_ADDRESS_REGEX.test(address);
}

/**
 * Parses a multiline or delimiter-separated string of Stellar addresses.
 */
export function parseAddressList(raw: string): {
  valid: string[];
  invalid: string[];
  duplicates: string[];
} {
  // Split by newlines, commas, or spaces
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

export function isAddressListValid(raw: string): boolean {
  const { valid, invalid } = parseAddressList(raw);
  return valid.length > 0 && invalid.length === 0;
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
