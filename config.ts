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
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    webhookUrl: env.WEBHOOK_URL || '',
    dedupWindowMs: Number(env.DEDUP_WINDOW_MS || 3600000),
    maxAlertsPerSubscriber: Number(env.MAX_ALERTS_PER_SUBSCRIBER || 5),
    stateFilePath: env.STATE_FILE_PATH,
    inputFile: env.INPUT_FILE,
  };
}
