import { z } from "zod";

export const StellarNetworkSchema = z.enum(["testnet", "mainnet", "futurenet", "standalone"]);
export type StellarNetwork = z.infer<typeof StellarNetworkSchema>;

export const StellarAddressSchema = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "must be a valid Stellar G-address (Ed25519)");

export const RpcUrlSchema = z
  .string()
  .url("RPC_URL must be a valid HTTP/HTTPS URL")
  .refine(
    (u) => u.startsWith("https://") || u.startsWith("http://"),
    "RPC_URL must use http:// or https://"
  );

export const ContractIdSchema = StellarAddressSchema.describe(
  "PayFlow Soroban contract address (G...)"
);

export const KeeperConfigSchema = z.object({
  PRIVATE_KEY: z
    .string()
    .min(1, "PRIVATE_KEY is required for keeper signing")
    .regex(
      /^S[A-Z2-7]{55}$/,
      "PRIVATE_KEY must be a valid Stellar secret key (S...)"
    ),
  MAX_BATCH_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .max(1000, "MAX_BATCH_SIZE cannot exceed 1000 (network safety)")
    .default(100)
    .describe("Maximum users charged per batch_charge call"),
  POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(3_600_000, "POLL_INTERVAL_MS cannot exceed 1 hour")
    .default(60_000)
    .describe("Interval between keeper charge attempts (ms)"),
  DRY_RUN: z.coerce.boolean().default(false),
});

export const IndexerConfigSchema = z.object({
  DB_URL: z
    .string()
    .min(1, "DB_URL is required for indexer")
    .url("DB_URL must be a valid database URL"),
  START_LEDGER: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe("Ledger sequence to start indexing from"),
  INDEXER_BATCH_SIZE: z.coerce.number().int().positive().default(100),
});

export const AlertsConfigSchema = z.object({
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  PAGERDUTY_ROUTING_KEY: z.string().min(1).optional(),
  ALERT_EMAIL: z.string().email().optional(),
  FEE_BPS_THRESHOLD: z.coerce.number().int().min(0).max(10000).default(100),
}).refine(
  (c) => c.SLACK_WEBHOOK_URL || c.PAGERDUTY_ROUTING_KEY || c.ALERT_EMAIL,
  "At least one alerting channel must be configured (SLACK_WEBHOOK_URL, PAGERDUTY_ROUTING_KEY, or ALERT_EMAIL)"
);

export const HealthConfigSchema = z.object({
  HEALTH_PORT: z.coerce
    .number()
    .int()
    .positive()
    .max(65535)
    .default(8080),
  RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  EXPECTED_ACTIVE_SUBS_MIN: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(0),
});

export const AppConfigSchema = z.object({
  STELLAR_NETWORK: StellarNetworkSchema.default("testnet"),
  RPC_URL: RpcUrlSchema,
  CONTRACT_ID: ContractIdSchema,
  KEEPER: KeeperConfigSchema.optional(),
  INDEXER: IndexerConfigSchema.optional(),
  ALERTS: AlertsConfigSchema.optional(),
  HEALTH: HealthConfigSchema.optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type KeeperConfig = z.infer<typeof KeeperConfigSchema>;
export type IndexerConfig = z.infer<typeof IndexerConfigSchema>;
export type AlertsConfig = z.infer<typeof AlertsConfigSchema>;
export type HealthConfig = z.infer<typeof HealthConfigSchema>;

export function flattenEnv(prefix: string, env: typeof process.env): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const p = prefix + "_";
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(p) && value !== undefined) {
      const stripped = key.slice(p.length);
      out[stripped] = value;
    }
  }
  return out;
}

export function buildConfigFromEnv(env: typeof process.env = process.env): unknown {
  return {
    STELLAR_NETWORK: env.STELLAR_NETWORK as unknown,
    RPC_URL: env.RPC_URL as unknown,
    CONTRACT_ID: env.CONTRACT_ID as unknown,
    KEEPER: env.PRIVATE_KEY ? (flattenEnv("", env) as unknown) : undefined,
    INDEXER: env.DB_URL ? (flattenEnv("", env) as unknown) : undefined,
    ALERTS:
      env.SLACK_WEBHOOK_URL || env.PAGERDUTY_ROUTING_KEY || env.ALERT_EMAIL
        ? (flattenEnv("", env) as unknown)
        : undefined,
    HEALTH: env.HEALTH_PORT ? (flattenEnv("", env) as unknown) : undefined,
  };
}

export interface LoadConfigOptions {
  strict?: boolean;
  requireKeeper?: boolean;
  requireIndexer?: boolean;
  requireAlerts?: boolean;
  requireHealth?: boolean;
  scriptName?: string;
}

export class ConfigValidationError extends Error {
  public readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[], scriptName?: string) {
    const header = scriptName
      ? `[${scriptName}] Configuration validation failed:\n`
      : "Configuration validation failed:\n";
    const body = issues
      .map((iss, i) => {
        const path = iss.path.length ? iss.path.join(".") : "(root)";
        return `  ${i + 1}. [${path}] ${iss.message}`;
      })
      .join("\n");
    super(header + body);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const {
    strict = false,
    requireKeeper = false,
    requireIndexer = false,
    requireAlerts = false,
    requireHealth = false,
    scriptName,
  } = options;

  const raw = buildConfigFromEnv(process.env);

  let schema: z.ZodType<AppConfig> = AppConfigSchema as z.ZodType<AppConfig>;

  if (requireKeeper) {
    schema = AppConfigSchema.extend({ KEEPER: KeeperConfigSchema }) as z.ZodType<AppConfig>;
  }
  if (requireIndexer) {
    schema = (schema as unknown as typeof AppConfigSchema).extend({
      INDEXER: IndexerConfigSchema,
    }) as z.ZodType<AppConfig>;
  }
  if (requireAlerts) {
    schema = (schema as unknown as typeof AppConfigSchema).extend({
      ALERTS: AlertsConfigSchema,
    }) as z.ZodType<AppConfig>;
  }
  if (requireHealth) {
    schema = (schema as unknown as typeof AppConfigSchema).extend({
      HEALTH: HealthConfigSchema,
    }) as z.ZodType<AppConfig>;
  }

  const strictSchema = strict
    ? (schema as unknown as z.ZodObject<z.ZodRawShape>).strict()
    : undefined;
  const result = strict ? strictSchema!.safeParse(raw) : schema.safeParse(raw);

  if (!result.success) {
    throw new ConfigValidationError(result.error.issues, scriptName);
  }

  return result.data as AppConfig;
}

export function validateConfigForScript(
  scriptName: string,
  options: Omit<LoadConfigOptions, "scriptName" | "strict"> = {}
): AppConfig {
  return loadConfig({ ...options, strict: true, scriptName });
}
