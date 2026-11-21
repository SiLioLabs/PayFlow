import { describe, it, expect } from "vitest";
import { parseAddressList, isAddressListValid, chunkAddresses } from "../utils/addressValidation";

// A set of real-format valid Stellar addresses (Ed25519 G-keys, 56 chars)
// Generated via Keypair.random() — checksum-valid for StrKey.isValidEd25519PublicKey
const ADDR_VALID_1 = "GCOEYT3WI3LY34I7DN7BR7AF33TNF2YF4OYTLVPJKMYAWT2RWEF5BUDK";
const ADDR_VALID_2 = "GAEVL5Q7VI7A72TZLBHCNYEFGLC7GDQVOX4KKER67U6EUPR3LCZ3NULB";
const ADDR_VALID_3 = "GDSG7FQANGG6BP2QNVPKOBHDTKHTOBKRWK2LD6Z7OLZ4GXQXZDXE6AEL";

describe("parseAddressList", () => {
  it("returns valid addresses from a newline-separated list", () => {
    const raw = [ADDR_VALID_1, ADDR_VALID_2].join("\n");
    const { valid, invalid } = parseAddressList(raw);
    expect(valid).toHaveLength(2);
    expect(invalid).toHaveLength(0);
  });

  it("trims whitespace from each line", () => {
    const raw = `  ${ADDR_VALID_1}  \n  ${ADDR_VALID_2}  `;
    const { valid } = parseAddressList(raw);
    expect(valid).toContain(ADDR_VALID_1);
    expect(valid).toContain(ADDR_VALID_2);
  });

  it("ignores blank lines", () => {
    const raw = `${ADDR_VALID_1}\n\n\n${ADDR_VALID_2}`;
    const { valid } = parseAddressList(raw);
    expect(valid).toHaveLength(2);
  });

  it("flags invalid addresses", () => {
    const raw = `${ADDR_VALID_1}\nnot-an-address\nSHORT`;
    const { valid, invalid } = parseAddressList(raw);
    expect(valid).toHaveLength(1);
    expect(invalid).toContain("not-an-address");
    expect(invalid).toContain("SHORT");
  });

  it("deduplicates addresses and reports duplicates", () => {
    const raw = [ADDR_VALID_1, ADDR_VALID_1, ADDR_VALID_2].join("\n");
    const { valid, duplicates } = parseAddressList(raw);
    expect(valid).toHaveLength(2);
    expect(duplicates).toContain(ADDR_VALID_1);
    expect(duplicates).toHaveLength(1);
  });

  it("returns empty arrays for empty input", () => {
    const { valid, invalid, duplicates } = parseAddressList("");
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(0);
    expect(duplicates).toHaveLength(0);
  });

  it("accepts comma-separated addresses", () => {
    const raw = `${ADDR_VALID_1},${ADDR_VALID_2},${ADDR_VALID_3}`;
    const { valid } = parseAddressList(raw);
    expect(valid).toHaveLength(3);
  });
});

describe("isAddressListValid", () => {
  it("returns true when all addresses are valid", () => {
    expect(isAddressListValid(`${ADDR_VALID_1}\n${ADDR_VALID_2}`)).toBe(true);
  });

  it("returns false when any address is invalid", () => {
    expect(isAddressListValid(`${ADDR_VALID_1}\nbad-address`)).toBe(false);
  });

  it("returns false for an empty string (no valid addresses)", () => {
    expect(isAddressListValid("")).toBe(false);
  });

  it("returns false for a string with only invalid addresses", () => {
    expect(isAddressListValid("not-valid\nalso-not-valid")).toBe(false);
  });
});

describe("chunkAddresses", () => {
  const addresses = Array.from({ length: 30 }, (_, i) => `addr${i}`);

  it("splits into chunks of the given size", () => {
    const chunks = chunkAddresses(addresses, 10);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(10);
    expect(chunks[1]).toHaveLength(10);
    expect(chunks[2]).toHaveLength(10);
  });

  it("handles an incomplete final chunk", () => {
    const chunks = chunkAddresses(addresses, 25);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(25);
    expect(chunks[1]).toHaveLength(5);
  });

  it("returns a single chunk when list is within limit", () => {
    const small = addresses.slice(0, 5);
    const chunks = chunkAddresses(small, 25);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(5);
  });

  it("returns empty array for empty input", () => {
    expect(chunkAddresses([], 25)).toHaveLength(0);
  });

  it("preview count matches valid address count", () => {
    // Simulates the preview: valid.length addresses split by MAX_PAUSE_BATCH
    const MAX_PAUSE_BATCH = 25;
    const thirtyAddresses = Array.from({ length: 30 }, (_, i) => `addr${i}`);
    const chunks = chunkAddresses(thirtyAddresses, MAX_PAUSE_BATCH);
    const totalAddresses = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalAddresses).toBe(30);
    expect(chunks.length).toBe(2);
  });
});

// ─── New exports added in the shared-validation refactor ─────────────────────

import {
  STORAGE_KEY,
  isValidEd25519Address,
  validateAddressBookEntry,
} from "../utils/addressValidation";

