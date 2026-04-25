import { STROOPS_PER_XLM } from "../constants";

export function formatAddress(addr: string, prefixLen = 6, suffixLen = 4): string {
  if (addr.length <= prefixLen + suffixLen) return addr;
  return `${addr.slice(0, prefixLen)}\u2026${addr.slice(-suffixLen)}`;
}

export function formatXlm(stroops: string | bigint): string {
  return `${(Number(BigInt(stroops)) / STROOPS_PER_XLM).toFixed(7)} XLM`;
}
