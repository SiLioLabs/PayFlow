/**
 * Configuration for the alert-failed-charges script.
 * Reads environment variables.
 */
export interface Config {
  /** Webhook URL to POST alerts to. If empty, alerts are logged instead. */
  webhookUrl: string;
  /** Dedup window in milliseconds. Alerts for the same subscriber+reason are suppressed within this window. */
  dedupWindowMs: number;
  /** Maximum number of alerts sent per subscriber within the dedup window. */
  maxAlertsPerSubscriber: number;
  /** Path to state file for dedup persistence. If not set, dedup is in-memory only. */
  stateFilePath?: string;
  /** Path to the batch results JSON file. If not set, reads from stdin. */
  inputFile?: string;
}

/**
 * Loads configuration from environment variables with defaults.
 */
export function loadAlertConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    webhookUrl: env.WEBHOOK_URL || '',
    dedupWindowMs: Number(env.DEDUP_WINDOW_MS || 3600000),
    maxAlertsPerSubscriber: Number(env.MAX_ALERTS_PER_SUBSCRIBER || 5),
    stateFilePath: env.STATE_FILE_PATH,
    inputFile: env.INPUT_FILE,
  };
}
import * as dotenv from 'dotenv';
import { Keypair } from 'stellar-sdk';

dotenv.config();

export const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
export const TEST_NETWORK_PASSTHRASE = 'Test SDF Network ; September 2015';

export interface KeeperConfig {
  secret: string;
  publicKey?: string;
  networkPassphrase: string;
  allowMainnet: boolean;
}

export function loadConfig(env: Node.ProcessEnv = process.env): KeeperConfig {
  const secret = env.KEEPER_SECRET;
  if (!secret) {
    throw new Error('KEEPER_SECRET must be set');
  }

  const networkPassphrase = env.NETWORK_PASSPHRASE || TEST_NETWORK_PASSPHRASE;
  const allowMainnet = env.ALLOW_MAINNET === 'true';

  if (networkPassphrase === PUBLIC_NETWORK_PASSTHRASE && !allowMainnet) {
    throw new Error(
      'Mainnet network passphrase detected. Set ALLOW_MAINNET=true to confirm you want to use Mainnet.'
    );
  }

  const publicKey = env.KEEPER_PUBLIC_KEY;
  if (publicKey) {
    const derived = Keypair.fromSecret(secret).publicKey();
    if (derived !== publicKey) {
      throw new Error('KEEPER_PUBLIC_KEY does not match KEEPER_SECRET');
    }
  }

  return {
    secret,
    publicKey,
    networkPassphrase,
    allowMainnet,
  };
}

export function redactSecret(value: string): string {
  // Maskes a Stellar secret key, preserving the last four characters for reference.
  return value.replace(/S[A-Z0-9]{55}/gi, (match) => {
    return 'S' + '*'.repeat(8) + match.slice(-4);
  });
}

export function formatConfig(config: KeeperConfig): string {
  const redacted = { ...config, secret: redactSecret(config.secret) };
  return JSON.stringify(redacted, null, 2);
}

export interface BackfillConfig {
  /** Starting ledger sequence number for backfill. 0 means from the last checkpoint. */
  startLedger: number;
  /** Ending ledger sequence number for backfill (inclusive). 0 means to the latest. */
  endLedger: number;
  /** Path to the checkpoint file for progressive checkpointing. */
  checkpointFile: string;
  /** Maximum number of ledger fetch requests per second. 0 means no limit. */
  rateLimit: number;
}

/**
 * Loads backfill configuration from environment variables with defaults.
 */
export function loadBackfillConfig(env: NodeJS.ProcessEnv = process.env): BackfillConfig {
  return {
    startLedger: Number(env.BACKFILL_START_LEDGER || 0),
    endLedger: Number(env.BACKFILL_END_LEDGER || 0),
    checkpointFile: env.BACKFILL_CHECKPOINT_FILE || '',
    rateLimit: Number(env.BACKFILL_RATE_LIMIT || 0),
  };
}
