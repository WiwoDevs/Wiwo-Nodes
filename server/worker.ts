import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { createRepository } from "./repository-factory.js";
import { CredentialVault } from "./credential-vault.js";
import { executeAutomation } from "./automation-service.js";
import { dispatchNextQueuedAutoReply } from "./auto-reply-dispatcher.js";
import type { ActorContext, WorkflowJob } from "./types.js";
import { loadLocalEnvironment } from "./load-env.js";

loadLocalEnvironment();
const config = loadConfig();
if (config.persistence.driver !== "postgres") {
  throw new Error("El worker durable requiere SAC_FLOW_REPOSITORY=postgres.");
}
const repository = createRepository(config);
const workerId = process.env.SAC_FLOW_WORKER_ID?.trim() || `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const apiUrl = (process.env.SAC_FLOW_INTERNAL_API_URL || `http://127.0.0.1:${config.port}`).replace(/\/$/, "");
const pollMs = Math.max(500, Number(process.env.SAC_FLOW_WORKER_POLL_MS || 2_000));
const staleLeaseMs = Math.max(60_000, Number(process.env.SAC_FLOW_WORKER_STALE_LEASE_MS || 10 * 60_000));
const healthPort = Math.max(1, Math.min(65_535, Number(process.env.SAC_FLOW_WORKER_HEALTH_PORT || 8_788)));
const credentialVault = new CredentialVault(config.automation.credentialEncryptionKey);
let stopping = false;
let ready = false;
let lastLoopAt: string | undefined;
let lastReplyDispatchAt: string | undefined;
let lastReplyDispatchOutcome: string | undefined;

const healthServer = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  const healthy = ready && !stopping;
  response.writeHead(healthy ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    status: healthy ? "ready" : stopping ? "stopping" : "starting",
    service: "sac-flow-worker",
    lastLoopAt,
    autoReplyDispatchMode: config.operations.autoReplyDispatchMode,
    lastReplyDispatchAt,
    lastReplyDispatchOutcome,
  }));
});

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : "Falla desconocida del worker.";
}

function scheduleKey(workflowId: string, intervalMinutes: number, now: number): string {
  const bucketMs = intervalMinutes * 60_000;
  return `${workflowId}:${Math.floor(now / bucketMs)}`;
}

const workerActor: ActorContext = {
  userId: workerId,
  displayName: "SAC Flow Worker",
  tenantId: config.persistence.postgresOrganizationSlug,
  role: "admin",
  brandIds: "all",
  source: "trusted_headers",
};

async function enqueueDueJob(): Promise<void> {
  const schedule = await repository.getSchedulerState();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  if (config.operations.inboxSyncEnabled && schedule.accountIds.length) {
    await repository.enqueueJob({
      id: randomUUID(),
      scheduleKey: `sac:${scheduleKey(schedule.workflowId, schedule.pollIntervalMinutes, now)}`,
      kind: "sync",
      status: "queued",
      accountIds: schedule.accountIds,
      limit: 5_000,
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
  }

  const state = await repository.snapshotAutomation();
  for (const workflow of state.workflows.filter((item) => item.active && !item.archived && item.version === item.publishedVersion)) {
    for (const trigger of workflow.nodes.filter((node) => node.type === "core.schedule" && !node.disabled)) {
      const intervalMinutes = Math.min(43_200, Math.max(1, Number(trigger.parameters.intervalMinutes) || 15));
      await repository.enqueueJob({
        id: randomUUID(),
        scheduleKey: `automation:${trigger.id}:${scheduleKey(workflow.id, intervalMinutes, now)}`,
        kind: "automation",
        workflowId: workflow.id,
        triggerMode: "schedule",
        input: [{ scheduledAt: createdAt, workflowId: workflow.id, triggerId: trigger.id }],
        status: "queued",
        accountIds: [],
        limit: 100,
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }
}

async function claimJob(): Promise<WorkflowJob | undefined> {
  return repository.claimNextJob(workerId, staleLeaseMs);
}

async function executeJob(job: WorkflowJob): Promise<void> {
  try {
    if (job.kind === "automation") {
      if (!job.workflowId) throw new Error("El trabajo de automatización no contiene workflowId.");
      const execution = await executeAutomation(
        repository,
        credentialVault,
        workerActor,
        {
          allowExternalRequests: !config.operations.externalNodesDisabled,
          allowMetricoolOperations: !config.operations.metricoolMutationsDisabled,
        },
        job.workflowId,
        job.input || [{}],
        job.triggerMode || "schedule",
        undefined,
        0,
        typeof job.input?.[0]?.triggerId === "string" ? job.input[0].triggerId : undefined,
      );
      if (execution.status !== "success") throw new Error(execution.error?.message || "La automatización programada falló.");
      await repository.completeJob(job.id, workerId, execution.id);
      return;
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": job.id,
    };
    if (config.security.apiKey) headers["x-api-key"] = config.security.apiKey;
    if (config.security.actorContext.trustHeaders) {
      headers["x-sac-user-id"] = workerActor.userId;
      headers["x-sac-user-name"] = workerActor.displayName;
      headers["x-sac-tenant-id"] = workerActor.tenantId;
      headers["x-sac-role"] = workerActor.role;
      headers["x-sac-brand-ids"] = "*";
    }
    const response = await fetch(`${apiUrl}/api/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountIds: job.accountIds, limit: job.limit }),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(() => undefined) as { data?: { run?: { id?: string } }; error?: { message?: string } } | undefined;
    if (!response.ok) throw new Error(payload?.error?.message || `API de sincronización respondió ${response.status}.`);
    await repository.completeJob(job.id, workerId, payload?.data?.run?.id);
  } catch (error) {
    const backoffMs = Math.min(30 * 60_000, 30_000 * (2 ** Math.max(0, job.attempts - 1)));
    await repository.failJob(job.id, workerId, safeError(error), backoffMs);
  }
}

async function main(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    healthServer.once("error", reject);
    healthServer.listen(healthPort, "0.0.0.0", () => {
      healthServer.off("error", reject);
      resolve();
    });
  });
  await repository.initialize();
  ready = true;
  process.stdout.write(`${JSON.stringify({ level: "info", event: "worker_started", workerId })}\n`);
  while (!stopping) {
    lastLoopAt = new Date().toISOString();
    await enqueueDueJob();
    const replyDispatch = await dispatchNextQueuedAutoReply({
      repository,
      config,
      actor: workerActor,
      apiUrl,
    });
    if (replyDispatch.handled) {
      lastReplyDispatchAt = new Date().toISOString();
      lastReplyDispatchOutcome = replyDispatch.outcome;
      process.stdout.write(`${JSON.stringify({
        level: replyDispatch.outcome === "sent" ? "info" : "warn",
        event: "auto_reply_dispatch",
        outcome: replyDispatch.outcome,
        code: replyDispatch.code,
      })}\n`);
    }
    const job = await claimJob();
    if (job) await executeJob(job);
    else if (!replyDispatch.handled) await delay(pollMs);
  }
  ready = false;
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await (repository as { close?: () => Promise<void> }).close?.();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    ready = false;
  });
}

main().catch(async (error) => {
  ready = false;
  process.stderr.write(`${JSON.stringify({ level: "error", event: "worker_crashed", message: safeError(error) })}\n`);
  await Promise.allSettled([
    new Promise<void>((resolve) => {
      if (!healthServer.listening) {
        resolve();
        return;
      }
      healthServer.close(() => resolve());
    }),
    (repository as { close?: () => Promise<void> }).close?.() ?? Promise.resolve(),
  ]);
  process.exitCode = 1;
});
