/**
 * Toast / ToastContainer stories.
 * Covers: success, error, info, warning variants; long message; with tx hash;
 *         paused state (informational toasts suppressed).
 */
import React, { useState } from "react";
import type { Story } from "@ladle/react";
import ToastContainer from "../components/Toast";
import type { Toast } from "../hooks/useToast";

let _id = 1;

function makeToast(overrides: Partial<Toast>): Toast {
  return {
    id: _id++,
    message: "Something happened",
    variant: "info",
    remainingMs: 5000,
    paused: false,
    ...overrides,
  };
}

export const AllVariants: Story = () => {
  const [toasts, setToasts] = useState<Toast[]>([
    makeToast({ variant: "success", message: "Subscription activated successfully." }),
    makeToast({ variant: "error", message: "Transaction failed: insufficient balance." }),
    makeToast({ variant: "warning", message: "Allowance is below the recommended 3× threshold." }),
    makeToast({ variant: "info", message: "Refreshing charge history…" }),
  ]);

  const remove = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const pause = (id: number) =>
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, paused: true } : t)));
  const resume = (id: number) =>
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, paused: false } : t)));

  return (
    <ToastContainer toasts={toasts} onRemove={remove} onPause={pause} onResume={resume} />
  );
};
AllVariants.storyName = "All variants";

export const WithTxHash: Story = () => {
  const hash = "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890ab";
  const [toasts, setToasts] = useState<Toast[]>([
    makeToast({
      variant: "success",
      message: "Subscription cancelled.",
      txHash: hash,
    }),
  ]);

  const remove = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const pause = (id: number) =>
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, paused: true } : t)));
  const resume = (id: number) =>
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, paused: false } : t)));

  return (
    <ToastContainer toasts={toasts} onRemove={remove} onPause={pause} onResume={resume} />
  );
};
WithTxHash.storyName = "With transaction hash link";

export const SuppressedWhilePaused: Story = () => {
  const [toasts] = useState<Toast[]>([
    makeToast({ variant: "info", message: "This informational toast is suppressed while paused." }),
    makeToast({ variant: "error", message: "Error toasts still show while paused." }),
  ]);

  return (
    <div>
      <p style={{ marginBottom: "1rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
        Contract is paused — informational toasts are suppressed (isPaused=true).
      </p>
      <ToastContainer
        toasts={toasts}
        onRemove={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        isPaused={true}
      />
    </div>
  );
};
SuppressedWhilePaused.storyName = "Suppressed while contract paused";

export const Empty: Story = () => (
  <div>
    <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
      No toasts — container renders nothing.
    </p>
    <ToastContainer toasts={[]} onRemove={() => {}} onPause={() => {}} onResume={() => {}} />
  </div>
);
Empty.storyName = "Empty (no toasts)";
