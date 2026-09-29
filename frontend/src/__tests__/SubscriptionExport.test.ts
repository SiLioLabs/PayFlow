import { describe, expect, it } from "vitest";
import { toCSV } from "../components/SubscriptionExport";

function csvForLabel(label: unknown): string {
  return toCSV([{ label }]);
}

describe("SubscriptionExport CSV formula protection", () => {
  it.each([
    ["equals", "=HYPERLINK(...)"],
    ["plus", "+SUM(...)"],
    ["minus", "-cmd|..."],
    ["at", "@SUM(...)"],
  ])("apostrophe-prefixes formula-like %s values", (_prefix, value) => {
    expect(csvForLabel(value)).toContain(`'${value}`);
  });

  it.each([
    ["tab", "\t=1+1"],
    ["carriage return", "\r=1+1"],
    ["line feed", "\n=1+1"],
    ["form feed", "\f=1+1"],
  ])("neutralizes formula values after a leading %s", (_control, value) => {
    expect(csvForLabel(value)).toContain(`'${value}`);
  });

  it("leaves ordinary text and non-leading formula characters unchanged", () => {
    expect(csvForLabel("Quarterly report")).toContain("Quarterly report");
    expect(csvForLabel("client=team@example.com, status + active")).toContain(
      'client=team@example.com, status + active'
    );
  });

  it("preserves numeric values and numeric text, including signed literals", () => {
    const csv = toCSV([{ amount_stroops: -12, label: "-12" }]);
    expect(csv).toContain(",-12,");
    expect(csvForLabel("+12")).toContain("+12");
  });

  it("retains CSV quoting and quote-doubling after formula neutralization", () => {
    const formula = '=HYPERLINK("https://example.invalid","click"),\nnext';
    expect(csvForLabel(formula)).toContain(
      `"'${formula.replace(/"/g, '""')}"`
    );

    const ordinary = 'note, "quoted"\nnext';
    expect(csvForLabel(ordinary)).toContain(`"${ordinary.replace(/"/g, '""')}"`);
  });
});