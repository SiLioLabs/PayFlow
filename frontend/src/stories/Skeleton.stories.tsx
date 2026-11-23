/**
 * Skeleton — loading placeholder stories.
 * Covers: SubscriptionCardSkeleton, ChargeHistorySkeleton,
 *         MerchantSubscriberSkeleton, AdminAddressListSkeleton,
 *         AdminRepairSkeleton.
 */
import React from "react";
import type { Story } from "@ladle/react";
import SubscriptionCardSkeleton, {
  ChargeHistorySkeleton,
  MerchantSubscriberSkeleton,
  AdminAddressListSkeleton,
  AdminRepairSkeleton,
} from "../components/Skeleton";

export const SubscriptionCard: Story = () => <SubscriptionCardSkeleton />;
SubscriptionCard.storyName = "SubscriptionCard skeleton";

export const ChargeHistory: Story = () => (
  <div className="card">
    <div className="charge-history-list" role="list">
      <ChargeHistorySkeleton />
      <ChargeHistorySkeleton />
      <ChargeHistorySkeleton />
    </div>
  </div>
);
ChargeHistory.storyName = "ChargeHistory skeleton (3 rows)";

export const MerchantSubscriber: Story = () => (
  <div className="card">
    <MerchantSubscriberSkeleton />
    <MerchantSubscriberSkeleton />
  </div>
);
MerchantSubscriber.storyName = "MerchantSubscriber skeleton (2 rows)";

export const AdminAddressList: Story = () => <AdminAddressListSkeleton count={4} />;
AdminAddressList.storyName = "AdminAddressList skeleton (4 rows)";

export const AdminRepair: Story = () => <AdminRepairSkeleton />;
AdminRepair.storyName = "AdminRepair skeleton";
