import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadLocalEnvironment } from "./load-env.js";

loadLocalEnvironment();
const config = loadConfig();
const app = await buildApp({
  config,
  logger: {
    level: process.env.LOG_LEVEL || "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.x-mc-auth",
        "req.headers.x-api-key",
        "headers.X-Mc-Auth",
        "config.metricool.token",
      ],
      censor: "[REDACTED]",
    },
  },
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Cerrando SAC Flow API");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  if (config.demoMode) {
    app.log.warn(
      { reason: config.modeReason },
      "SAC Flow está en modo demo: no se harán llamadas ni envíos a Metricool.",
    );
  }
  if (!config.demoMode && config.metricool.autoLink && !config.metricool.userId
    && !config.metricool.fallbackAccount?.userId && !Object.keys(config.metricool.accounts).length) {
    app.log.warn("Falta METRICOOL_USER_ID: no se puede leer el catálogo de Metricool ni vincular marcas automáticamente.");
  }
  if (config.auth.enabled && !config.security.apiKey && config.operations.inboxSyncEnabled) {
    app.log.warn(
      "Inicio de sesión activo sin SAC_FLOW_API_KEY: el worker y el despachador no podrán llamar a /api/sync ni enviar respuestas.",
    );
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
