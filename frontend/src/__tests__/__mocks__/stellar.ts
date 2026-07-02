import { vi } from "vitest";

export const buildSubscribeTx = vi.fn().mockResolvedValue("mocked-subscribe-xdr");
export const buildPayPerUseTx = vi.fn().mockResolvedValue("mocked-ppu-xdr");
export const buildCancelTx = vi.fn().mockResolvedValue("mocked-cancel-xdr");
export const buildPauseTx = vi.fn().mockResolvedValue("mocked-pause-xdr");
export const buildResumeTx = vi.fn().mockResolvedValue("mocked-resume-xdr");
export const buildApproveTx = vi.fn().mockResolvedValue("mocked-approve-xdr");
export const buildSetDailyLimitTx = vi.fn().mockResolvedValue("mocked-set-daily-limit-xdr");
export const getSubscription = vi.fn().mockResolvedValue(null);
export const getAllowance = vi.fn().mockResolvedValue(9999999999n);
export const fetchEvents = vi.fn().mockResolvedValue({ events: [] });
export const getDailyLimit = vi.fn().mockResolvedValue(1000000000n);
export const getDailySpent = vi.fn().mockResolvedValue(0n);
export const getChargeHistory = vi.fn().mockResolvedValue([]);
export const getMerchantSubscribers = vi.fn().mockResolvedValue([]);
export const getMerchantRevenue = vi.fn().mockResolvedValue(0n);
export const getMerchantRevenueHistory = vi.fn().mockResolvedValue([]);

export const server = {
  sendTransaction: vi.fn().mockResolvedValue({ hash: "mocked-tx-hash" }),
  getAccount: vi.fn(),
  getEvents: vi.fn(),
  simulateTransaction: vi.fn(),
};

export const CONTRACT_ID = "C_MOCK_CONTRACT";
export const TOKEN_CONTRACT_ID = "C_MOCK_TOKEN";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
