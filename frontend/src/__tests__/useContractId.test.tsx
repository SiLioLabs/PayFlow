import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import * as stellar from "@stellar/stellar-sdk";
import { useContractId } from "../hooks/useContractId";

function makeTestComponent() {
  return function Test() {
    const r = useContractId();
    return (
      <div>
        <span>valid:{String(r.valid)}</span>
        <span>error:{String(r.error)}</span>
        <span>id:{r.contractId}</span>
      </div>
    );
  };
}

describe("useContractId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("valid contract ID -> valid = true", async () => {
    // set env
    import.meta.env.VITE_CONTRACT_ID = "VALID_ID";
    vi.spyOn(stellar.StrKey, "isValidContract").mockReturnValue(true);

    const Test = makeTestComponent();
    render(<Test />);

    await waitFor(() => expect(screen.getByText(/valid:true/)).toBeTruthy());
    expect(screen.getByText(/error:null/)).toBeTruthy();
  });

  it("empty contract ID -> valid = false, error set", async () => {
    import.meta.env.VITE_CONTRACT_ID = "";
    vi.spyOn(stellar.StrKey, "isValidContract").mockReturnValue(false);

    const Test = makeTestComponent();
    render(<Test />);

    await waitFor(() => expect(screen.getByText(/valid:false/)).toBeTruthy());
    expect(screen.getByText(/VITE_CONTRACT_ID environment variable is not set/)).toBeTruthy();
  });

  it("malformed contract ID -> valid = false", async () => {
    import.meta.env.VITE_CONTRACT_ID = "BAD";
    vi.spyOn(stellar.StrKey, "isValidContract").mockReturnValue(false);

    const Test = makeTestComponent();
    render(<Test />);

    await waitFor(() => expect(screen.getByText(/valid:false/)).toBeTruthy());
    expect(screen.getByText(/not a valid Soroban contract address/)).toBeTruthy();
  });
});
