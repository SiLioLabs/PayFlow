import { Config, loadConfig } from './config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

export interface ChargeResult {
  id: string;
  subscriberId: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed';
  failureReason?: string;
  failureCode?: string;
  createdAt: string;
}

export interface Alert {
  subscriberId: string;
  reason: string;
  chargeId: string;
  amount: number;
  currency: string;
  createdAt: string;
}

interface DedupState {
  lastSent: Record<string, string>;
  sentTimestamps: Record<string, string[]>;
}

function getKey(alert: Alert): string {
  return `${alert.subscriberId}:${alert.reason}`;
}

function loadState(filePath?: string): DedupState {
  const empty: DedupState = { lastSent: { }, sentTimestamps: { } };
  if (!filePath) return empty;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastSent: parsed.lastSent || {},
      sentTimestamps: parsed.sentTimestamps || {},
    };
  } catch (err: any) {
    // If file doesn't exist or is invalid, start fresh.
    return empty;
  }
}

function saveState(filePath: string, state: DedupState): void {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function isWithinWindow(timestamp: string, now: Date, windowMs: number): boolean {
  const t = new Date(timestamp).getTime();
  return now.getTime() - t <= windowMs;
}

function shouldSendAlert(state: DedupState, alert: Alert, config: Config, now: Date): boolean {
  const key = getKey(alert);
  const last = state.lastSent[key];
  if (last && isWithinWindow(last, now, config.dedupWindowMs)) {
    return false; // Deduplicated
  }

  // Rate-limit per subscriber
  const sentTimes = state.sentTimestamps[alert.subscriberId] || [];
  const recentTimes = sentTimes.filter(t => isWithinWindow(t, now, config.dedupWindowMs));
  if (recentTimes.length >= config.maxAlertsPerSubscriber) {
    return false;
  }

  return true;
}

function markAlertSent(state: DedupState, alert: Alert, now: Date): void {
  const key = getKey(alert);
  state.lastSent[key] = now.toISOString();

  if (!state.sentTimestamps[alert.subscriberId]) {
    state.sentTimestamps[alert.subscriberId] = [];
  }
  state.sentTimestamps[alert.subscriberId].push(now.toISOString());
}

/**
 * Builds webhook payload grouped by reason.
 */
export function buildPayload(alerts: Alert[]): unknown {
  const groups: Record<string, { count: number; alerts: Alert[] }> = {};
  for (const alert of alerts) {
    if (!groups[alert.reason]) {
      groups[alert.reason] = { count: 0, alerts: [] };
    }
    groups[alert.reason].count++;
    groups[alert.reason].alerts.push(alert);
  }
  return {
    event: 'failed_charges',
    timestamp: new Date().toISOString(),
    groups,
  };
}

/**
 * Sends the webhook payload. If no URL is configured, logs it.
 */
async function sendWebhook(url: string, payload: unknown): Promise<void> {
  if (!url) {
    console.log('Webhook URL not set. Payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed with status ${response.status}`);
  }
}

/**
 * Reads batch results from a file or stdin.
 */
async function readInput(filePath?: string): Promise<ChargeResult[]> {
  let raw: string;
  if (filePath) {
    raw = fs.readFileSync(filePath, 'utf8');
  } else {
    const rl = readline.createInterface({ input: process.stdin });
    raw = await new Promise<string>((resolve) => {
      let data = '';
      rl.on('line', (line) => { data += line; });
      rl.on('close', () => resolve(data));
    });
  }
  return JSON.parse(raw) as ChargeResult[];
}

/**
 * Classifies failed charges into alerts grouped by reason.
 */
export function classifyFailures(results: ChargeResult[]): Alert[] {
  const alerts: Alert[] = [];
  for (const result of results) {
    if (result.status !== 'failed') continue;
    const reason = result.failureReason || result.failureCode || 'unknown';
    alerts.push({
      subscriberId: result.subscriberId,
      reason,
      chargeId: result.id,
      amount: result.amount,
      currency: result.currency,
      createdAt: result.createdAt,
    });
  }
  return alerts;
}

/**
 * Main entry point.
 */
export async function main(): Promise<void> {
  const config = loadConfig();
  const results = await readInput(config.inputFile);
  const alerts = classifyFailures(results);

  const state = loadState(config.stateFilePath);
  const now = new Date();

  const toSend: Alert[] = [];
  for (const alert of alerts) {
    if (shouldSendAlert(state, alert, config, now)) {
      toSend.push(alert);
      markAlertSent(state, alert, now);
    }
  }

  if (toSend.length > 0) {
    const payload = buildPayload(toSend);
    await sendWebhook(config.webhookUrl, payload);
  }

  if (config.stateFilePath) {
    saveState(config.stateFilePath, state);
  }
}

// Run only when executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}