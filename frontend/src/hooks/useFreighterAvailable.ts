import { useEffect, useState } from "react";

const FREIGHTER_INSTALL_URL = "https://freighter.app";

interface FreighterAvailability {
    available: boolean;
    installUrl: string;
}

/**
 * Detects whether the Freighter browser extension is installed.
 * Checks window.freighter on mount (after hydration) so SSR-safe.
 */
export function useFreighterAvailable(): FreighterAvailability {
    const [available, setAvailable] = useState<boolean>(false);

    useEffect(() => {
        setAvailable(typeof window !== "undefined" && !!window.freighter);
    }, []);

    return { available, installUrl: FREIGHTER_INSTALL_URL };
}
