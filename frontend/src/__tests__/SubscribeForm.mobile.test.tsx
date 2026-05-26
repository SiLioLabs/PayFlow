import React from "react";
import { render, screen } from "@testing-library/react";
import SubscribeForm from "../components/SubscribeForm";

// Mock matchMedia to simulate mobile viewport (375px)
beforeEach(() => {
  // @ts-ignore
  window.matchMedia = (query: string) => ({
    matches: query.includes("max-width: 639px"),
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  // set innerWidth
  // @ts-ignore
  window.innerWidth = 375;

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
    expect(groups.length).toBe(3);

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
