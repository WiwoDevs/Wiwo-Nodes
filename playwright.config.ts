import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // These integration tests share one durable API data file, so mutations must be serialized.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:8792",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:8792/api/ready",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      NODE_ENV: "production",
      METRICOOL_MODE: "demo",
      API_HOST: "127.0.0.1",
      PORT: "8792",
      SERVE_FRONTEND: "true",
      SAC_FLOW_REQUIRE_API_KEY: "false",
      SAC_FLOW_REPOSITORY: "json",
      SAC_FLOW_DATA_FILE: "./data/e2e-sac-flow.json",
      SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "e2e-automation-credentials-key-32-chars",
      SAC_FLOW_DISABLE_EXTERNAL_NODES: "true",
      SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "true",
      SAC_FLOW_INBOX_SYNC_ENABLED: "true",
    },
  },
});
