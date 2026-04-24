/**
 * Format a Stellar address for display (truncate to first 6 and last 4 chars)
 * @param address The full Stellar address
 * @returns Formatted address like "GABC...WXYZ"
 */
export function formatAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
