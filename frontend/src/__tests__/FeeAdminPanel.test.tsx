import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../stellar");
vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(() => ({
    status: "idle",
    hash: null,
    error: null,
    submit: vi.fn(async (fn: () => Promise<string>) => fn()),
  })),
}));

import * as stellar from "../stellar";
import FeeAdminPanel from "../components/admin/FeeAdminPanel";

const ADMIN = "GADMIN123";
const COLLECTOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

async function renderPanel(isAdmin = true) {
  const onSign = vi.fn().mockResolvedValue("tx-hash");
  render(<FeeAdminPanel adminKey={ADMIN} onSign={onSign} isAdmin={isAdmin} />);
  await waitFor(() => expect(screen.getByText(/250 bps/)).toBeTruthy());
  return onSign;
}

describe("FeeAdminPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(stellar.getProtocolFee).mockResolvedValue({ collector: COLLECTOR, bps: 250 });
    vi.mocked(stellar.getFeeBounds).mockResolvedValue({ minBps: 100, maxBps: 1000 });
    vi.mocked(stellar.buildProposeFeeTx).mockResolvedValue("xdr-propose");
    vi.mocked(stellar.buildCommitFeeTx).mockResolvedValue("xdr-commit");
    vi.mocked(stellar.buildClearFeeTx).mockResolvedValue("xdr-clear");
    vi.mocked(stellar.buildSetFeeBoundsTx).mockResolvedValue("xdr-bounds");
  });

  it("shows the current fee, collector and bounds", async () => {
    await renderPanel();

    expect(screen.getByText(/250 bps/)).toBeTruthy();
    expect(screen.getByText("100–1000 bps")).toBeTruthy();
    expect(screen.getByText(/No pending proposal in this session/)).toBeTruthy();
  });

  it("proposes a fee inside the bounds and then commits it", async () => {
    const onSign = await renderPanel();

    await userEvent.type(screen.getByLabelText("Fee collector address"), COLLECTOR);
    await userEvent.type(screen.getByLabelText("Fee (bps)"), "500");
    await userEvent.click(screen.getByRole("button", { name: "Propose fee" }));

    await waitFor(() => {
      expect(stellar.buildProposeFeeTx).toHaveBeenCalledWith(ADMIN, COLLECTOR, 500);
    });
    expect(onSign).toHaveBeenCalledWith("xdr-propose");
    expect(await screen.findByText(/500 bps →/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Commit fee" }));

    await waitFor(() => {
      expect(stellar.buildCommitFeeTx).toHaveBeenCalledWith(ADMIN);
    });
    expect(onSign).toHaveBeenCalledWith("xdr-commit");
    await waitFor(() => {
      expect(screen.getByText(/No pending proposal in this session/)).toBeTruthy();
    });
  });

  it("blocks a proposal below the configured bounds with the contract message", async () => {
    const onSign = await renderPanel();

    await userEvent.type(screen.getByLabelText("Fee collector address"), COLLECTOR);
    await userEvent.type(screen.getByLabelText("Fee (bps)"), "50");
    await userEvent.click(screen.getByRole("button", { name: "Propose fee" }));

    expect(await screen.findByText(/Fee out of bounds at commit/)).toBeTruthy();
    expect(stellar.buildProposeFeeTx).not.toHaveBeenCalled();
    expect(onSign).not.toHaveBeenCalled();
  });

  it("blocks a proposal above 10 000 bps with the contract message", async () => {
    const onSign = await renderPanel();

    await userEvent.type(screen.getByLabelText("Fee collector address"), COLLECTOR);
    await userEvent.type(screen.getByLabelText("Fee (bps)"), "10001");
    await userEvent.click(screen.getByRole("button", { name: "Propose fee" }));

    expect(await screen.findByText("Invalid fee configuration.")).toBeTruthy();
    expect(stellar.buildProposeFeeTx).not.toHaveBeenCalled();
    expect(onSign).not.toHaveBeenCalled();
  });

  it("blocks an invalid collector address with the contract message", async () => {
    const onSign = await renderPanel();

    await userEvent.type(screen.getByLabelText("Fee collector address"), "not-an-address");
    await userEvent.type(screen.getByLabelText("Fee (bps)"), "500");
    await userEvent.click(screen.getByRole("button", { name: "Propose fee" }));

    expect(await screen.findByText("Invalid fee collector.")).toBeTruthy();
    expect(stellar.buildProposeFeeTx).not.toHaveBeenCalled();
    expect(onSign).not.toHaveBeenCalled();
  });

  it("blocks inconsistent fee bounds before signing", async () => {
    const onSign = await renderPanel();

    const min = screen.getByLabelText("Minimum fee (bps)");
    await userEvent.clear(min);
    await userEvent.type(min, "900");
    const max = screen.getByLabelText("Maximum fee (bps)");
    await userEvent.clear(max);
    await userEvent.type(max, "100");
    await userEvent.click(screen.getByRole("button", { name: "Update fee bounds" }));

    expect(await screen.findByText("Invalid fee bounds.")).toBeTruthy();
    expect(stellar.buildSetFeeBoundsTx).not.toHaveBeenCalled();
    expect(onSign).not.toHaveBeenCalled();
  });

  it("updates fee bounds when the range is valid", async () => {
    const onSign = await renderPanel();

    const min = screen.getByLabelText("Minimum fee (bps)");
    await userEvent.clear(min);
    await userEvent.type(min, "200");
    const max = screen.getByLabelText("Maximum fee (bps)");
    await userEvent.clear(max);
    await userEvent.type(max, "800");
    await userEvent.click(screen.getByRole("button", { name: "Update fee bounds" }));

    await waitFor(() => {
      expect(stellar.buildSetFeeBoundsTx).toHaveBeenCalledWith(ADMIN, 200, 800);
    });
    expect(onSign).toHaveBeenCalledWith("xdr-bounds");
  });

  it("clears the protocol fee", async () => {
    const onSign = await renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Clear fee" }));

    await waitFor(() => {
      expect(stellar.buildClearFeeTx).toHaveBeenCalledWith(ADMIN);
    });
    expect(onSign).toHaveBeenCalledWith("xdr-clear");
  });

  it("disables all fee actions and inputs for non-admin wallets", async () => {
    await renderPanel(false);

    expect(screen.getByText(/Admin access required to change the protocol fee/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Propose fee" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Commit fee" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear fee" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Update fee bounds" })).toBeDisabled();
    expect(screen.getByLabelText("Fee collector address")).toBeDisabled();
    expect(screen.getByLabelText("Fee (bps)")).toBeDisabled();
  });
});
