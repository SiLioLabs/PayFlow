/**
 * Export merchant revenue and subscriber report.
 * Usage: npx tsx scripts/export-merchant-report.ts --merchant GXXXX... --output report.json
 */

import { Contract, Networks, TransactionBuilder, BASE_FEE, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";

const RPC_URL = process.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "";

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function getMerchantRevenue(merchant: string): Promise<bigint> {
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const server = new Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(merchant);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_merchant_revenue", addressVal(merchant)))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval || retval.switch().name === "scvVoid") return 0n;
  return BigInt(retval.i128().toString());
}

async function getMerchantSubscriberCount(merchant: string): Promise<number> {
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const server = new Server(RPC_URL);

  const response = await server.getEvents({
    filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
    limit: 1000,
  });

  const latestSubscribeByUser = new Map<string, { merchant: string; timestamp: number }>();
  const latestCancelByUser = new Map<string, number>();

  for (const event of response.events) {
    const topic = event.topic;
    if (!topic || topic.length < 2) continue;
    const eventType = topic[0]?.toString();
    const userAddress = topic[1]?.toString();
    if (!userAddress) continue;

    const eventTime = (event.ledgerCloseTime as number) || 0;

    if (eventType === "subscribed") {
      const merchantVal = (event as any).value?._value?.merchant;
      const subscribedMerchant = merchantVal?.toString();
      if (!subscribedMerchant) continue;
      const existing = latestSubscribeByUser.get(userAddress);
      if (!existing || eventTime > existing.timestamp) {
        latestSubscribeByUser.set(userAddress, { merchant: subscribedMerchant, timestamp: eventTime });
      }
    } else if (eventType === "cancelled") {
      const existing = latestCancelByUser.get(userAddress) || 0;
      if (eventTime > existing) {
        latestCancelByUser.set(userAddress, eventTime);
      }
    }
  }

  let count = 0;
  for (const [userAddress, subscribe] of latestSubscribeByUser.entries()) {
    if (subscribe.merchant !== merchant) continue;
    const cancelAt = latestCancelByUser.get(userAddress) ?? 0;
    if (cancelAt < subscribe.timestamp) {
      count++;
    }
  }

  return count;
}

async function getMerchantRevenueHistory(merchant: string, days: number): Promise<bigint[]> {
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const server = new Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(merchant);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("get_merchant_revenue_history", addressVal(merchant), nativeToScVal(days, { type: "u32" }))
    )
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) return [];

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return [];

  // Decode Vec<i128>
  const vec = retval.vec();
  if (!vec) return [];
  return vec.map((v: xdr.ScVal) => BigInt(v.i128().toString()));
}

async function main() {
  const args = process.argv.slice(2);
  let merchant = "";
  let output = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--merchant" && args[i + 1]) merchant = args[++i];
    else if (args[i] === "--output" && args[i + 1]) output = args[++i];
  }

  if (!merchant || !output) {
    console.error("Usage: npx tsx scripts/export-merchant-report.ts --merchant GXXXX... --output report.json");
    process.exit(1);
  }

  console.log(`Fetching report for merchant: ${merchant}`);

  const [revenue, subscriberCount, dailyRevenue] = await Promise.all([
    getMerchantRevenue(merchant),
    getMerchantSubscriberCount(merchant),
    getMerchantRevenueHistory(merchant, 30),
  ]);

  const report = {
    generated_at: new Date().toISOString(),
    merchant,
    total_revenue: revenue.toString(),
    subscriber_count: subscriberCount,
    daily_revenue_last_30_days: dailyRevenue.map((v) => v.toString()),
  };

  const fs = await import("fs/promises");
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(`Report written to ${output}`);
}

main().catch(console.error);