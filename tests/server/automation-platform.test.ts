import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { executeAutomationWorkflow } from "../../server/automation-engine.js";
import { createDemoAutomationState } from "../../server/automation-seed.js";
import { defaultAutomationWorkflowSettings } from "../../server/automation-catalog.js";
import { loadConfig } from "../../server/config.js";
import type { AutomationWorkflow } from "../../server/automation-types.js";
import { validateAutomationWorkflow } from "../../server/automation-validation.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

async function makeApp(): Promise<SacFlowApp> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-automation-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_DISABLE_EXTERNAL_NODES: "true",
    SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "true",
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "automation-tests-encryption-key",
  }, directory);
  const app = await buildApp({ config });
  apps.push(app);
  return app;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("general automation platform", () => {
  it("exposes the catalog and seeded SAC workflow without exposing secret storage", async () => {
    const app = await makeApp();
    const catalog = await app.inject({ method: "GET", url: "/api/platform/catalog" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().data.nodes.length).toBeGreaterThanOrEqual(25);
    expect(catalog.json().data.nodes.some((node: { type: string }) => node.type === "sac.metricoolInbox")).toBe(true);

    const platform = await app.inject({ method: "GET", url: "/api/platform" });
    expect(platform.statusCode).toBe(200);
    expect(platform.json().data.workflows[0]).toMatchObject({ id: "automation-sac-primary", active: true });
    expect(JSON.stringify(platform.json())).not.toContain("encryptedData");
    expect(platform.json().meta).toMatchObject({ externalNodesDisabled: true, metricoolMutationsDisabled: true });
  });

  it("runs a deterministic data workflow and records its node audit", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/platform/workflows/automation-daily-report/run",
      payload: { input: [
        { id: "a", status: "open", createdAt: "2026-08-12T10:00:00.000Z" },
        { id: "a", status: "open", createdAt: "2026-08-12T10:00:00.000Z" },
        { id: "b", status: "closed", createdAt: "2026-08-12T11:00:00.000Z" },
      ] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("success");
    expect(response.json().data.nodeRuns).toHaveLength(5);
    expect(response.json().data.output).toEqual(expect.arrayContaining([
      { group: "open", count: 1 },
      { group: "closed", count: 1 },
    ]));

    const history = await app.inject({ method: "GET", url: "/api/platform/executions?workflowId=automation-daily-report" });
    expect(history.json().data).toHaveLength(1);
  });

  it("replays a general execution idempotently without creating a second run", async () => {
    const app = await makeApp();
    const request = {
      method: "POST" as const,
      url: "/api/platform/workflows/automation-daily-report/run",
      headers: { "idempotency-key": "automation-run-test-001" },
      payload: { input: [{ id: "a", status: "open" }] },
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(second.json().data.id).toBe(first.json().data.id);
    expect((await app.sacFlow.repository.snapshot()).automation.executions).toHaveLength(1);
  });

  it("reserves idempotency keys before execution to reject concurrent duplicates", async () => {
    const app = await makeApp();
    const current = (await app.inject({ method: "GET", url: "/api/platform/workflows/automation-daily-report" })).json().data.workflow;
    const nodes = [
      current.nodes[0],
      { id: "wait-idempotent", name: "Espera", type: "core.wait", typeVersion: 1, position: { x: 300, y: 250 }, parameters: { milliseconds: 150 } },
    ];
    const connections = [{ id: "manual-wait-idempotent", sourceNode: "manual", sourceOutput: "main", targetNode: "wait-idempotent", targetInput: "main" }];
    expect((await app.inject({ method: "PUT", url: "/api/platform/workflows/automation-daily-report", payload: { nodes, connections, settings: { ...current.settings, concurrency: 2 } } })).statusCode).toBe(200);
    const request = {
      method: "POST" as const,
      url: "/api/platform/workflows/automation-daily-report/run",
      headers: { "idempotency-key": "concurrent-idempotency-test" },
      payload: { input: [{ id: 1 }] },
    };

    const firstPromise = app.inject(request);
    await delay(20);
    const concurrent = await app.inject(request);
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.headers["retry-after"]).toBe("3");
    expect(concurrent.json().error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    const first = await firstPromise;
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(replay.json().data.id).toBe(first.json().data.id);
    expect((await app.sacFlow.repository.snapshot()).automation.executions).toHaveLength(1);
  });

  it("activates a published webhook and executes it through its public path", async () => {
    const app = await makeApp();
    const activated = await app.inject({ method: "POST", url: "/api/platform/workflows/automation-webhook-intake/active", payload: { active: true } });
    expect(activated.statusCode).toBe(200);

    const webhook = await app.inject({ method: "POST", url: "/api/webhooks/leads", payload: { email: "persona@example.test", source: "test" } });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json().data).toEqual({ accepted: true });
    expect(webhook.json().meta.executionId).toBeTruthy();
  });

  it("protects a webhook with an encrypted per-workflow bearer credential", async () => {
    const app = await makeApp();
    const credential = await app.inject({
      method: "POST",
      url: "/api/platform/credentials",
      payload: { projectId: "project-operations", name: "Webhook bearer", type: "httpBearerAuth", data: { token: "webhook-secret-token" } },
    });
    const current = await app.inject({ method: "GET", url: "/api/platform/workflows/automation-webhook-intake" });
    const workflow = current.json().data.workflow;
    workflow.nodes[0].parameters.authentication = "credential";
    workflow.nodes[0].credentialId = credential.json().data.id;
    const saved = await app.inject({
      method: "PUT",
      url: "/api/platform/workflows/automation-webhook-intake",
      payload: { nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings, tags: workflow.tags },
    });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/platform/workflows/automation-webhook-intake/publish", payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/platform/workflows/automation-webhook-intake/active", payload: { active: true } })).statusCode).toBe(200);

    const blocked = await app.inject({ method: "POST", url: "/api/webhooks/leads", payload: { email: "persona@example.test" } });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe("WEBHOOK_UNAUTHORIZED");
    const allowed = await app.inject({ method: "POST", url: "/api/webhooks/leads", headers: { authorization: "Bearer webhook-secret-token" }, payload: { email: "persona@example.test" } });
    expect(allowed.statusCode).toBe(200);
  });

  it("accepts native form posts and returns the configured webhook response", async () => {
    const app = await makeApp();
    const current = (await app.inject({ method: "GET", url: "/api/platform/workflows/automation-webhook-intake" })).json().data.workflow;
    current.nodes[0] = { ...current.nodes[0], type: "core.formTrigger", parameters: { path: "lead-form" } };
    expect((await app.inject({ method: "PUT", url: "/api/platform/workflows/automation-webhook-intake", payload: { nodes: current.nodes } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/platform/workflows/automation-webhook-intake/publish", payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/platform/workflows/automation-webhook-intake/active", payload: { active: true } })).statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/lead-form",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "email=persona%40example.test&source=form",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ accepted: true });
  });

  it("enforces workflow concurrency transactionally", async () => {
    const app = await makeApp();
    const current = (await app.inject({ method: "GET", url: "/api/platform/workflows/automation-daily-report" })).json().data.workflow;
    const nodes = [
      current.nodes[0],
      { id: "wait", name: "Espera", type: "core.wait", typeVersion: 1, position: { x: 300, y: 250 }, parameters: { milliseconds: 150 } },
    ];
    const connections = [{ id: "manual-wait", sourceNode: "manual", sourceOutput: "main", targetNode: "wait", targetInput: "main" }];
    expect((await app.inject({ method: "PUT", url: "/api/platform/workflows/automation-daily-report", payload: { nodes, connections, settings: { ...current.settings, concurrency: 1 } } })).statusCode).toBe(200);

    const first = app.inject({ method: "POST", url: "/api/platform/workflows/automation-daily-report/run", payload: { input: [{ id: 1 }] } });
    await delay(20);
    const second = await app.inject({ method: "POST", url: "/api/platform/workflows/automation-daily-report/run", payload: { input: [{ id: 2 }] } });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("AUTOMATION_CONCURRENCY_LIMIT");
    expect((await first).statusCode).toBe(200);
  });

  it("encrypts new credentials and never returns their values", async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/platform/credentials",
      payload: { projectId: "project-operations", name: "Bearer de prueba", type: "httpBearerAuth", data: { token: "top-secret-test-token" } },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data).toMatchObject({ configured: true, dataKeys: ["token"] });
    expect(JSON.stringify(created.json())).not.toContain("top-secret-test-token");

    const platform = await app.inject({ method: "GET", url: "/api/platform" });
    expect(JSON.stringify(platform.json())).not.toContain("top-secret-test-token");
    const stored = await app.sacFlow.repository.snapshot();
    const credential = stored.automation.credentials.find((item) => item.name === "Bearer de prueba");
    expect(credential?.encryptedData).toMatch(/^v1\./);
    expect(credential?.encryptedData).not.toContain("top-secret-test-token");
  });

  it("rejects incomplete or unexpected credential fields and preserves fields on partial updates", async () => {
    const app = await makeApp();
    const incomplete = await app.inject({
      method: "POST",
      url: "/api/platform/credentials",
      payload: { projectId: "project-operations", name: "Header inválido", type: "httpHeaderAuth", data: { name: "x-api-key" } },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error.code).toBe("CREDENTIAL_FIELDS_REQUIRED");

    const unexpected = await app.inject({
      method: "POST",
      url: "/api/platform/credentials",
      payload: { projectId: "project-operations", name: "Bearer inválido", type: "httpBearerAuth", data: { token: "safe-token", extra: "no" } },
    });
    expect(unexpected.statusCode).toBe(400);
    expect(unexpected.json().error.code).toBe("UNKNOWN_CREDENTIAL_FIELD");

    const unsafeHeader = await app.inject({
      method: "POST",
      url: "/api/platform/credentials",
      payload: { projectId: "project-operations", name: "Header inseguro", type: "httpHeaderAuth", data: { name: "Content-Length", value: "10" } },
    });
    expect(unsafeHeader.statusCode).toBe(400);
    expect(unsafeHeader.json().error.code).toBe("INVALID_CREDENTIAL_HEADER");

    const created = await app.inject({
      method: "POST",
      url: "/api/platform/credentials",
      payload: { projectId: "project-operations", name: "Header", type: "httpHeaderAuth", data: { name: "x-api-key", value: "first-secret" } },
    });
    const updated = await app.inject({
      method: "PUT",
      url: `/api/platform/credentials/${created.json().data.id}`,
      payload: { data: { value: "second-secret" } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ configured: true, dataKeys: ["name", "value"] });
    expect(JSON.stringify(updated.json())).not.toContain("second-secret");
  });

  it("redacts secret variable values before persisting execution input or output", async () => {
    const app = await makeApp();
    const secret = "variable-secret-value";
    expect((await app.inject({
      method: "PUT",
      url: "/api/platform/variables",
      payload: { projectId: "project-operations", key: "PRIVATE_VALUE", value: secret, secret: true },
    })).statusCode).toBe(200);
    const current = (await app.inject({ method: "GET", url: "/api/platform/workflows/automation-daily-report" })).json().data.workflow;
    const nodes = [
      current.nodes[0],
      { id: "set-secret", name: "Usa secreto", type: "core.set", typeVersion: 1, position: { x: 300, y: 250 }, parameters: { values: { copied: "prefix-{{ $vars.PRIVATE_VALUE }}" }, keepInput: true } },
    ];
    const connections = [{ id: "manual-secret", sourceNode: "manual", sourceOutput: "main", targetNode: "set-secret", targetInput: "main" }];
    expect((await app.inject({ method: "PUT", url: "/api/platform/workflows/automation-daily-report", payload: { nodes, connections } })).statusCode).toBe(200);

    const run = await app.inject({
      method: "POST",
      url: "/api/platform/workflows/automation-daily-report/run",
      payload: { input: [{ harmless: secret }] },
    });
    expect(run.statusCode).toBe(200);
    expect(JSON.stringify(run.json())).not.toContain(secret);
    const stored = (await app.sacFlow.repository.snapshot()).automation.executions.find((item) => item.id === run.json().data.id);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(stored?.input[0]).toMatchObject({ harmless: "[REDACTED]" });
    expect(stored?.output[0]).toMatchObject({ copied: "prefix-[redacted]" });
  });

  it("duplicates every node and remaps all graph connections", async () => {
    const app = await makeApp();
    const duplicated = await app.inject({ method: "POST", url: "/api/platform/workflows/automation-webhook-intake/duplicate", payload: {} });
    expect(duplicated.statusCode).toBe(200);
    const copy = duplicated.json().data;
    expect(copy.nodes).toHaveLength(5);
    expect(copy.connections).toHaveLength(5);
    const ids = new Set(copy.nodes.map((node: { id: string }) => node.id));
    expect(copy.connections.every((edge: { sourceNode: string; targetNode: string }) => ids.has(edge.sourceNode) && ids.has(edge.targetNode))).toBe(true);
  });

  it("rolls back to an immutable snapshot and exports/imports a secret-free graph", async () => {
    const app = await makeApp();
    const current = (await app.inject({ method: "GET", url: "/api/platform/workflows/automation-daily-report" })).json().data.workflow;
    const edited = await app.inject({ method: "PUT", url: "/api/platform/workflows/automation-daily-report", payload: { name: "Nombre temporal" } });
    expect(edited.json().data).toMatchObject({ name: "Nombre temporal", version: 2, active: false });
    const rollback = await app.inject({ method: "POST", url: "/api/platform/workflows/automation-daily-report/rollback", payload: { version: 1 } });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().data).toMatchObject({ name: current.name, version: 3, publishedVersion: 1, active: false });

    const exported = await app.inject({ method: "GET", url: "/api/platform/workflows/automation-webhook-intake/export" });
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({ schemaVersion: 1, workflow: { name: "Recepción de leads" } });
    expect(JSON.stringify(exported.json())).not.toContain("encryptedData");
    const imported = await app.inject({
      method: "POST",
      url: "/api/platform/workflows/import",
      payload: { projectId: "project-operations", ...exported.json().workflow, name: "Webhook importado" },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().data.nodes).toHaveLength(5);
    expect(imported.json().data.connections).toHaveLength(5);
    expect(imported.json().meta.validation.valid).toBe(true);
  });

  it("blocks external HTTP nodes and detects cyclic workflows", async () => {
    const state = createDemoAutomationState(new Date("2026-08-12T12:00:00.000Z"));
    const workflow: AutomationWorkflow = {
      id: "http-cycle-test",
      projectId: "project-operations",
      name: "HTTP protegido",
      description: "",
      active: false,
      archived: false,
      version: 1,
      publishedVersion: 0,
      tags: [],
      nodes: [
        { id: "manual", name: "Inicio", type: "core.manualTrigger", typeVersion: 1, position: { x: 0, y: 0 }, parameters: {} },
        { id: "http", name: "HTTP", type: "core.httpRequest", typeVersion: 1, position: { x: 200, y: 0 }, parameters: { url: "https://example.com" } },
      ],
      connections: [{ id: "manual-http", sourceNode: "manual", sourceOutput: "main", targetNode: "http", targetInput: "main" }],
      settings: defaultAutomationWorkflowSettings(),
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    };
    const result = await executeAutomationWorkflow(workflow, [{}], {
      mode: "manual",
      variables: {},
      allowExternalRequests: false,
      allowMetricoolOperations: false,
    });
    expect(result).toMatchObject({ status: "error", error: { nodeId: "http" } });
    expect(result.error?.message).toContain("desactivadas");

    workflow.connections.push({ id: "http-manual", sourceNode: "http", sourceOutput: "main", targetNode: "manual", targetInput: "main" });
    const validation = validateAutomationWorkflow(workflow, state);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.code === "CYCLE_DETECTED")).toBe(true);
  });

  it("starts only the selected trigger and preserves output before a disabled node", async () => {
    const workflow: AutomationWorkflow = {
      id: "trigger-scope", projectId: "project-operations", name: "Triggers aislados", description: "", active: true, archived: false,
      version: 1, publishedVersion: 1, tags: [], settings: defaultAutomationWorkflowSettings(), createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z",
      nodes: [
        { id: "a", name: "Webhook A", type: "core.webhook", typeVersion: 1, position: { x: 0, y: 0 }, parameters: { path: "a", method: "POST" } },
        { id: "b", name: "Webhook B", type: "core.webhook", typeVersion: 1, position: { x: 0, y: 200 }, parameters: { path: "b", method: "POST" } },
        { id: "set-a", name: "Rama A", type: "core.set", typeVersion: 1, position: { x: 200, y: 0 }, parameters: { keepInput: true, values: { branch: "a" } } },
        { id: "set-b", name: "Rama B", type: "core.set", typeVersion: 1, position: { x: 200, y: 200 }, parameters: { keepInput: true, values: { branch: "b" } } },
        { id: "disabled", name: "Desactivado", type: "core.noOp", typeVersion: 1, position: { x: 400, y: 0 }, parameters: {}, disabled: true },
      ],
      connections: [
        { id: "a-set", sourceNode: "a", sourceOutput: "main", targetNode: "set-a", targetInput: "main" },
        { id: "b-set", sourceNode: "b", sourceOutput: "main", targetNode: "set-b", targetInput: "main" },
        { id: "set-disabled", sourceNode: "set-a", sourceOutput: "main", targetNode: "disabled", targetInput: "main" },
      ],
    };
    const result = await executeAutomationWorkflow(workflow, [{ value: 1 }], { mode: "webhook", triggerNodeId: "a", variables: {}, allowExternalRequests: false, allowMetricoolOperations: false });
    expect(result.status).toBe("success");
    expect(result.output).toEqual([{ value: 1, branch: "a" }]);
    expect(result.nodeRuns.map((run) => run.nodeId)).toEqual(["a", "set-a"]);
  });

  it("validates routable webhook paths and preserves explicit zero limits", async () => {
    const state = createDemoAutomationState(new Date("2026-08-12T12:00:00.000Z"));
    const workflow: AutomationWorkflow = {
      id: "webhook-path", projectId: "project-operations", name: "Ruta", description: "", active: false, archived: false,
      version: 1, publishedVersion: 0, tags: [], settings: defaultAutomationWorkflowSettings(), createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z",
      nodes: [
        { id: "webhook", name: "Webhook", type: "core.webhook", typeVersion: 1, position: { x: 0, y: 0 }, parameters: { path: "not/routable", method: "POST" } },
        { id: "limit", name: "Límite cero", type: "core.limit", typeVersion: 1, position: { x: 200, y: 0 }, parameters: { maxItems: 0 } },
      ],
      connections: [{ id: "webhook-limit", sourceNode: "webhook", sourceOutput: "main", targetNode: "limit", targetInput: "main" }],
    };
    expect(validateAutomationWorkflow(workflow, state).issues.some((issue) => issue.code === "INVALID_WEBHOOK_PATH")).toBe(true);
    workflow.nodes[0].parameters.path = "routable-path";
    const result = await executeAutomationWorkflow(workflow, [{ id: 1 }], { mode: "webhook", triggerNodeId: "webhook", variables: {}, allowExternalRequests: false, allowMetricoolOperations: false });
    expect(result).toMatchObject({ status: "success", output: [] });
  });

  it("blocks non-public HTTP destinations and bounded oversized responses", async () => {
    const workflow: AutomationWorkflow = {
      id: "http-boundaries", projectId: "project-operations", name: "HTTP seguro", description: "", active: false, archived: false,
      version: 1, publishedVersion: 0, tags: [], settings: defaultAutomationWorkflowSettings(), createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z",
      nodes: [
        { id: "manual", name: "Inicio", type: "core.manualTrigger", typeVersion: 1, position: { x: 0, y: 0 }, parameters: {} },
        { id: "http", name: "HTTP", type: "core.httpRequest", typeVersion: 1, position: { x: 200, y: 0 }, parameters: { url: "http://127.0.0.1/private" } },
      ],
      connections: [{ id: "manual-http", sourceNode: "manual", sourceOutput: "main", targetNode: "http", targetInput: "main" }],
    };
    const context = { mode: "manual" as const, variables: {}, allowExternalRequests: true, allowMetricoolOperations: false };
    const privateResult = await executeAutomationWorkflow(workflow, [{}], context);
    expect(privateResult.error?.message).toContain("no pública");

    workflow.nodes[1].parameters.url = "http://93.184.216.34/data";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(100_001), { headers: { "content-type": "text/plain" } })));
    const oversized = await executeAutomationWorkflow(workflow, [{}], context);
    expect(oversized.error?.message).toContain("100000 bytes");
  });
});
