import { useEffect, useState } from "react";
import { NETWORK_PASSPHRASE } from "../stellar";

interface NetworkCheckResult {
    networkMatch: boolean;
    walletNetwork: string;
}

/**
 * Checks whether the Freighter wallet is configured to the same network
 * as the app (NETWORK_PASSPHRASE from stellar.ts).
 * Re-runs whenever the component mounts.
 */
export function useNetworkCheck(): NetworkCheckResult {
    const [result, setResult] = useState<NetworkCheckResult>({
        networkMatch: true, // optimistic default — no false warning before check completes
        walletNetwork: "",
    });

    useEffect(() => {
        let cancelled = false;

        async function check() {
            if (!window.freighter) return;

            try {
                const { network, networkPassphrase } =
                    await window.freighter.getNetwork();

                if (!cancelled) {
                    setResult({
                        networkMatch: networkPassphrase === NETWORK_PASSPHRASE,
                        walletNetwork: network,
                    });
                }
            } catch {
                // If getNetwork() fails (older Freighter), assume match to avoid noise
            }
        }

        check();
        return () => {
            cancelled = true;
        };
    }, []);

    return result;
}
