import React from "react";
import { render } from "@testing-library/react";
import { describe, it, vi, beforeEach } from "vitest";
import { checkA11y } from "./a11y-helper";

import ConnectWallet from "../components/ConnectWallet";
import SubscribeForm from "../components/SubscribeForm";
import Dashboard from "../components/Dashboard";
import MerchantDashboard from "../components/MerchantDashboard";
import AllowanceDisplay from "../components/AllowanceDisplay";
import BalanceDisplay from "../components/BalanceDisplay";
import NetworkBadge from "../components/NetworkBadge";
import RevenueSparkline from "../components/RevenueSparkline";
import SubscriptionCard from "../components/SubscriptionCard";
import TabBar from "../components/TabBar";
import ThemeToggle from "../components/ThemeToggle";
import ToastContainer from "../components/Toast";
import TxQueuePanel from "../components/TxQueuePanel";

import DailyLimitModal from "../components/DailyLimitModal";
import IncreaseAllowanceModal from "../components/IncreaseAllowanceModal";
import TransferSubscriptionModal from "../components/TransferSubscriptionModal";
import WalletSelectModal from "../components/WalletSelectModal";
import AddressBook from "../components/AddressBook";
import { AVAILABLE_WALLETS } from "../hooks/useWallet";
import { ToastProvider } from "../context/ToastContext";
import * as stellar from "../stellar";

vi.mock("../stellar");

const MOCK_USER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const MOCK_MERCHANT = "GCXO7NWYDZJGGZZIZK3VJLMY276XKV5ZOONULFCRUBCCOCVX5F5M36CR";

