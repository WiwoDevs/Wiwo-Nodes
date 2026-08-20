import path from "node:path";
import { z } from "zod";
import {
  ACTOR_ROLES,
  METRICOOL_INSTAGRAM_PROVIDERS,
  type ActorRole,
  type MetricoolAccountReference,
} from "./types.js";

const modeSchema = z.enum(["demo", "live"]);
const repositoryDriverSchema = z.enum(["json", "postgres"]);
const autoReplyDispatchModeSchema = z.enum(["shadow", "live"]);

const accountMapSchema = z.record(
  z.string().min(1),
  z.object({
    userId: z.union([z.string(), z.number()]).transform(String),
    blogId: z.union([z.string(), z.number()]).transform(String),
    instagramProvider: z.enum(METRICOOL_INSTAGRAM_PROVIDERS).default("INSTAGRAMBUSINESS"),
  }),
);

export interface AppConfig {
  host: string;
  port: number;
  dataFile: string;
  persistence: {
    driver: "json" | "postgres";
    jsonFile: string;
    postgresUrl?: string;
    postgresEncryptionKey?: string;
    postgresOrganizationSlug: string;
    postgresOrganizationName: string;
    postgresSeedDemo: boolean;
    allowJsonInLive: boolean;
  };
  mode: "demo" | "live";
  requestedMode: "demo" | "live";
  demoMode: boolean;
  modeReason: "explicit_demo" | "credentials_missing" | "credentials_configured";
  metricool: {
    token?: string;
    baseUrl: string;
    fallbackAccount?: MetricoolAccountReference;
    allowFallbackAccount: boolean;
    accounts: Record<string, MetricoolAccountReference>;
  };
  operations: {
    inboxSyncEnabled: boolean;
    outboundSendsDisabled: boolean;
    externalNodesDisabled: boolean;
    metricoolMutationsDisabled: boolean;
    manualRepliesEnabled: boolean;
    autoReplyDispatchMode: "shadow" | "live";
    autoReplyMaxPending: number;
  };
  automation: {
    credentialEncryptionKey: string;
  };
  security: {
    apiKey?: string;
    requireApiKey: boolean;
    corsOrigins: boolean | string[];
    securityHeaders: boolean;
    enforceOriginCheck: boolean;
    rateLimit: {
      enabled: boolean;
      windowMs: number;
      max: number;
    };
    actorContext: {
      require: boolean;
      trustHeaders: boolean;
      defaultRole: ActorRole;
    };
  };
  serveFrontend: boolean;
  frontendDir: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseAccounts(raw: string | undefined): Record<string, MetricoolAccountReference> {
  if (!raw) return {};
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("METRICOOL_ACCOUNTS_JSON debe contener JSON válido.");
  }
  const result = accountMapSchema.safeParse(decoded);
  if (!result.success) {
    throw new Error("METRICOOL_ACCOUNTS_JSON no tiene el formato { accountId: { userId, blogId, instagramProvider? } }.");
  }
  return result.data;
}

