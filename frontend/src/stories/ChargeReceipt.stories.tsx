/**
 * ChargeReceipt stories — inline card, with fee, without fee, print layout.
 */
import React from "react";
import type { Story } from "@ladle/react";
import ChargeReceipt from "../components/ChargeReceipt";
import type { ChargeEvent } from "../types";

const SAMPLE_EVENT: ChargeEvent = {
  date: new Date("2026-11-20T14:35:00Z"),
  amount: "50000000", // 5 XLM
  txHash:
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  merchant: "GBZXN7PIRZGNMHGA7QA7FBT3BTSCKPF5ZJMPKH3VGZRWMHBKIUCMPHB",
};

export const InlineCard: Story = () => (
  <div className="card" style={{ maxWidth: 640 }}>
    <ChargeReceipt event={SAMPLE_EVENT} modal={false} />
  </div>
);
InlineCard.storyName = "Inline card (no modal)";

export const WithMerchantName: Story = () => (
  <div className="card" style={{ maxWidth: 640 }}>
    <ChargeReceipt
      event={SAMPLE_EVENT}
      merchantName="Acme SaaS Inc."
      modal={false}
    />
  </div>
);
WithMerchantName.storyName = "With merchant display name";

export const InModal: Story = () => {
  const [open, setOpen] = React.useState(true);
  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        Open Receipt
      </button>
    );
  }
  return (
    <ChargeReceipt
      event={SAMPLE_EVENT}
      merchantName="Acme SaaS Inc."
      onClose={() => setOpen(false)}
      modal={true}
    />
  );
};
InModal.storyName = "In modal overlay";
