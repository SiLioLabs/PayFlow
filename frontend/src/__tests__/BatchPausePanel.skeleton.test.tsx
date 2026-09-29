/**
 * BatchPausePanel — skeleton / loading / empty / error / race tests.
 *
 * Covers the new PanelState behaviour introduced in the skeleton refactor:
 *   - "loading"  → AdminAddressListSkeleton shown, aria-busy on container
 *   - "ready"    → form shown; empty sub-state when no addresses entered
 *   - "error"    → red alert card with actionable Retry button
 *   - race guard → a stale (slow) onInit completion does NOT clobber a newer result
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

import BatchPausePanel from "../components/admin/BatchPausePanel";

const defaultProps = {
  adminKey: "GADMIN123",
  onSign: vi.fn().mockResolvedValue("tx-hash"),
  isAdmin: true,
};

// Helper: build a manually-resolvable promise
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("BatchPausePanel — loading state", () => {
  it("shows the skeleton while onInit is pending", () => {
    const { promise } = deferred();
    render(<BatchPausePanel {...defaultProps} onInit={() => promise} />);

    // aria-busy container is present during loading
    expect(screen.getByLabelText(/loading panel data/i)).toBeInTheDocument();
    // The address textarea must NOT be present yet
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("removes the skeleton once onInit resolves", async () => {
    const { promise, resolve } = deferred();
    render(<BatchPausePanel {...defaultProps} onInit={() => promise} />);

    expect(screen.getByLabelText(/loading panel data/i)).toBeInTheDocument();

    await act(async () => { resolve(); });

    await waitFor(() => {
      expect(screen.queryByLabelText(/loading panel data/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

describe("BatchPausePanel — empty state", () => {
  it("shows the empty-state hint when the panel is ready but no addresses entered", async () => {
    render(<BatchPausePanel {...defaultProps} onInit={async () => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    expect(screen.getByTestId("batch-pause-empty")).toBeInTheDocument();
    expect(screen.getByTestId("batch-pause-empty")).toHaveTextContent(/enter subscriber addresses/i);
  });

  it("hides the empty hint once an address is typed", async () => {
    const user = userEvent.setup();
    render(<BatchPausePanel {...defaultProps} onInit={async () => {}} />);

    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());

    await user.type(screen.getByRole("textbox"), "GCOEYT3WI3LY34I7DN7BR7AF33TNF2YF4OYTLVPJKMYAWT2RWEF5BUDK");

    expect(screen.queryByTestId("batch-pause-empty")).not.toBeInTheDocument();
  });
});

describe("BatchPausePanel — error state", () => {
  it("shows an error alert when onInit rejects", async () => {
    render(
      <BatchPausePanel
        {...defaultProps}
        onInit={async () => { throw new Error("RPC unavailable"); }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("batch-pause-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("batch-pause-error")).toHaveTextContent(/RPC unavailable/i);
    // Error state is an alert, not the loading skeleton
    expect(screen.queryByLabelText(/loading panel data/i)).not.toBeInTheDocument();
    // Form is not shown in error state
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("error state is a role=alert (semantically distinct from loading)", async () => {
    render(
      <BatchPausePanel
        {...defaultProps}
        onInit={async () => { throw new Error("timeout"); }}
      />
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // The alert must not be the admin-access warning (that has its own message)
    expect(screen.getByRole("alert")).toHaveTextContent(/Failed to load panel/i);
  });

  it("Retry button transitions from error back to loading then ready", async () => {
    const user = userEvent.setup();
    let callCount = 0;

    render(
      <BatchPausePanel
        {...defaultProps}
        onInit={async () => {
          callCount += 1;
          if (callCount === 1) throw new Error("first attempt failed");
          // second call succeeds
        }}
      />
    );

    // Wait for error state
    await waitFor(() => expect(screen.getByTestId("batch-pause-error")).toBeInTheDocument());

    // Click Retry
    await user.click(screen.getByRole("button", { name: /retry/i }));

    // Should eventually reach ready state
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    expect(screen.queryByTestId("batch-pause-error")).not.toBeInTheDocument();
  });
});

describe("BatchPausePanel — race / stale-response prevention", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores a stale slow onInit when a newer fast one completes first", async () => {
    // Call 1: slow — will resolve after call 2
    // Call 2: fast — resolves immediately
    // Expected: panel enters "ready" state from call 2; call 1's late resolve is dropped.

    const slowDeferred = deferred();
    let onInitCallCount = 0;

    // We simulate re-mount by using a key prop to force remount after first render
    const SlowThenFast = () => {
      const [key, setKey] = React.useState(0);

      // Build a stable onInit reference per key
      const onInit = React.useCallback(
        async (_signal: AbortSignal) => {
          if (key === 0) {
            // First mount: slow
            return slowDeferred.promise;
          }
          // Second mount: fast
          onInitCallCount += 1;
        },
        [key]
      );

      return (
        <div>
          <BatchPausePanel {...defaultProps} onInit={onInit} />
          <button onClick={() => setKey(1)}>remount</button>
        </div>
      );
    };

    const user = userEvent.setup();
    render(<SlowThenFast />);

    // First render → loading
    expect(screen.getByLabelText(/loading panel data/i)).toBeInTheDocument();

    // Trigger remount (new faster onInit)
    await user.click(screen.getByRole("button", { name: /remount/i }));

    // Fast call resolves immediately — panel should be ready
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());

    // Now resolve the original slow promise — must NOT flip panel back to loading or error
    await act(async () => { slowDeferred.resolve(); });

    // Panel must still be in the ready state
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByLabelText(/loading panel data/i)).not.toBeInTheDocument();
  });

  it("AbortSignal is aborted when the component unmounts mid-init", async () => {
    let capturedSignal: AbortSignal | undefined;
    const { promise } = deferred();

    const { unmount } = render(
      <BatchPausePanel
        {...defaultProps}
        onInit={(signal) => {
          capturedSignal = signal;
          return promise;
        }}
      />
    );

    // Signal is not yet aborted while component is mounted and init is pending
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    // After unmount the cleanup runs the AbortController.abort()
    expect(capturedSignal?.aborted).toBe(true);
  });
});