function parseCorsOrigins(raw: string | undefined, fallback: boolean | string[]): boolean | string[] {
  const value = raw?.trim();
  if (!value) return fallback;
  if (value === "*") return true;

  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) return fallback;
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("SAC_FLOW_CORS_ORIGINS debe contener orígenes absolutos separados por coma.");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("SAC_FLOW_CORS_ORIGINS solo acepta orígenes http(s).");
    }
  }
  return origins;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AppConfig {
  const token = (env.METRICOOL_API_TOKEN || env.METRICOOL_TOKEN)?.trim() || undefined;
  const requestedMode = modeSchema.parse(
    env.METRICOOL_MODE || (token ? "live" : "demo"),
  );
  const demoMode = requestedMode === "demo" || !token;
  const modeReason: AppConfig["modeReason"] = requestedMode === "demo"
    ? "explicit_demo"
    : token
      ? "credentials_configured"
      : "credentials_missing";
  if (requestedMode === "live" && !token) {
    throw new Error("METRICOOL_MODE=live requiere METRICOOL_API_TOKEN. Use METRICOOL_MODE=demo para el modo demo.");
  }

  const fallbackUserId = env.METRICOOL_USER_ID?.trim();
  const fallbackBlogId = env.METRICOOL_BLOG_ID?.trim();
  const fallbackInstagramProvider = z.enum(METRICOOL_INSTAGRAM_PROVIDERS).parse(
    env.METRICOOL_INSTAGRAM_PROVIDER || "INSTAGRAMBUSINESS",
  );
  const fallbackAccount = fallbackUserId && fallbackBlogId
    ? { userId: fallbackUserId, blogId: fallbackBlogId, instagramProvider: fallbackInstagramProvider }
    : undefined;

  const port = z.coerce.number().int().min(1).max(65_535).parse(env.PORT || 8787);
  const production = env.NODE_ENV === "production";
  const apiKey = env.SAC_FLOW_API_KEY?.trim() || undefined;
  const requireApiKey = parseBoolean(env.SAC_FLOW_REQUIRE_API_KEY, production || requestedMode === "live");
  if (requireApiKey && !apiKey) {
    throw new Error("SAC_FLOW_API_KEY debe estar configurado cuando SAC_FLOW_REQUIRE_API_KEY está activo.");
  }
  const corsOrigins = parseCorsOrigins(
    env.SAC_FLOW_CORS_ORIGINS,
    production || requestedMode === "live" ? false : true,
  );
  const securityHeaders = parseBoolean(env.SAC_FLOW_SECURITY_HEADERS, production || requestedMode === "live");
  const enforceOriginCheck = parseBoolean(
    env.SAC_FLOW_ENFORCE_ORIGIN_CHECK,
    production || requestedMode === "live",
  );
  const rateLimitEnabled = parseBoolean(env.SAC_FLOW_RATE_LIMIT_ENABLED, production || requestedMode === "live");
  const rateLimitWindowMs = z.coerce.number().int().min(1_000).max(3_600_000).parse(
    env.SAC_FLOW_RATE_LIMIT_WINDOW_MS || 60_000,
  );
  const rateLimitMax = z.coerce.number().int().min(1).max(100_000).parse(env.SAC_FLOW_RATE_LIMIT_MAX || 600);
  const allowFallbackAccount = parseBoolean(env.METRICOOL_ALLOW_FALLBACK_ACCOUNT, demoMode);
  const requireActorContext = parseBoolean(env.SAC_FLOW_REQUIRE_ACTOR_CONTEXT, false);
  const trustActorHeaders = parseBoolean(env.SAC_FLOW_TRUST_ACTOR_HEADERS, requireActorContext);
  const defaultRole = z.enum(ACTOR_ROLES).parse(env.SAC_FLOW_DEFAULT_ROLE || "admin");
  const repositoryDriver = repositoryDriverSchema.parse(
    env.SAC_FLOW_REPOSITORY || env.SAC_FLOW_STORAGE_DRIVER || "json",
  );
  const postgresUrl = (env.SAC_FLOW_POSTGRES_URL || env.DATABASE_URL)?.trim() || undefined;
  const postgresEncryptionKey = env.SAC_FLOW_POSTGRES_ENCRYPTION_KEY?.trim() || undefined;
  const postgresOrganizationSlug = (env.SAC_FLOW_POSTGRES_ORGANIZATION_SLUG || "techlab-sac").trim();
  const postgresOrganizationName = (env.SAC_FLOW_POSTGRES_ORGANIZATION_NAME || "Techlab SAC").trim();
  const postgresSeedDemo = parseBoolean(env.SAC_FLOW_POSTGRES_SEED_DEMO, demoMode && !production);
  const jsonFile = path.resolve(env.SAC_FLOW_DATA_FILE || path.join(cwd, "data", "sac-flow.json"));
  const allowJsonInLive = parseBoolean(env.SAC_FLOW_ALLOW_JSON_IN_LIVE, !production);
  const inboxSyncEnabled = parseBoolean(env.SAC_FLOW_INBOX_SYNC_ENABLED, false);
  const outboundSendsDisabled = parseBoolean(
    env.SAC_FLOW_DISABLE_OUTBOUND_SENDS || env.SAC_FLOW_OUTBOUND_SENDS_DISABLED,
    false,
  );
  const externalNodesDisabled = parseBoolean(env.SAC_FLOW_DISABLE_EXTERNAL_NODES, true);
  const metricoolMutationsDisabled = parseBoolean(env.SAC_FLOW_DISABLE_METRICOOL_MUTATIONS, true);
  const manualRepliesEnabled = parseBoolean(
    env.SAC_FLOW_ENABLE_MANUAL_REPLIES,
    !metricoolMutationsDisabled,
  );
  const autoReplyDispatchMode = autoReplyDispatchModeSchema.parse(
    env.SAC_FLOW_AUTO_REPLY_DISPATCH_MODE || "shadow",
  );
  const autoReplyMaxPending = z.coerce.number().int().min(1).max(2_000).parse(
    env.SAC_FLOW_AUTO_REPLY_MAX_PENDING || 1_000,
  );
  const credentialEncryptionKey = (
    env.SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY
    || postgresEncryptionKey
    || "local-development-credential-key-not-for-production"
  ).trim();
  if (repositoryDriver === "postgres" && !postgresUrl) {
    throw new Error("SAC_FLOW_REPOSITORY=postgres requiere SAC_FLOW_POSTGRES_URL o DATABASE_URL.");
  }
  if (repositoryDriver === "postgres" && !postgresEncryptionKey) {
    throw new Error("SAC_FLOW_REPOSITORY=postgres requiere SAC_FLOW_POSTGRES_ENCRYPTION_KEY para cifrar referencias Metricool.");
  }
  if (repositoryDriver === "postgres" && postgresOrganizationSlug.length < 2) {
    throw new Error("SAC_FLOW_POSTGRES_ORGANIZATION_SLUG debe tener al menos 2 caracteres.");
  }
  if (repositoryDriver === "json" && requestedMode === "live" && !allowJsonInLive) {
    throw new Error(
      "SAC_FLOW_REPOSITORY=json no está permitido en live con NODE_ENV=production salvo que SAC_FLOW_ALLOW_JSON_IN_LIVE=true.",
    );
  }
  if (production && (credentialEncryptionKey === "local-development-credential-key-not-for-production" || credentialEncryptionKey.length < 32)) {
    throw new Error("NODE_ENV=production requiere SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY de al menos 32 caracteres.");
  }

  return {
    host: env.API_HOST?.trim() || "127.0.0.1",
    port,
    dataFile: jsonFile,
    persistence: {
      driver: repositoryDriver,
      jsonFile,
      postgresUrl,
      postgresEncryptionKey,
      postgresOrganizationSlug,
      postgresOrganizationName,
      postgresSeedDemo,
      allowJsonInLive,
    },
    mode: demoMode ? "demo" : "live",
    requestedMode,
    demoMode,
    modeReason,
    metricool: {
      token,
      baseUrl: (env.METRICOOL_BASE_URL || "https://app.metricool.com/api").replace(/\/$/, ""),
      fallbackAccount,
      allowFallbackAccount,
      accounts: parseAccounts(env.METRICOOL_ACCOUNTS_JSON),
    },
    operations: {
      inboxSyncEnabled,
      outboundSendsDisabled,
      externalNodesDisabled,
      metricoolMutationsDisabled,
      manualRepliesEnabled,
      autoReplyDispatchMode,
      autoReplyMaxPending,
    },
    automation: {
      credentialEncryptionKey,
    },
    security: {
      apiKey,
      requireApiKey,
      corsOrigins,
      securityHeaders,
      enforceOriginCheck,
      rateLimit: {
        enabled: rateLimitEnabled,
        windowMs: rateLimitWindowMs,
        max: rateLimitMax,
      },
      actorContext: {
        require: requireActorContext,
        trustHeaders: trustActorHeaders,
        defaultRole,
      },
    },
    serveFrontend: parseBoolean(env.SERVE_FRONTEND, production),
    frontendDir: path.resolve(env.FRONTEND_DIR || path.join(cwd, "dist", "client")),
  };
}

export function resolveMetricoolAccount(
  config: AppConfig,
  accountId: string,
  stored?: MetricoolAccountReference,
): MetricoolAccountReference | undefined {
  return config.metricool.accounts[accountId]
    || stored
    || (config.metricool.allowFallbackAccount ? config.metricool.fallbackAccount : undefined);
}
