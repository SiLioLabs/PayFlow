/**
 * CopyButton stories.
 */
import React from "react";
import type { Story } from "@ladle/react";
import CopyButton from "../components/CopyButton";

const ADDRESS = "GBZXN7PIRZGNMHGA7QA7FBT3BTSCKPF5ZJMPKH3VGZRWMHBKIUCMPHB";

export const Default: Story = () => (
  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
    <span style={{ fontFamily: "monospace", fontSize: "0.875rem" }}>
      {ADDRESS.slice(0, 8)}…{ADDRESS.slice(-6)}
    </span>
    <CopyButton text={ADDRESS} />
  </div>
);
Default.storyName = "Default";

export const CustomLabel: Story = () => (
  <CopyButton text={ADDRESS} ariaLabel="Copy merchant address" />
);
CustomLabel.storyName = "Custom aria-label";
