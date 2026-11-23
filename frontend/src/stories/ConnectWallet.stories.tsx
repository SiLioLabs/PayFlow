/**
 * ConnectWallet stories — idle, loading, error states.
 */
import React from "react";
import type { Story } from "@ladle/react";
import ConnectWallet from "../components/ConnectWallet";

export const Default: Story = () => (
  <div style={{ maxWidth: 400 }}>
    <ConnectWallet onConnect={() => alert("connect")} error={null} />
  </div>
);
Default.storyName = "Idle";

export const Loading: Story = () => (
  <div style={{ maxWidth: 400 }}>
    <ConnectWallet onConnect={() => {}} error={null} loading={true} />
  </div>
);
Loading.storyName = "Connecting (loading)";

export const WithError: Story = () => (
  <div style={{ maxWidth: 400 }}>
    <ConnectWallet
      onConnect={() => {}}
      error="Freighter extension not found. Install it from freighter.app."
    />
  </div>
);
WithError.storyName = "Error — wallet not found";
