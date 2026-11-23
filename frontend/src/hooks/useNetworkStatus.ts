/**
 * useNetworkStatus — the single connectivity contract for the app.
 *
 * Merges the former `useNetworkStatus` (browser online/offline) and
 * `useNetworkCheck` (wallet network vs. app network) hooks so every
 * consumer shares one definition of "the network is down".
 *
 * `status` is derived as follows:
 *  - "offline"  — the browser reports no connectivity (navigator.onLine / "offline" event).
 *                 Takes precedence over everything else.
 *  - "checking" — the browser is online and the wallet network check is in flight.
 *  - "online"   — the browser is online and the wallet network was read successfully.
 *  - "unknown"  — the browser is online (or cannot report) but the wallet network could
 *                 not be verified (no compatible adapter, an unsupported network query,
 *                 or no browser environment).
 *
 * `networkMatch` stays optimistic (`true`) until the wallet check proves otherwise, so no
 * mismatch warning flashes before the check completes or when it cannot run.
 *
 * Note: navigator.onLine can return `true` even when there is no actual internet access
 * (e.g. connected to a router but no upstream). This is a known browser limitation — we
 * treat it as online per the spec. RPC reachability is tracked separately by useRpcHealth.
 */
import { useCallback, useEffect, useState } from "react";
import { NETWORK_PASSPHRASE } from "../stellar";
import {
  isMainnetPassphrase,
  isMainnetConfirmed as getMainnetConfirmed,
  setMainnetConfirmed,
} from "../utils/network";
import type { WalletAdapter } from "../services/wallets/WalletAdapter";

const WALLET_NETWORK_POLL_MS = 5000;
export type NetworkStatus = "online" | "offline" | "unknown" | "checking";

export interface NetworkStatusResult {
  /** Single connectivity state; see module docs for how it is derived. */
  status: NetworkStatus;
  /** `false` only when `status === "offline"`. */
  isOnline: boolean;
  /** Whether the wallet is on the app's network. Optimistic `true` until proven otherwise. */
  networkMatch: boolean;
  /** Network name reported by the wallet, or "" before/without a successful check. */
  walletNetwork: string;
  isMainnet: boolean;
  isMainnetConfirmed: boolean;
  requiresMainnetConfirm: boolean;
  confirmMainnet: () => void;
}

type WalletCheck = "checking" | "verified" | "unverified";

function readBrowserOnline(): boolean | null {
  return typeof navigator !== "undefined" ? navigator.onLine : null;
}

function hasFreighter(): boolean {
  return typeof window !== "undefined" && Boolean(window.freighter);
}

export function useNetworkStatus(adapter?: WalletAdapter | null): NetworkStatusResult {
  // `null` = the environment cannot report connectivity.
  const [browserOnline, setBrowserOnline] = useState<boolean | null>(readBrowserOnline);
  const [walletCheck, setWalletCheck] = useState<WalletCheck>(() =>
    adapter?.getNetwork || hasFreighter() ? "checking" : "unverified"
  );
  const [wallet, setWallet] = useState({ networkMatch: true, walletNetwork: "" });

  const isMainnet = isMainnetPassphrase(NETWORK_PASSPHRASE);
  const [isMainnetConfirmed, setIsMainnetConfirmed] = useState<boolean>(() => {
    if (!isMainnet) return true;
    try {
      return getMainnetConfirmed();
    } catch {
      return false;
    }
  });

  const confirmMainnet = useCallback(() => {
    setMainnetConfirmed();
    setIsMainnetConfirmed(true);
  }, []);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let checking = false;
    let hasChecked = false;
    const getNetwork = adapter
      ? adapter.getNetwork
        ? () => adapter.getNetwork!()
        : null
      : hasFreighter()
        ? () => window.freighter!.getNetwork()
        : null;
    setWallet({ networkMatch: true, walletNetwork: "" });
    setWalletCheck(getNetwork ? "checking" : "unverified");

    async function check() {
      if (!getNetwork) {
        setWallet({ networkMatch: true, walletNetwork: "" });
        setWalletCheck("unverified");
        hasChecked = true;
        return;
      }

      if (checking) return;
      checking = true;
      if (!hasChecked) setWalletCheck("checking");
      try {
        const { network, networkPassphrase } = await getNetwork();
        if (cancelled) return;
        setWallet({
          networkMatch: networkPassphrase === NETWORK_PASSPHRASE,
          walletNetwork: network,
        });
        setWalletCheck("verified");
        hasChecked = true;
      } catch {
        // If a wallet cannot report its network, keep the match optimistic to avoid noise.
        if (!cancelled) {
          setWallet({ networkMatch: true, walletNetwork: "" });
          setWalletCheck("unverified");
          hasChecked = true;
        }
      } finally {
        checking = false;
      }
    }

    check();
    const interval = window.setInterval(check, WALLET_NETWORK_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [adapter]);

  let status: NetworkStatus;
  if (browserOnline === false) status = "offline";
  else if (walletCheck === "checking") status = "checking";
  else if (walletCheck === "verified" && browserOnline) status = "online";
  else status = "unknown";

  return {
    status,
    isOnline: status !== "offline",
    ...wallet,
    isMainnet,
    isMainnetConfirmed,
    requiresMainnetConfirm: isMainnet && !isMainnetConfirmed,
    confirmMainnet,
  };
}
