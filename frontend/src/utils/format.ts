export function formatAddress(addr: string, prefixLen = 6, suffixLen = 4): string {
  if (addr.length <= prefixLen + suffixLen) return addr;
  return `${addr.slice(0, prefixLen)}…${addr.slice(-suffixLen)}`;
}

export function formatXlm(stroops: string | bigint): string {
  return `${(Number(BigInt(stroops)) / 10_000_000).toFixed(7)} XLM`;
}
