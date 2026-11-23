/**
 * ContractPauseBanner stories — paused, unknown, active (renders nothing).
 */
import React from "react";
import type { Story } from "@ladle/react";
import ContractPauseBanner from "../components/ContractPauseBanner";

export const Paused: Story = () => (
  <ContractPauseBanner paused={true} contractStatus="paused" />
);
Paused.storyName = "Contract paused";

export const Unknown: Story = () => (
  <ContractPauseBanner paused={false} contractStatus="unknown" />
);
Unknown.storyName = "Contract status unknown";

export const Active: Story = () => (
  <div>
    <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
      Contract is active — banner renders nothing.
    </p>
    <ContractPauseBanner paused={false} contractStatus="active" />
  </div>
);
Active.storyName = "Active (no banner)";
