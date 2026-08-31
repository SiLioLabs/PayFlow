import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifyFailures, buildPayload, shouldSendAlert, markAlertSent, main } from '../alert-failed-charges';
import { loadConfig } from '../config';

function loadFixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

describe('classifyFailures', () => {
  it('groups failed charges by reason', () => {
    const results = [
      { id: 'ch_1', subscriberId: 'sub_1', amount: 10, currency: 'usd', status: 'failed', failureReason: 'insufficient_funds', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'ch_2', subscriberId: 'sub_2', amount: 20, currency: 'usd', status: 'failed', failureReason: 'card_declined', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'ch_3', subscriberId: 'sub_1', amount: 30, currency: 'usd', status: 'failed', failureReason: 'insufficient_funds', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'ch_4', subscriberId: 'sub_3', amount: 40, currency: 'usd', status: 'succeeded', createdAt: '2024-01-01T00:00:00Z' },
    ];
    const alerts = classifyFailures(results);
    assert.equal(alerts.length, 3);
    const reasons = alerts.map(a => a.reason);
    assert.deepEqual(reasons.sort(), ['card_declined', 'insufficient_funds', 'insufficient_funds']);
  });
});

describe('buildPayload', () => {
  it('groups alerts by reason', () => {
    const alerts = [
      { subscriberId: 'a', reason: 'x', chargeId: 'ch1', amount: 1, currency: 'usd', createdAt: '2024-01-01T00:00:00Z' },
      { subscriberId: 'b', reason: 'x', chargeId: 'ch2', amount: 2, currency: 'usd', createdAt: '2024-01-01T00:00:00Z' },
      { subscriberId: 'c', reason: 'y', chargeId: 'ch3', amount: 3, currency: 'usd', createdAt: '2024-01-01T00:00:00Z' },
    ];
    const payload = buildPayload(alerts) as any;
    assert.equal(payload.event, 'failed_charges');
    assert.equal(payload.groups.x.count, 2);
    assert.equal(payload.groups.y.count, 1);
  });
});

describe('shouldSendAlert', () => {
  const config = { webhookUrl: 'http://example.com', dedupWindowMs: 3600000, maxAlertsPerSubscriber: 2 } as any;
  const now = new Date('2024-01-01T12:00:00Z');
  const alert = { subscriberId: 'sub', reason: 'x', chargeId: 'ch', amount: 1, currency: 'usd', createdAt: '2024-01-01T00:00:00Z' };

  it('allows first alert', () => {
    const state = { lastSent: {}, sentTimestamps: {} };
    assert.equal(shouldSendAlert(state, alert, config, now), true);
  });

  it('deduplicates same subscriber+reason within window', () => {
    const state = { lastSent: { 'sub:x': now.toISOString() }, sentTimestamps: { sub: [now.toISOString()] } };
    assert.equal(shouldSendAlert(state, alert, config, now), false);
  });

  it('rate-limits subscriber after max alerts', () => {
    const earlier = new Date(now.getTime() - 60000).toISOString();
    const state = {
      lastSent: { 'sub:x': earlier },
      sentTimestamps: {
        sub: [earlier, earlier], // already 2 within window
      },
    };
    assert.equal(shouldSendAlert(state, alert, config, now), false);
  });
});

describe('main with fixture', () => {
  it('processes fixture and sends webhook', async () => {
    const fixture = loadFixture('batch-results.json');
    const fetchMock = mock.fn(async () => new Response(null, { status: 200 }));
    global.fetch = fetchMock;

    const originalEnv = process.env;
    process.env = { ...originalEnv, INPUT_FILE: path.join(__dirname, 'fixtures', 'batch-results.json'), WEBHOOK_URL: 'http://test' };
    try {
      await main();
    } finally {
      process.env = originalEnv;
      delete (global as any).fetch;
    }

    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, 'http://test');
    const payload = JSON.parse((options as RequestInit).body as string);
    assert.ok(payload.groups);
  });
});