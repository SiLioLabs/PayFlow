/**
 * Spinner stories — sm, md, lg sizes.
 */
import React from "react";
import type { Story } from "@ladle/react";
import Spinner from "../components/Spinner";

export const Small: Story = () => <Spinner size="sm" />;
Small.storyName = "Small (sm)";

export const Medium: Story = () => <Spinner size="md" />;
Medium.storyName = "Medium (md) — default";

export const Large: Story = () => <Spinner size="lg" />;
Large.storyName = "Large (lg)";

export const AllSizes: Story = () => (
  <div style={{ display: "flex", gap: "2rem", alignItems: "center" }}>
    <div style={{ textAlign: "center" }}>
      <Spinner size="sm" />
      <p style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>sm</p>
    </div>
    <div style={{ textAlign: "center" }}>
      <Spinner size="md" />
      <p style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>md</p>
    </div>
    <div style={{ textAlign: "center" }}>
      <Spinner size="lg" />
      <p style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>lg</p>
    </div>
  </div>
);
AllSizes.storyName = "All sizes";
