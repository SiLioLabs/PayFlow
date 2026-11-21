import { render, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// 👇 Mock Stellar BEFORE importing App
vi.mock("../stellar");

import App from "../App";

describe("App", () => {
  it("renders without crashing", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(document.body).toBeTruthy();
  });
});
