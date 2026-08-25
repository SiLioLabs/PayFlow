import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock window.matchMedia for responsive hooks.
// Using mockImplementation (not mockReturnValue) so the mock factory survives
// vi.clearAllMocks() — clearAllMocks resets call history but not the
// implementation set via mockImplementation.
const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: matchMediaMock,
});