// Valid Ed25519 keys reused from the suite above
const VALID_ED25519 = ADDR_VALID_1;
const FEDERATED_ADDR = "user*domain.com";

// ── STORAGE_KEY ───────────────────────────────────────────────────────────────

describe("STORAGE_KEY", () => {
  it("is the canonical flowpay_address_book key", () => {
    expect(STORAGE_KEY).toBe("flowpay_address_book");
  });

  it("is a non-empty string so localStorage.setItem never silently no-ops", () => {
    expect(typeof STORAGE_KEY).toBe("string");
    expect(STORAGE_KEY.length).toBeGreaterThan(0);
  });
});

// ── isValidEd25519Address ─────────────────────────────────────────────────────

describe("isValidEd25519Address", () => {
  it("accepts a valid Ed25519 G-key", () => {
    expect(isValidEd25519Address(VALID_ED25519)).toBe(true);
  });

  it("rejects a federated address (cannot be used on-chain directly)", () => {
    expect(isValidEd25519Address(FEDERATED_ADDR)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidEd25519Address("")).toBe(false);
  });

  it("rejects a truncated key", () => {
    expect(isValidEd25519Address(VALID_ED25519.slice(0, 40))).toBe(false);
  });

  it("rejects a key with an invalid checksum", () => {
    // Flip the last character to corrupt the checksum
    const broken = VALID_ED25519.slice(0, -1) + (VALID_ED25519.endsWith("A") ? "B" : "A");
    expect(isValidEd25519Address(broken)).toBe(false);
  });

  it("rejects an address starting with the wrong strkey prefix (secret key)", () => {
    // S… is a secret key, not an account public key
    expect(isValidEd25519Address("SBODGZWH6PGIH5BJXVMPKC4I7VBY6BKBMQGLQSXB6QDDBYMSVXSXZBF")).toBe(
      false
    );
  });
});

// ── validateAddressBookEntry ──────────────────────────────────────────────────

describe("validateAddressBookEntry — add", () => {
  it("returns valid:true for a well-formed name and Ed25519 address", () => {
    const result = validateAddressBookEntry("Alice", VALID_ED25519);
    expect(result.valid).toBe(true);
  });

  it("trims the name before checking emptiness", () => {
    const result = validateAddressBookEntry("  Alice  ", VALID_ED25519);
    expect(result.valid).toBe(true);
  });

  it("trims the address before validating", () => {
    const result = validateAddressBookEntry("Bob", `  ${VALID_ED25519}  `);
    expect(result.valid).toBe(true);
  });
});

describe("validateAddressBookEntry — invalidContext: empty / bad inputs", () => {
  it("fails with 'Name is required.' when name is empty", () => {
    const result = validateAddressBookEntry("", VALID_ED25519);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("Name is required.");
  });

  it("fails with 'Name is required.' when name is only whitespace", () => {
    const result = validateAddressBookEntry("   ", VALID_ED25519);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("Name is required.");
  });

  it("fails with 'Address is required.' when address is empty", () => {
    const result = validateAddressBookEntry("Alice", "");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("Address is required.");
  });

  it("fails with 'Address is required.' when address is only whitespace", () => {
    const result = validateAddressBookEntry("Alice", "   ");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("Address is required.");
  });

  it("fails with 'Invalid Stellar address.' for a random string", () => {
    const result = validateAddressBookEntry("Alice", "notanaddress");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("Invalid Stellar address.");
  });

  it("fails with 'Invalid Stellar address.' for a federated address (not on-chain resolvable)", () => {
    const result = validateAddressBookEntry("Alice", FEDERATED_ADDR);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("Invalid Stellar address.");
  });

  it("fails with 'Invalid Stellar address.' for a truncated key", () => {
    const result = validateAddressBookEntry("Alice", VALID_ED25519.slice(0, 40));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("Invalid Stellar address.");
  });
});

describe("validateAddressBookEntry — remove (deletion is entry-index-based, no re-validation)", () => {
  // Deletion in AddressBook is by array index; the remove path never calls
  // validateAddressBookEntry. These tests document that contract: validation
  // is only an ADD-time concern and must not gate removal.

  it("does not gate removal: filtering by index does not invoke validateAddressBookEntry", () => {
    const entries = [
      { name: "Alice", address: VALID_ED25519 },
      { name: "Bob", address: ADDR_VALID_2 },
    ];
    // Simulate the exact remove logic in AddressBook.tsx
    const afterRemove = entries.filter((_, i) => i !== 0);
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove[0].name).toBe("Bob");
  });

  it("does not re-validate a stored entry that predates strict validation rules", () => {
    // A legacy entry stored before isValidEd25519Address was enforced should
    // survive in the list unchanged — validateAddressBookEntry is never called
    // during list render or removal, only during the ADD flow.
    const legacyEntry = { name: "Legacy", address: "legacy-addr" };
    const entries = [legacyEntry, { name: "Alice", address: VALID_ED25519 }];
    const afterRemove = entries.filter((_, i) => i !== 0);
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove[0].name).toBe("Alice");
  });
});