describe("Accessibility Audit: Primary Components & Modals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stellar.getSubscription).mockResolvedValue({
      merchant: MOCK_MERCHANT,
      amount: "10000000",
      interval: 86400,
      last_charged: Math.floor(Date.now() / 1000) - 1000,
      active: true,
      paused: false,
      trial_duration: 0,
    });
    vi.mocked(stellar.getAllowance).mockResolvedValue(100000000n);
    vi.mocked(stellar.getBalance).mockResolvedValue("50.00");
    vi.mocked(stellar.getTokenBalance).mockResolvedValue(500000000n);
    vi.mocked(stellar.getTrialEnd).mockResolvedValue(null);
    vi.mocked(stellar.getDailyLimit).mockResolvedValue(null);
    vi.mocked(stellar.getDailySpent).mockResolvedValue(0n);
    vi.mocked(stellar.getDayStart).mockResolvedValue(null);
    vi.mocked(stellar.getSubscriptionHealth).mockResolvedValue({
      active: true,
      charge_due: false,
      within_grace: false,
      has_sufficient_allowance: true,
      is_paused: false,
      trial_active: false,
      daily_limit_set: false,
    });
    vi.mocked(stellar.getMerchantSubscribers).mockResolvedValue([]);
    vi.mocked(stellar.getMerchantRevenue).mockResolvedValue(0n);
    vi.mocked(stellar.getMerchantRevenueHistory).mockResolvedValue([100n, 200n]);
    vi.mocked(stellar.fetchEvents).mockResolvedValue({ events: [] });
    vi.mocked(stellar.getChargeHistory).mockResolvedValue([]);
    vi.mocked(stellar.getContractPaused).mockResolvedValue(false);
  });

  describe("Primary Components", () => {
    it("ConnectWallet has no accessibility violations", async () => {
      const { container } = render(
        <ConnectWallet onConnect={vi.fn()} error={null} loading={false} />
      );
      await checkA11y(container);
    });

    it("SubscribeForm has no accessibility violations", async () => {
      const { container } = render(
        <SubscribeForm
          userKey={MOCK_USER}
          onSign={vi.fn().mockResolvedValue("tx-hash")}
          onSuccess={vi.fn()}
          announce={vi.fn()}
        />
      );
      await checkA11y(container);
    });

    it("Dashboard has no accessibility violations", async () => {
      const { container } = render(
        <ToastProvider>
          <Dashboard
            userKey={MOCK_USER}
            onSign={vi.fn().mockResolvedValue("tx-hash")}
            refreshTrigger={0}
            announce={vi.fn()}
          />
        </ToastProvider>
      );
      await checkA11y(container);
    });

    it("MerchantDashboard has no accessibility violations", async () => {
      const { container } = render(
        <ToastProvider>
          <MerchantDashboard
            merchantKey={MOCK_MERCHANT}
            onSign={vi.fn().mockResolvedValue("tx-hash")}
            refreshTrigger={0}
          />
        </ToastProvider>
      );
      await checkA11y(container);
    });

    it("AllowanceDisplay has no accessibility violations", async () => {
      const { container } = render(
        <AllowanceDisplay owner={MOCK_USER} subscriptionAmount={10000000n} />
      );
      await checkA11y(container);
    });

    it("BalanceDisplay has no accessibility violations", async () => {
      const { container } = render(<BalanceDisplay publicKey={MOCK_USER} />);
      await checkA11y(container);
    });

    it("NetworkBadge has no accessibility violations", async () => {
      const { container } = render(<NetworkBadge />);
      await checkA11y(container);
    });

    it("RevenueSparkline has no accessibility violations", async () => {
      const { container } = render(
        <RevenueSparkline history={[1000n, 2500n, 1800n, 4000n]} />
      );
      await checkA11y(container);
    });

    it("SubscriptionCard has no accessibility violations", async () => {
      const { container } = render(
        <ToastProvider>
          <SubscriptionCard
            subscription={{
              merchant: MOCK_MERCHANT,
              amount: "10000000",
              interval: 86400,
              last_charged: 1600000000,
              active: true,
              paused: false,
            }}
            userKey={MOCK_USER}
            onSign={vi.fn().mockResolvedValue("tx-hash")}
            onRefresh={vi.fn()}
            announce={vi.fn()}
          />
        </ToastProvider>
      );
      await checkA11y(container);
    });

    it("TabBar has no accessibility violations", async () => {
      const { container } = render(
        <div>
          <TabBar
            tabs={["dashboard", "subscribe", "merchant"]}
            activeTab="dashboard"
            onTabChange={vi.fn()}
          />
          <div id="panel-dashboard" role="tabpanel" aria-labelledby="tab-dashboard">
            Dashboard panel content
          </div>
          <div id="panel-subscribe" role="tabpanel" aria-labelledby="tab-subscribe" hidden>
            Subscribe panel content
          </div>
          <div id="panel-merchant" role="tabpanel" aria-labelledby="tab-merchant" hidden>
            Merchant panel content
          </div>
        </div>
      );
      await checkA11y(container);
    });

    it("ThemeToggle has no accessibility violations", async () => {
      const { container } = render(<ThemeToggle />);
      await checkA11y(container);
    });

    it("ToastContainer has no accessibility violations", async () => {
      const { container } = render(
        <ToastContainer
          toasts={[
            {
              id: 1,
              message: "Subscription updated successfully",
              variant: "success",
              timestamp: Date.now(),
            },
          ]}
          onRemove={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
        />
      );
      await checkA11y(container);
    });

    it("TxQueuePanel has no accessibility violations", async () => {
      const { container } = render(
        <TxQueuePanel isOpen={true} onClose={vi.fn()} />
      );
      await checkA11y(container);
    });
  });

  describe("Modals", () => {
    it("DailyLimitModal has no accessibility violations", async () => {
      const { container } = render(
        <DailyLimitModal
          user={MOCK_USER}
          onClose={vi.fn()}
          onSign={vi.fn().mockResolvedValue("tx-hash")}
          onSuccess={vi.fn()}
        />
      );
      await checkA11y(container);
    });

    it("IncreaseAllowanceModal has no accessibility violations", async () => {
      const { container } = render(
        <IncreaseAllowanceModal
          userKey={MOCK_USER}
          subscriptionAmount={10000000n}
          onClose={vi.fn()}
          onSign={vi.fn().mockResolvedValue("tx-hash")}
          onSuccess={vi.fn()}
          announce={vi.fn()}
        />
      );
      await checkA11y(container);
    });

    it("TransferSubscriptionModal has no accessibility violations", async () => {
      const { container } = render(
        <TransferSubscriptionModal
          userKey={MOCK_USER}
          onClose={vi.fn()}
          onSign={vi.fn().mockResolvedValue("tx-hash")}
          onSuccess={vi.fn()}
        />
      );
      await checkA11y(container);
    });

    it("WalletSelectModal has no accessibility violations", async () => {
      const { container } = render(
        <WalletSelectModal
          adapters={AVAILABLE_WALLETS}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          connectionStatus="idle"
          error={null}
        />
      );
      await checkA11y(container);
    });

    it("AddressBook modal has no accessibility violations", async () => {
      const { container } = render(
        <AddressBook onSelect={vi.fn()} onClose={vi.fn()} />
      );
      await checkA11y(container);
    });
  });
});
