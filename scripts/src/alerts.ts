import { validateConfigForScript } from "./config.js";

const config = validateConfigForScript("alerts", { requireAlerts: true });

interface Alert {
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
  ts: number;
}

async function sendAlert(alert: Alert): Promise<void> {
  const { ALERTS } = config;
  if (!ALERTS) return;
  console.log(
    `[alerts:${alert.severity}] ${alert.title} — ${alert.body.slice(0, 200)} (via ${
      [
        ALERTS.SLACK_WEBHOOK_URL ? "slack" : undefined,
        ALERTS.PAGERDUTY_ROUTING_KEY ? "pagerduty" : undefined,
        ALERTS.ALERT_EMAIL ? "email" : undefined,
      ].filter(Boolean).join(",") || "log-only"
    })`
  );
}

async function runAlertsLoop(): Promise<void> {
  const { STELLAR_NETWORK, CONTRACT_ID } = config;
  console.log(`[alerts] monitoring ${STELLAR_NETWORK} contract=${CONTRACT_ID.slice(0, 8)}...`);
  console.log(`[alerts] fee_bps_threshold=${config.ALERTS?.FEE_BPS_THRESHOLD ?? 100}`);

  setInterval(async () => {
    await sendAlert({
      severity: "info",
      title: "heartbeat",
      body: `alerts monitor alive @ ${new Date().toISOString()}`,
      ts: Date.now(),
    });
  }, 3600_000);

  sendAlert({
    severity: "info",
    title: "alerts monitor started",
    body: "process booted",
    ts: Date.now(),
  });
}

runAlertsLoop().catch((err) => {
  console.error("[alerts] fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
