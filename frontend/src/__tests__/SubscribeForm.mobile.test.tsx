import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import SubscribeForm from "../components/SubscribeForm";

// SubscribeForm → AllowanceDisplay → stellar (getAllowance)
// ReferralPanel (via import in SubscribeForm) → stellar (fetchEvents)
vi.mock("../stellar", () => ({
  getAllowance: vi.fn(() => Promise.resolve(0n)),
  fetchEvents: vi.fn(() => Promise.resolve([])),
  buildSubscribeTx: vi.fn(),
  DEFAULT_TOKEN: "CTOKEN",
  RPC_URL: "https://soroban-testnet.stellar.org",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  CONTRACT_ID: "CTEST",
  TOKEN_CONTRACT_ID: "CTOKEN",
  server: { getAccount: vi.fn().mockResolvedValue({}) },
}));

// Mock matchMedia to simulate mobile viewport (375px)
beforeEach(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("max-width: 639px"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });

  // inject minimal CSS so computed styles are available in JSDOM
  const style = document.createElement("style");
  style.innerHTML = `
    .subscribe-form { width: 360px; }
    .subscribe-form .form-group { display: block; }
    .subscribe-form__submit { width: 100%; }
  `;
  document.head.appendChild(style);
});

afterEach(() => {
  // clean injected styles
  document.head.querySelectorAll("style").forEach((s) => s.remove());
});

describe("SubscribeForm mobile layout", () => {
  it("form fields stack vertically and submit is full width with no horizontal overflow", () => {
    render(
      <SubscribeForm
        userKey={"GABC"}
        onSign={async () => "tx"}
        onSuccess={() => {}}
        announce={() => {}}
      />
    );

    const groups = document.querySelectorAll(".subscribe-form .form-group");
    expect(groups.length).toBe(5);

    const btn = screen.getByRole("button", { name: /subscribe/i });
    const btnWidth = parseFloat(getComputedStyle(btn).width);
    const form = document.querySelector(".subscribe-form") as HTMLElement;
    const formWidth = parseFloat(getComputedStyle(form).width);

    // button width should not exceed form width
    expect(btnWidth).toBeLessThanOrEqual(formWidth + 1);
    // ensure form width fits within window
    expect(formWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});
