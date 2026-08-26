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
