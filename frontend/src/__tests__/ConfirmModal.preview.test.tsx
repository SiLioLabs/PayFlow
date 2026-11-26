import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TxSimulationPreview } from "../stellar";

vi.mock("../stellar", () => ({
  simulateTransactionPreview: vi.fn(),
}));

import { simulateTransactionPreview } from "../stellar";
import ConfirmModal from "../components/ConfirmModal";

const mockSimulate = vi.mocked(simulateTransactionPreview);

function preview(overrides: Partial<TxSimulationPreview> = {}): TxSimulationPreview {
  return {
    feeStroops: 2500,
    feeXlm: "0.0002500",
    errorCode: null,
    errorMessage: null,
    overrideAllowed: false,
    blockSigning: false,
    rpcError: null,
    ...overrides,
  };
}

describe("ConfirmModal transaction preview", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("simulates when the modal opens and shows the estimated fee", async () => {
    const buildXdr = vi.fn().mockResolvedValue("built-xdr");
    mockSimulate.mockResolvedValue(preview());

    render(
      <ConfirmModal
        message="Confirm subscription?"
        onConfirm={onConfirm}
        onCancel={onCancel}
        buildXdr={buildXdr}
        confirmTestId="confirm-tx"
      />
    );

    await waitFor(() => expect(screen.getByTestId("tx-preview-fee")).toBeInTheDocument());
    expect(buildXdr).toHaveBeenCalledOnce();
    expect(mockSimulate).toHaveBeenCalledWith("built-xdr");
    expect(screen.getByTestId("tx-preview-fee")).toHaveTextContent("0.0002500 XLM");

    fireEvent.click(screen.getByTestId("confirm-tx"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("surfaces a simulated failure and blocks confirming", async () => {
    mockSimulate.mockResolvedValue(
      preview({
        feeXlm: null,
        errorCode: "#8",
        errorMessage: "Increase your token allowance and try again.",
        blockSigning: true,
      })
    );

    render(
      <ConfirmModal
        message="Confirm subscription?"
        onConfirm={onConfirm}
        onCancel={onCancel}
        buildXdr={vi.fn().mockResolvedValue("xdr")}
        confirmTestId="confirm-tx"
      />
    );

    await waitFor(() => expect(screen.getByTestId("tx-preview-failure")).toBeInTheDocument());
    expect(screen.getByTestId("tx-preview-failure")).toHaveTextContent("token allowance");
    expect(screen.getByTestId("tx-preview-failure")).toHaveTextContent("#8");

    const confirmButton = screen.getByTestId("confirm-tx");
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("allows an explicit override only for safe-to-override failures", async () => {
    mockSimulate.mockResolvedValue(
      preview({
        feeXlm: null,
        errorCode: "#6",
        errorMessage: "Your next charge date hasn't arrived yet.",
        blockSigning: true,
        overrideAllowed: true,
      })
    );

    render(
      <ConfirmModal
        message="Confirm charge?"
        onConfirm={onConfirm}
        onCancel={onCancel}
        buildXdr={vi.fn().mockResolvedValue("xdr")}
        confirmTestId="confirm-tx"
      />
    );

    await waitFor(() => expect(screen.getByTestId("tx-preview-override")).toBeInTheDocument());
    expect(screen.getByTestId("confirm-tx")).toBeDisabled();

    fireEvent.click(screen.getByTestId("tx-preview-override"));
    await waitFor(() => expect(screen.getByTestId("confirm-tx")).toBeEnabled());
    fireEvent.click(screen.getByTestId("confirm-tx"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does not render a preview when no buildXdr is supplied", () => {
    render(
      <ConfirmModal message="Delete?" onConfirm={onConfirm} onCancel={onCancel} confirmTestId="confirm" />
    );

    expect(screen.queryByTestId("tx-simulation-preview")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
