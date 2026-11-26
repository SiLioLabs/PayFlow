import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletBar from "../components/WalletBar";
import * as txQueue from "../services/txQueue";

vi.mock("../utils/format", () => ({ formatAddress: (address: string) => address }));
vi.mock("../components/CopyButton", () => ({ default: () => null }));
vi.mock("../components/NetworkBadge", () => ({ default: () => null }));
vi.mock("../components/BalanceDisplay", () => ({ default: () => null }));
vi.mock("../components/NotificationCenter", () => ({ default: () => null }));
vi.mock("../stellar", () => ({ explorerTxUrl: (hash: string) => hash }));

describe("WalletBar transaction recovery", () => {
  beforeEach(() => txQueue._reset());

  it("mounts the queue panel and exposes queued entries", () => {
    txQueue.enqueue("Subscribe");

    render(<WalletBar publicKey="GABC" activeAdapter={null} onDisconnect={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Transaction queue" })).toBeInTheDocument();
    expect(screen.getByText("Subscribe")).toBeInTheDocument();
  });
});