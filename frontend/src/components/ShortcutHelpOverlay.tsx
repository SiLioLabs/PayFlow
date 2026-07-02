import React, { useRef } from "react";
import { KeyboardShortcut } from "../hooks/useKeyboardShortcuts";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface Props {
  shortcuts: KeyboardShortcut[];
  onClose: () => void;
}

export default function ShortcutHelpOverlay({ shortcuts, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Trap focus inside the overlay and call onClose if Escape is pressed
  useFocusTrap(overlayRef, true, onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={overlayRef}
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        aria-labelledby="shortcut-title"
      >
        <h3 id="shortcut-title" style={{ marginTop: 0 }}>
          Keyboard Shortcuts
        </h3>
        <dl
          style={{ display: "flex", flexDirection: "column", gap: "12px", margin: 0, padding: 0 }}
        >
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "16px",
              }}
            >
              <dt style={{ margin: 0 }}>{shortcut.description}</dt>
              <dd style={{ margin: 0 }}>
                <kbd
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    backgroundColor: "var(--color-bg-secondary)",
                    border: "1px solid var(--color-border)",
                    fontFamily: "monospace",
                    fontSize: "14px",
                  }}
                >
                  {shortcut.key}
                </kbd>
              </dd>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <dt style={{ margin: 0 }}>Close modals / help overlay</dt>
            <dd style={{ margin: 0 }}>
              <kbd
                style={{
                  padding: "4px 8px",
                  borderRadius: "4px",
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border)",
                  fontFamily: "monospace",
                  fontSize: "14px",
                }}
              >
                Esc
              </kbd>
            </dd>
          </div>
        </dl>
        <div style={{ marginTop: "16px", textAlign: "right" }}>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
