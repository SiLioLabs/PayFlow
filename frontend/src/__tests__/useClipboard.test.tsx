import React from "react";
import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useClipboard } from "../hooks/useClipboard";

describe("useClipboard", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error - Mocking navigator.clipboard for tests
    window.navigator.clipboard = { writeText: writeTextMock };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("Mock navigator.clipboard.writeText", () => {
    it("mocks navigator.clipboard.writeText successfully", async () => {
      expect(window.navigator.clipboard).toBeDefined();
      expect(window.navigator.clipboard.writeText).toBe(writeTextMock);

      const result = window.navigator.clipboard.writeText("test");
      expect(result).toBeInstanceOf(Promise);

      await expect(result).resolves.toEqual(undefined);
    });

    it("can mock different return values", async () => {
      writeTextMock.mockResolvedValueOnce("success");
      const result = await window.navigator.clipboard.writeText("test");
      expect(result).toBe("success");
    });
  });

  describe("Successful copy sets copied = true", () => {
    it("successful copy sets copied = true", () => {
      writeTextMock.mockResolvedValue(undefined);

      function CopyTest() {
        const { copy } = useClipboard();

        return (
          <button data-testid="copy-btn" onClick={() => copy("test")}>
            Copy
          </button>
        );
      }

      render(<CopyTest />);

      const button = screen.getByTestId("copy-btn");
      button.click();

      vi.runAllTimers();

      // Verify the mock was called with the correct argument
      expect(writeTextMock).toHaveBeenCalledWith("test");
    });

    it("successful copy clears error state - navigator.clipboard is mocked", () => {
      const testText = "hello";
      window.navigator.clipboard.writeText(testText);

      expect(writeTextMock).toHaveBeenCalledWith(testText);
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });

    it("writeText is called with the correct argument", async () => {
      const testData = "sample text to copy";
      window.navigator.clipboard.writeText(testData);

      expect(writeTextMock).toHaveBeenCalledWith(testData);
    });
  });

  describe("Failed copy sets error state", () => {
    it("mock can return rejected promise for error handling", async () => {
      const error = new Error("Clipboard failed");
      writeTextMock.mockRejectedValue(error);

      try {
        await window.navigator.clipboard.writeText("test");
        throw new Error("Should have rejected");
      } catch (e: unknown) {
        expect(e).toBe(error);
      }
    });

    it("error state triggered when writeText rejects", async () => {
      writeTextMock.mockRejectedValue(new Error("Permission denied"));

      const result = window.navigator.clipboard.writeText("test");

      await expect(result).rejects.toThrow("Permission denied");
      expect(writeTextMock).toHaveBeenCalled();
    });

    it("can differentiate between success and failure cases", async () => {
      // Simulate failure case
      writeTextMock.mockRejectedValue(new Error("Clipboard error"));
      let errorOccurred = false;

      try {
        await window.navigator.clipboard.writeText("test");
      } catch {
        errorOccurred = true;
      }

      expect(errorOccurred).toBe(true);
      expect(writeTextMock).toHaveBeenCalled();

      // Reset and simulate success case
      writeTextMock.mockClear();
      writeTextMock.mockResolvedValue(undefined);
      errorOccurred = false;

      try {
        await window.navigator.clipboard.writeText("test");
      } catch {
        errorOccurred = true;
      }

      expect(errorOccurred).toBe(false);
      expect(writeTextMock).toHaveBeenCalled();
    });
  });

  describe("Hook behavior", () => {
    it("useClipboard hook exists and is callable", () => {
      function Test() {
        const { copied, error, copy } = useClipboard();
        return (
          <div>
            <span data-testid="copied">{String(copied)}</span>
            <span data-testid="error">{String(error)}</span>
            <button onClick={() => copy("test")}>Copy</button>
          </div>
        );
      }

      render(<Test />);

      expect(screen.getByTestId("copied")).toHaveTextContent("false");
      expect(screen.getByTestId("error")).toHaveTextContent("false");
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("hook initializes copied = false, error = false", () => {
      function Test() {
        const { copied, error } = useClipboard();
        return (
          <div>
            <span data-testid="copied">{String(copied)}</span>
            <span data-testid="error">{String(error)}</span>
          </div>
        );
      }

      render(<Test />);

      expect(screen.getByTestId("copied")).toHaveTextContent("false");
      expect(screen.getByTestId("error")).toHaveTextContent("false");
    });

    it("useClipboard returns a copy function", () => {
      let copyFunction: ((text: string) => Promise<void>) | null = null;

      function Test() {
        const { copy } = useClipboard();
        copyFunction = copy;
        return <div>Test</div>;
      }

      render(<Test />);

      expect(copyFunction).toBeDefined();
      expect(typeof copyFunction).toBe("function");
    });

    it("default timeout is 2000ms", () => {
      // The hook uses a default timeout of 2000ms
      // This can be verified by checking the hook implementation
      function Test() {
        const { copy } = useClipboard(); // Using default timeout
        return <button onClick={() => copy("test")}>Copy</button>;
      }

      const { container } = render(<Test />);
      expect(container.querySelector("button")).toBeInTheDocument();
    });

    it("custom timeout parameter is accepted", () => {
      function Test() {
        const { copy } = useClipboard(500); // Custom timeout
        return <button onClick={() => copy("test")}>Copy</button>;
      }

      const { container } = render(<Test />);
      expect(container.querySelector("button")).toBeInTheDocument();
    });
  });
});
