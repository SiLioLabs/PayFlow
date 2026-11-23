import { axe, toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

expect.extend(toHaveNoViolations);

export { axe };

/**
 * Shared accessibility test helper running axe-core assertions.
 * Configures rules suitable for component and modal testing in JSDOM.
 */
export async function checkA11y(
  container: HTMLElement | string,
  options?: Parameters<typeof axe>[1]
) {
  const results = await axe(container, {
    rules: {
      // In JSDOM, region landmark rules are typically provided by page-level layout shells
      region: { enabled: false },
      ...options?.rules,
    },
    ...options,
  });
  expect(results).toHaveNoViolations();
  return results;
}
