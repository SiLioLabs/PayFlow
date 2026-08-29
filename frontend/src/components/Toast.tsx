import type { Toast } from "../hooks/useToast";
import { explorerTxUrl } from "../stellar";
import { formatAddress } from "../utils/format";
import { shouldShowToastWhilePaused } from "../utils/notificationPriority";

interface Props {
  toasts: Toast[];
  onRemove: (id: number) => void;
  /** When true, suppresses informational toasts so they don't compete with the contract pause banner. */
  isPaused?: boolean;
}

export default function ToastContainer({ toasts, onRemove, isPaused = false }: Props) {
  const visibleToasts = toasts.filter((t) => shouldShowToastWhilePaused(t.variant, isPaused));
  if (!visibleToasts.length) return null;
  return (
    <div className="toast-container">
      {visibleToasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.variant} fade-in`}>
          <span>
            {t.message}
            {t.txHash && (
              <>
                {" "}
                <a
                  href={explorerTxUrl(t.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="toast__tx-link"
                  title={t.txHash}
                  style={{ textDecoration: "underline" }}
                >
                  tx: {formatAddress(t.txHash)}
                </a>
              </>
            )}
          </span>
          <button className="btn-secondary toast__dismiss" onClick={() => onRemove(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
