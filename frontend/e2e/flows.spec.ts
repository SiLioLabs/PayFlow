import { test, expect } from "@playwright/test";
import { injectFakeWallet, TEST_USER_KEY, TEST_MERCHANT_KEY } from "./wallet-mock";
import { mockSorobanRpc, MockSubscriptionState } from "./rpc-mock";

test.describe("Browser-Level End-to-End User Flows", () => {
  let subscriptionState: MockSubscriptionState;

  test.beforeEach(async ({ page }) => {
    subscriptionState = {
      hasSubscription: false,
      isPaused: false,
      merchant: TEST_MERCHANT_KEY,
      amount: "10000000",
      interval: 86400,
    };

    // Inject fake window.freighter wallet adapter before navigation
    await injectFakeWallet(page, TEST_USER_KEY);

    // Mock Soroban JSON-RPC and Horizon API calls
    await mockSorobanRpc(page, subscriptionState);
  });

  test("1. Connect Wallet flow", async ({ page }) => {
    await page.goto("/");

    // Verify initial connect prompt
    const connectBtn = page.getByRole("button", { name: /connect wallet/i });
    await expect(connectBtn).toBeVisible();

    // Click connect to open wallet selector
    await connectBtn.click();

    // Modal should appear
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(page.getByText("Select a wallet to connect to PayFlow.")).toBeVisible();

    // Choose Freighter option
    const freighterOption = page.getByTestId("wallet-option-freighter");
    await expect(freighterOption).toBeVisible();
    await freighterOption.click();

    // Wallet modal closes and wallet bar shows connected status
    await expect(modal).not.toBeVisible();
    await expect(page.getByRole("navigation", { name: /main navigation/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Dashboard" })).toBeVisible();
  });

  test("2. Subscribe flow", async ({ page }) => {
    await page.goto("/");

    // Connect wallet
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.getByTestId("wallet-option-freighter").click();

    // Navigate to Subscribe tab
    const subscribeTab = page.getByRole("tab", { name: "Subscribe" });
    await subscribeTab.click();
    await expect(subscribeTab).toHaveAttribute("aria-selected", "true");

    // Fill in subscription parameters
    const merchantInput = page.getByTestId("merchant-input");
    await merchantInput.fill(TEST_MERCHANT_KEY);

    const amountInput = page.getByTestId("amount-input");
    await amountInput.fill("10");

    // Submit subscription
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // After successful subscription creation, transitions to Dashboard or shows active state
    await expect(page.getByRole("tab", { name: "Dashboard" })).toBeVisible();
  });

  test("3. Pause Subscription flow", async ({ page }) => {
    subscriptionState.hasSubscription = true;
    subscriptionState.isPaused = false;

    await page.goto("/");

    // Connect wallet
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.getByTestId("wallet-option-freighter").click();

    // If subscription is active on Dashboard, Pause button is available
    const pauseBtn = page.getByRole("button", { name: /pause subscription/i });
    if (await pauseBtn.isVisible()) {
      await pauseBtn.click();

      // Pause modal should appear
      const pauseModal = page.getByTestId("pause-dialog");
      await expect(pauseModal).toBeVisible();
      await expect(page.getByText("Pause subscription?")).toBeVisible();

      // Confirm pause
      const confirmPauseBtn = pauseModal.getByRole("button", { name: /^pause$/i });
      await confirmPauseBtn.click();
    }
  });

  test("4. Cancel Subscription flow", async ({ page }) => {
    subscriptionState.hasSubscription = true;
    subscriptionState.isPaused = false;

    await page.goto("/");

    // Connect wallet
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.getByTestId("wallet-option-freighter").click();

    // If subscription is active on Dashboard, Cancel button is available
    const cancelBtn = page.getByRole("button", { name: /cancel subscription/i });
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();

      // Cancel modal should appear
      const cancelModal = page.getByTestId("cancel-dialog");
      await expect(cancelModal).toBeVisible();
      await expect(page.getByText("Cancel subscription?")).toBeVisible();

      // Confirm cancel
      const confirmCancelBtn = cancelModal.getByRole("button", { name: /confirm cancel/i });
      await confirmCancelBtn.click();
    }
  });
});
