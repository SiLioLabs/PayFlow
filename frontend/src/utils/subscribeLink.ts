import { validateAddress } from "../hooks/useFormValidation";
import { isValidEd25519Address } from "./addressValidation";

export const APP_BASE_URL =
  (import.meta as unknown as { env: Record<string, string> }).env?.VITE_APP_BASE_URL ??
  "https://app.payflow.io";

export function buildReferralUrl(
  address: string,
  baseUrl = APP_BASE_URL,
  merchant?: string | null
): string {
  const params = new URLSearchParams();
  params.set("ref", address);
  if (merchant) params.set("merchant", merchant);
  return `${baseUrl}/?${params.toString()}`;
}

export function getReferrerFromSearch(search: string): string | null {
  const ref = new URLSearchParams(search).get("ref");
  return ref && ref.trim() ? ref.trim() : null;
}

export function getMerchantFromSearch(search: string): string | null {
  const merchant = new URLSearchParams(search).get("merchant");
  return merchant && merchant.trim() ? merchant.trim() : null;
}

export interface SubscribeLinkParams {
  referrer: string | null;
  merchant: string | null;
  selfReferral: boolean;
  notices: string[];
}

export function parseSubscribeLinkParams(
  search: string,
  currentUser?: string | null
): SubscribeLinkParams {
  const notices: string[] = [];
  const ref = getReferrerFromSearch(search);
  const merchant = getMerchantFromSearch(search);
  let referrer: string | null = null;
  let selfReferral = false;

  if (ref) {
    if (currentUser && ref === currentUser) {
      selfReferral = true;
      referrer = ref;
      notices.push("You cannot refer yourself — the referral will be rejected by the contract.");
    } else if (!isValidEd25519Address(ref)) {
      notices.push(`Ignored invalid referral address from link: ${ref}`);
    } else {
      referrer = ref;
    }
  }

  let validMerchant: string | null = null;
  if (merchant) {
    if (validateAddress(merchant).valid) {
      validMerchant = merchant;
    } else {
      notices.push(`Ignored invalid merchant address from link: ${merchant}`);
    }
  }

  return { referrer, merchant: validMerchant, selfReferral, notices };
}

export function hasSubscribeLinkParams(search: string): boolean {
  return getReferrerFromSearch(search) !== null || getMerchantFromSearch(search) !== null;
}
