import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { useFreighterAvailable } from "../hooks/useFreighterAvailable";

function Test() {
  const avail = useFreighterAvailable();
  return (
    <div>
      <span>available:{String(avail.available)}</span>
      <span>install:{avail.installUrl}</span>
    </div>
  );
}

describe("useFreighterAvailable", () => {
  afterEach(() => {
    // clean up any global we set
    try {
      // @ts-ignore
      delete (global as any).window.freighter;
    } catch {}
  });

  it("reports available when window.freighter exists", async () => {
    // ensure global window exists
    // @ts-ignore
    (global as any).window = global.window || {};
    // @ts-ignore
    window.freighter = {};

    render(<Test />);

    await waitFor(() => expect(screen.getByText(/available:true/)).toBeTruthy());
    expect(screen.getByText(/install:/)).toBeTruthy();
  });

  it("reports not available when window.freighter is missing", async () => {
    // ensure it's undefined
    // @ts-ignore
    (global as any).window = global.window || {};
    // @ts-ignore
    delete (global as any).window.freighter;

    render(<Test />);

    await waitFor(() => expect(screen.getByText(/available:false/)).toBeTruthy());
    expect(screen.getByText(/install:https:\/\/freighter.app/)).toBeTruthy();
  });
});
