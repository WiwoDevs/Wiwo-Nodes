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
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
