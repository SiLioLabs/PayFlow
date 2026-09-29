/**
 * BatchWhitelistPanel — skeleton / loading / empty / error / race tests.
 *
 * Mirrors BatchPausePanel.skeleton.test.tsx but targets the whitelist variant.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../stellar");
vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(() => ({
    status: "idle",
    hash: null,
    error: null,
    submit: vi.fn(async (fn: () => Promise<string>) => fn()),
  })),
}));
vi.mock("../hooks/useToast", () => ({
  useToast: vi.fn(() => ({
    toasts: [],
    addToast: vi.fn(),
    removeToast: vi.fn(),
    pauseToast: vi.fn(),
    resumeToast: vi.fn(),
  })),
}));

import BatchWhitelistPanel from "../components/admin/BatchWhitelistPanel";

const defaultProps = {
  adminKey: "GADMIN123",
  onSign: vi.fn().mockResolvedValue("tx-hash"),
  isAdmin: true,
};

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("BatchWhitelistPanel — loading state", () => {
  it("renders the skeleton while onInit is pending", () => {
    const { promise } = deferred();
    render(<BatchWhitelistPanel {...defaultProps} onInit={() => promise} />);

    expect(screen.getByLabelText(/loading panel data/i)).toBeInTheDocument();
    // Radio buttons and textarea must not appear yet
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("transitions to ready once onInit resolves", async () => {
    const { promise, resolve } = deferred();
    render(<BatchWhitelistPanel {...defaultProps} onInit={() => promise} />);

    await act(async () => { resolve(); });

    await waitFor(() => {
      expect(screen.queryByLabelText(/loading panel data/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
});

describe("BatchWhitelistPanel — empty state", () => {
  it("shows the empty hint when ready but no addresses entered", async () => {
    render(<BatchWhitelistPanel {...defaultProps} onInit={async () => {}} />);

    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());

    expect(screen.getByTestId("batch-whitelist-empty")).toBeInTheDocument();
    expect(screen.getByTestId("batch-whitelist-empty")).toHaveTextContent(
      /enter merchant addresses/i
    );
  });

  it("empty hint disappears once an address is typed", async () => {
    const user = userEvent.setup();
    render(<BatchWhitelistPanel {...defaultProps} onInit={async () => {}} />);

    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());

    await user.type(
      screen.getByRole("textbox"),
      "GCOEYT3WI3LY34I7DN7BR7AF33TNF2YF4OYTLVPJKMYAWT2RWEF5BUDK"
    );

    expect(screen.queryByTestId("batch-whitelist-empty")).not.toBeInTheDocument();
  });
});

describe("BatchWhitelistPanel — error state", () => {
  it("shows a role=alert error card when onInit rejects", async () => {
    render(
      <BatchWhitelistPanel
        {...defaultProps}
        onInit={async () => {
          throw new Error("whitelist fetch failed");
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("batch-whitelist-error")).toBeInTheDocument();
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Failed to load panel/i);
    expect(alert).toHaveTextContent(/whitelist fetch failed/i);
  });

  it("error state is visually distinct: skeleton is gone, form is not shown", async () => {
    render(
      <BatchWhitelistPanel
        {...defaultProps}
        onInit={async () => {
          throw new Error("rpc error");
        }}
      />
    );

    await waitFor(() => expect(screen.getByTestId("batch-whitelist-error")).toBeInTheDocument());

    expect(screen.queryByLabelText(/loading panel data/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Retry recovers the panel to ready state", async () => {
    const user = userEvent.setup();
    let attempt = 0;

    render(
      <BatchWhitelistPanel
        {...defaultProps}
        onInit={async () => {
          attempt += 1;
          if (attempt === 1) throw new Error("temporary failure");
        }}
      />
    );

    await waitFor(() => expect(screen.getByTestId("batch-whitelist-error")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    expect(screen.queryByTestId("batch-whitelist-error")).not.toBeInTheDocument();
  });
});

describe("BatchWhitelistPanel — race / stale-response prevention", () => {
  it("discards a stale slow init when a newer fast init has already completed", async () => {
    const slowDeferred = deferred();

    // Wrapper that switches the onInit to a fast version after a button click
    const RaceHarness = () => {
      const [useFast, setUseFast] = React.useState(false);

      const onInit = React.useCallback(
        async (_signal: AbortSignal) => {
          if (!useFast) return slowDeferred.promise;
        },
        [useFast]
      );

      return (
        <div>
          <BatchWhitelistPanel {...defaultProps} onInit={onInit} />
          <button onClick={() => setUseFast(true)}>switch-to-fast</button>
        </div>
      );
    };

    const user = userEvent.setup();
    render(<RaceHarness />);

    // Slow init in progress
    expect(screen.getByLabelText(/loading panel data/i)).toBeInTheDocument();

    // Switch to the fast init — this triggers a new useEffect run
    await user.click(screen.getByRole("button", { name: /switch-to-fast/i }));

    // Fast init completes → panel ready
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());

    // Resolve the original slow promise — must NOT degrade the ready state
    await act(async () => { slowDeferred.resolve(); });

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByLabelText(/loading panel data/i)).not.toBeInTheDocument();
  });

  it("AbortSignal fires on unmount mid-init", async () => {
    let captured: AbortSignal | undefined;
    const { promise } = deferred();

    const { unmount } = render(
      <BatchWhitelistPanel
        {...defaultProps}
        onInit={(signal) => {
          captured = signal;
          return promise;
        }}
      />
    );

    expect(captured?.aborted).toBe(false);
    unmount();
    expect(captured?.aborted).toBe(true);
  });
});
