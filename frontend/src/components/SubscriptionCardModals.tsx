import React from "react";
import IncreaseAllowanceModal from "./IncreaseAllowanceModal";
import TransferSubscriptionModal from "./TransferSubscriptionModal";

interface SubscriptionCardModalsProps {
  userKey: string;
  amount: bigint;
  onSign: (xdr: string) => Promise<string>;
  showAllowanceModal: boolean;
  showTransferModal: boolean;
  onCloseAllowance: () => void;
  onAllowanceSuccess: () => void;
  onCloseTransfer: () => void;
  onTransferSuccess: () => void;
}

export default function SubscriptionCardModals({
  userKey,
  amount,
  onSign,
  showAllowanceModal,
  showTransferModal,
  onCloseAllowance,
  onAllowanceSuccess,
  onCloseTransfer,
  onTransferSuccess,
}: SubscriptionCardModalsProps) {
  return (
    <>
      {showAllowanceModal && (
        <IncreaseAllowanceModal
          userKey={userKey}
          subscriptionAmount={amount}
          onSign={onSign}
          onClose={onCloseAllowance}
          onSuccess={onAllowanceSuccess}
          announce={() => {}}
        />
      )}
      {showTransferModal && (
        <TransferSubscriptionModal
          userKey={userKey}
          onSign={onSign}
          onClose={onCloseTransfer}
          onSuccess={onTransferSuccess}
        />
      )}
    </>
  );
}
