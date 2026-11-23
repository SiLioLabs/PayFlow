/**
 * NetworkBadge stories — renders the badge directly using raw markup so we
 * can preview both network states without env-var gymnastics in the catalogue.
 */
import React from "react";
import type { Story } from "@ladle/react";

export const Testnet: Story = () => (
  <span
    className="badge badge-testnet"
    data-testid="network-badge"
    aria-label="Network: Testnet"
    title="Testnet"
  >
    Testnet
  </span>
);
Testnet.storyName = "Testnet badge";

export const Mainnet: Story = () => (
  <span
    className="badge badge-mainnet"
    data-testid="network-badge"
    aria-label="Network: Mainnet"
    title="Mainnet — real funds at risk"
  >
    Mainnet
  </span>
);
Mainnet.storyName = "Mainnet badge (danger)";
